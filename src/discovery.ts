// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Test discovery subsystem for pUnit test adapter.
 * Manages the TestItem hierarchy and file-watcher–driven re-discovery.
 */

import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import { TextDecoder } from 'util'
import * as vscode from 'vscode'
import { AstService } from './ast_service'
import { hasDecorator, extractTraitTags } from './ast-analysis'
import { isTestCandidate } from './test-candidate'
import { getTestPackageName, getWatcherPattern, whichPythonExe } from './config'
import type { Module, ClassDef, FunctionDef, ExprNode, Call, Name, Attribute } from './py_ast_types'

// ── context ─────────────────────────────────────────────────────────────────

/** Shared state that ties the discovery subsystem to the VS Code extension host. */
export class DiscoveryContext {
    private _testItems = new Map<string, vscode.TestItem>()
    private _knownTestTags = new Map<string, vscode.TestTag>()
    private _astService: AstService | null = null

    constructor(
        readonly controller: vscode.TestController,
        readonly output: vscode.OutputChannel,
        readonly extensionUri: vscode.Uri,
        pythonExeResolver: () => Promise<string>,
    ) {
        // Lazy-init astService with the python executable resolver
        this.astServiceGetter = async () => {
            if (!this._astService) {
                this._astService = new AstService(
                    await pythonExeResolver(),
                    extensionUri,
                )
            }
            return this._astService
        }
    }

    get testItems(): Map<string, vscode.TestItem> { return this._testItems }
    get knownTestTags(): Map<string, vscode.TestTag> { return this._knownTestTags }
    astServiceGetter: () => Promise<AstService>
}

// ── internal helpers (class methods) ────────────────────────────────────────

function getTestItem(
    ctx: DiscoveryContext,
    type: string,
    uri: vscode.Uri,
    name: string,
    range?: vscode.Range,
): vscode.TestItem {
    const key = `${type}:${uri}`
    let item = ctx.testItems.get(key)
    if (!item) {
        item = ctx.controller.createTestItem(key, name, uri.with({ fragment: '' }))
        item.canResolveChildren = (type !== 'dyndata') && (type !== 'function')
        ctx.testItems.set(key, item)
    }
    if (range) {
        item.range = range
    }
    return item
}

export function destroyTestItem(ctx: DiscoveryContext, type: string, uri: vscode.Uri): void {
    const key = `${type}:${uri}`
    const existing = ctx.testItems.get(key)
    if (existing) {
        ctx.testItems.delete(key)
        existing.parent?.children.delete(existing.id)
    }
}

function getOrCreateTestTag(ctx: DiscoveryContext, id: string): vscode.TestTag {
    let tag = ctx.knownTestTags.get(id)
    if (!tag) {
        tag = new vscode.TestTag(id)
        ctx.knownTestTags.set(id, tag)
    }
    return tag
}

function getTestTagsInternal(ctx: DiscoveryContext, decorator_list: ExprNode[] | undefined): vscode.TestTag[] {
    const results: vscode.TestTag[] = []
    if (decorator_list) {
        for (const decorator_node of decorator_list) {
            if (decorator_node.nodeType !== 'Call') {
                continue
            }
            const call = decorator_node as Call
            let funcId = ''
            if (call.func.nodeType === 'Name') {
                funcId = (call.func as Name).id
            } else if (call.func.nodeType === 'Attribute') {
                funcId = (call.func as Attribute).attr
            }
            if (funcId === 'trait') {
                if (call.args.length > 1) {
                    const a0 = (call.args[0] as unknown as { value: string }).value
                    const a1 = (call.args[1] as unknown as { value: string }).value
                    if (typeof a0 === 'string' && typeof a1 === 'string') {
                        results.push(getOrCreateTestTag(ctx, `${a0}:${a1}`))
                    }
                } else if (call.args.length > 0) {
                    const a0 = (call.args[0] as unknown as { value: string }).value
                    if (typeof a0 === 'string') {
                        results.push(getOrCreateTestTag(ctx, a0))
                    }
                }
            }
        }
    }
    return results
}

// ── AST node processors ────────────────────────────────────────────────────

function processAstFunction(
    ctx: DiscoveryContext,
    uri: vscode.Uri,
    astFunction: FunctionDef,
    parent: vscode.TestItem,
): vscode.TestItem | undefined {
    if (hasDecorator(astFunction?.decorator_list, ['fact', 'theory'])) {
        const range: vscode.Range = new vscode.Range(
            astFunction.lineno - 1,
            0,
            (astFunction.end_lineno ?? astFunction.lineno + astFunction.body.length),
            0,
        )
        const child = getTestItem(ctx, 'function', uri.with({ fragment: astFunction.name }), astFunction.name, range)
        child.tags = getTestTagsInternal(ctx, astFunction.decorator_list)
        parent.children.add(child)
        parent // keep track of this? No, we need to check parent context
        if (hasDecorator(astFunction?.decorator_list, ['theory'])) {
            child.children.forEach(childchild => {
                destroyTestItem(ctx, 'dyndata', childchild.uri!)
            })
        }
        return child
    }
    return undefined
}

function processAstClass(
    ctx: DiscoveryContext,
    uri: vscode.Uri,
    astClass: ClassDef,
    parent: vscode.TestItem,
): vscode.TestItem | undefined {
    const classUri = uri.with({ fragment: astClass.name })
    const range: vscode.Range = new vscode.Range(
        astClass.lineno - 1,
        astClass.col_offset,
        astClass.lineno - 1,
        astClass.col_offset + astClass.name.length + 6,
    )
    const child = getTestItem(ctx, 'class', classUri, astClass.name, range)
    const discovered = new Set<string>()
    for (const node of astClass.body) {
        if (node.nodeType === 'FunctionDef' || node.nodeType === 'AsyncFunctionDef') {
            const f = processAstFunction(ctx, uri, node as FunctionDef, child)
            if (f) {discovered.add(f.id)}
        } else if (node.nodeType === 'ClassDef') {
            const c = processAstClass(ctx, uri, node as ClassDef, child)
            if (c) {discovered.add(c.id)}
        }
    }
    if (child.children.size > 0) {
        parent.children.add(child)
        pruneOrphans(ctx, child.children, discovered)
        return child
    } else {
        destroyTestItem(ctx, 'class', classUri)
        return undefined
    }
}

function pruneOrphans(
    ctx: DiscoveryContext,
    items: vscode.TestItemCollection,
    keeplist: Set<string>,
): void {
    for (const [id] of items) {
        if (!keeplist.has(id)) {
            const parts = id.split(':')
            const typeName = parts[0]
            parts.shift()
            const uri = parts.join(':')
            destroyTestItem(ctx, typeName, vscode.Uri.parse(uri))
            items.delete(id)
        }
    }
}

export function processAstModule(
    ctx: DiscoveryContext,
    uri: vscode.Uri,
    astModule: Module,
    parent: vscode.TestItem,
): vscode.TestItem | undefined {
    const moduleName = uri.path.split('/').reverse()[0]
    const child = getTestItem(ctx, 'module', uri, moduleName, undefined)
    const discovered = new Set<string>()
    for (const node of astModule.body) {
        if (node.nodeType === 'FunctionDef' || node.nodeType === 'AsyncFunctionDef') {
            const f = processAstFunction(ctx, uri, node as FunctionDef, child)
            if (f) {discovered.add(f.id)}
        } else if (node.nodeType === 'ClassDef') {
            const c = processAstClass(ctx, uri, node as ClassDef, child)
            if (c) {discovered.add(c.id)}
        }
    }
    if (discovered.size > 0) {
        parent.children.add(child)
        pruneOrphans(ctx, child.children, discovered)
        return child
    } else {
        destroyTestItem(ctx, 'module', uri)
        return undefined
    }
}

// ── public discovery API ────────────────────────────────────────────────────

/** Ensure workspace root items exist in the controller. */
export function ensureWorkspaceItems(ctx: DiscoveryContext): void {
    vscode.workspace.workspaceFolders?.forEach(workspaceFolder => {
        const testPackageName = getTestPackageName(workspaceFolder)
        const testPackageUri = vscode.Uri.joinPath(workspaceFolder.uri, testPackageName)
        try {
            const stat = fsSync.statSync(testPackageUri.fsPath)
            if (!stat.isDirectory()) {return}
            const workspaceItem = getTestItem(ctx, 'root', testPackageUri, workspaceFolder.name)
            ctx.controller.items.add(workspaceItem)
        } catch {
            // Test package directory doesn't exist — skip creating root item
        }
    })
}

/** Recursively scan a folder for test modules and add them to the tree. */
export async function processFolder(
    ctx: DiscoveryContext,
    item: vscode.TestItem,
): Promise<void> {
    let folderUri = item.uri!
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(folderUri)
    if (!workspaceFolder) {return}

    if (workspaceFolder.uri === item.uri) {
        const testPackageName = getTestPackageName(workspaceFolder)
        folderUri = vscode.Uri.joinPath(folderUri, testPackageName)
    }

    try {
        const entries = [...await fs.readdir(folderUri.fsPath, { withFileTypes: true })]
        for (const entry of entries) {
            if (entry.name.startsWith('__') && entry.name.endsWith('__')) {
                continue
            }
            const entryUri = vscode.Uri.file(path.join(folderUri.fsPath, entry.name))
            try {
                if (entry.isDirectory()) {
                    const child = getTestItem(ctx, 'folder', entryUri, entry.name)
                    item.children.add(child)
                    await processFolder(ctx, child)
                } else if (entry.isFile() && entry.name.endsWith('.py')) {
                    const buf = await vscode.workspace.fs.readFile(entryUri)
                    const content = new TextDecoder('utf-8', { fatal: false }).decode(buf)
                    if (isTestCandidate(content)) {
                        const astModule = await (await ctx.astServiceGetter()).parseFile(content)
                        processAstModule(ctx, entryUri, astModule, item)
                    }
                }
            } catch (e) {
                const err = <Error>e
                ctx.output.appendLine(err.message + '\r\n' + err.stack)
            }
        }
    } catch (e) {
        const err = <Error>e
        ctx.output.appendLine(err.message + '\r\n' + err.stack)
    }
}

/** Handle a file system change event — re-parse affected module. */
export async function handleChange(
    ctx: DiscoveryContext,
    uri: vscode.Uri,
): Promise<void> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)
    if (!workspaceFolder) {
        ctx.output.appendLine(`cannot map uri "${uri}" to a workspace folder.`)
        return
    }
    const remainingPathParts = uri.toString(true).replace(workspaceFolder.uri.toString(true), '').split('/')
    let parent: vscode.TestItem = getTestItem(ctx, 'root', workspaceFolder.uri, workspaceFolder.name)
    let folderUri = workspaceFolder.uri
    for (const pathPart of remainingPathParts) {
        if (pathPart.length === 0) {continue}
        if (pathPart.endsWith('.py')) {
            try {
                const entryUri = vscode.Uri.joinPath(folderUri, pathPart)
                const buf = await vscode.workspace.fs.readFile(entryUri)
                const content = new TextDecoder('utf-8', { fatal: false }).decode(buf)
                if (isTestCandidate(content)) {
                    const astModule = await (await ctx.astServiceGetter()).parseFile(content)
                    const defined = processAstModule(ctx, entryUri, astModule, parent)
                    if (!defined) {
                        destroyTestItem(ctx, 'module', entryUri)
                    }
                } else {
                    destroyTestItem(ctx, 'module', entryUri)
                }
            } catch (e) {
                const err = <Error>e
                ctx.output.appendLine(err.message + '\r\n' + err.stack)
            }
        } else {
            folderUri = vscode.Uri.joinPath(folderUri, pathPart)
            parent = getTestItem(ctx, 'folder', folderUri, pathPart)
        }
    }
}

/** Set up file system watchers on workspace Python files. */
export function refreshWatchers(
    ctx: DiscoveryContext,
    context: vscode.ExtensionContext,
): void {
    // Previous watchers already disposed by caller
    vscode.workspace.workspaceFolders?.forEach(workspaceFolder => {
        const pattern = getWatcherPattern(workspaceFolder)
        const watcher = vscode.workspace.createFileSystemWatcher(pattern)
        watcher.onDidCreate(ur => handleChange(ctx, ur))
        watcher.onDidChange(ur => handleChange(ctx, ur))
        watcher.onDidDelete(ur => destroyTestItem(ctx, 'module', ur))
        context.subscriptions.push(watcher)
    })
}
