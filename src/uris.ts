// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * URI and filter manipulation utilities for pUnit test adapter.
 * Contains test filter creation, URI parsing, and path computation helpers.
 */

import * as path from 'node:path'
import { joinPathSegments, buildFilter } from './filter-utils'
import * as vscode from 'vscode'
import { getTestPackageName } from './config'

// ── public API ───────────────────────────────────────────────────────────────

/** Parse a test item id back into a vscode.Uri.
 *  Id format: `type:vscode-Uri#fragment` or `type:vscode-Uri`. */
export function parseUriFromItemId(id: string): vscode.Uri {
    const parts = id.split(':')
    const defrag = parts[2].split('#')
    return defrag.length > 1
        ? vscode.Uri.parse(`${parts[1]}:${defrag[0]}#${defrag[1]}`)
        : vscode.Uri.parse(`${parts[1]}:${defrag[0]}`)
}

// ── filter creation ─────────────────────────────────────────────────────────

/** Build a workspace-level filter: `${prefix}*` */
export function createWorkspaceFilter(prefix: string): string {
    return `${prefix}*`
}

/** Build a folder-level filter: `folderRelPath.*` */
export function createFolderFilter(
    workspaceFolder: vscode.WorkspaceFolder,
    folderUri: vscode.Uri,
    prefix: string,
): string {
    const basedir = path.join(workspaceFolder.uri.fsPath, getTestPackageName(workspaceFolder))
    const reldir = path.relative(basedir, folderUri.fsPath)
    return buildFilter(prefix, joinPathSegments(reldir, '.'), '*')
}

/** Build a module-level filter: `moduleRelPath/moduleName/*` */
export function createModuleFilter(
    workspaceFolder: vscode.WorkspaceFolder,
    moduleUri: vscode.Uri,
    prefix: string,
): string {
    const { base } = path.parse(moduleUri.fsPath)
    const basedir = path.join(workspaceFolder.uri.fsPath, getTestPackageName(workspaceFolder))
    let reldir = path.relative(basedir, moduleUri.fsPath).replace(base, '')
    if (reldir.length > 0) {
        reldir = `${reldir.replace(/^\/+|\/+$/g, '')}/`
    }
    return buildFilter(
        prefix,
        joinPathSegments(reldir, '.') + base.replace('.py', '/') + '*',
        '',
    )
}

/** Build a class-level filter: `classRelPath/className/*` */
export function createClassFilter(
    workspaceFolder: vscode.WorkspaceFolder,
    classUri: vscode.Uri,
    prefix: string,
): string {
    const { base } = path.parse(classUri.fsPath)
    const basedir = path.join(workspaceFolder.uri.fsPath, getTestPackageName(workspaceFolder))
    let reldir = path.relative(basedir, classUri.fsPath).replace(base, '')
    if (reldir.length > 0) {
        reldir = `${reldir.replace(/^\/+|\/+$/g, '')}/`
    }
    return buildFilter(
        prefix,
        joinPathSegments(reldir, '.') + base.replace('.py', '/') + classUri.fragment + '/*',
        '',
    )
}

/** Build a module-level function filter: `moduleRelPath/moduleName/functionName` */
export function createModuleFunctionFilter(
    workspaceFolder: vscode.WorkspaceFolder,
    moduleUri: vscode.Uri,
    prefix: string,
): string {
    const { base } = path.parse(moduleUri.fsPath)
    const basedir = path.join(workspaceFolder.uri.fsPath, getTestPackageName(workspaceFolder))
    let reldir = path.relative(basedir, moduleUri.fsPath).replace(base, '')
    if (reldir.length > 0) {
        reldir = `${reldir.replace(/^\/+|\/+$/g, '')}/`
    }
    return buildFilter(
        prefix,
        joinPathSegments(reldir, '.') + base.replace('.py', '') + '/' + moduleUri.fragment,
        '',
    )
}

/** Build a class-method filter: `classRelPath/className/methodName` */
export function createClassMethodFilter(
    parent: vscode.TestItem,
    workspaceFolder: vscode.WorkspaceFolder,
    moduleUri: vscode.Uri,
    prefix: string,
): string {
    const className = parent.id.split('#')[1]
    const { base } = path.parse(moduleUri.fsPath)
    const basedir = path.join(workspaceFolder.uri.fsPath, getTestPackageName(workspaceFolder))
    let reldir = path.relative(basedir, moduleUri.fsPath).replace(base, '')
    if (reldir.length > 0) {
        reldir = `${reldir.replace(/^\/+|\/+$/g, '')}/`
    }
    return buildFilter(
        prefix,
        joinPathSegments(reldir, '.') + base.replace('.py', '') + '/' + className + '/' + moduleUri.fragment,
        '',
    )
}

/** Dispatch to the correct filter builder based on test item hierarchy. */
export function createFunctionFilter(
    item: vscode.TestItem,
    workspaceFolder: vscode.WorkspaceFolder,
    itemUri: vscode.Uri,
    prefix: string,
): string {
    if (item.parent?.id.startsWith('module')) {
        return createModuleFunctionFilter(workspaceFolder, itemUri, prefix)
    }
    return createClassMethodFilter(item.parent!, workspaceFolder, itemUri, prefix)
}

// ── filter orchestration ────────────────────────────────────────────────────

/** Build per-workspace filter maps from a request's included/excluded items.
 *  Returns a map: workspaceName → filterString → TestItem. */
export function getTestFilters(
    controller: vscode.TestController,
    items: readonly vscode.TestItem[] | undefined,
    prefix: string,
): Map<string, Map<string, vscode.TestItem>> {
    let workspaceFiltersMap = new Map<string, Map<string, vscode.TestItem>>()
    if (items === undefined) {
        vscode.workspace.workspaceFolders?.forEach(workspaceFolder => {
            const workspaceTestItem = controller.items.get(
                `root:${workspaceFolder.uri}/${getTestPackageName(workspaceFolder)}`,
            )
            if (workspaceTestItem) {
                const filtersTestMap = new Map<string, vscode.TestItem>()
                filtersTestMap.set(`${prefix}*`, workspaceTestItem)
                workspaceFiltersMap.set(workspaceFolder.name, filtersTestMap)
            }
        })
    } else {
        for (const item of items) {
            const itemUri = parseUriFromItemId(item.id)
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(itemUri)
            if (!workspaceFolder) {
                continue
            }
            let filtersTestMap = workspaceFiltersMap.get(workspaceFolder.name)
            if (!filtersTestMap) {
                filtersTestMap = new Map<string, vscode.TestItem>()
                workspaceFiltersMap.set(workspaceFolder.name, filtersTestMap)
            }
            if (item.id.startsWith('root:')) {
                filtersTestMap.set(createWorkspaceFilter(prefix), item)
            } else if (item.id.startsWith('folder:')) {
                filtersTestMap.set(createFolderFilter(workspaceFolder, itemUri, prefix), item)
            } else if (item.id.startsWith('module:')) {
                filtersTestMap.set(createModuleFilter(workspaceFolder, itemUri, prefix), item)
            } else if (item.id.startsWith('class:')) {
                filtersTestMap.set(createClassFilter(workspaceFolder, itemUri, prefix), item)
            } else if (item.id.startsWith('function:')) {
                filtersTestMap.set(createFunctionFilter(item, workspaceFolder, itemUri, prefix), item)
            }
        }
    }
    return workspaceFiltersMap
}
