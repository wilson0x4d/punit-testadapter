// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

import * as cp from 'child_process'
import { once } from 'events'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { TextDecoder } from 'util'
import * as vscode from 'vscode'
import * as pyast from 'py-ast'
import * as net from 'net'
import { randomInt } from 'node:crypto'


type ParsedTestResult = {
    status: 'pass' | 'fail' | 'skip' | 'error'
    name: string
    took: number
    message: string | undefined
}

async function ensureDebuggerActive(): Promise<void> {
    const debugpy = vscode.extensions.getExtension('ms-python.debugpy')
    if (debugpy) {
        if (!debugpy.isActive) {
            await debugpy.activate()
        }
    }
}

async function getDebuggerPortNumber(): Promise<number> {
    const isPortAvailable = (port: number): Promise<boolean> => {
        return new Promise((resolve) => {
            const socket = new net.Socket()
            socket.setTimeout(1000)
            socket.once('connect', () => {
                // there's a listener already
                socket.destroy()
                resolve(false)
            })
            socket.once('error', (err: any) => {
                // candidate port
                socket.destroy()
                resolve(err.code === 'ECONNREFUSED')
            })
            socket.once('timeout', () => {
                // candidate port
                socket.destroy()
                resolve(true)
            })
            socket.connect(port, '127.0.0.1')
        })
    }
    while (true) {
        const port = randomInt(2048, 59152)
        if (await isPortAvailable(port)) {
            return port
        }
    }
}

async function waitForDebugger(port: number, timeout = 5000): Promise<void> {
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
        try {
            await new Promise<void>((resolve, reject) => {
                const socket = new net.Socket()
                socket.setTimeout(500)
                socket.once('connect', () => {
                    socket.destroy()
                    resolve()
                })
                socket.once('error', (err) => {
                    socket.destroy()
                    reject(err)
                })
                socket.once('timeout', () => {
                    socket.destroy()
                    reject(new Error('Timeout'))
                })
                socket.connect(port, '127.0.0.1')
            })
            return
        } catch (e) {
            await new Promise(r => setTimeout(r, 100))
        }
    }
    throw new Error(`Debugger port ${port} timed out.`)
}

const output: vscode.OutputChannel = vscode.window.createOutputChannel('punit-testadapter')


function getTestPackageName(workspaceFolder: vscode.WorkspaceFolder): string {
    const name = vscode.workspace
        .getConfiguration('punit', workspaceFolder)
        .get<string>('--test-package', 'tests')
        .trim()
        .split(path.sep)
        .filter((v,) => v.length > 0)[0]
    return name
}

function getWatcherPattern(workspaceFolder: vscode.WorkspaceFolder): string {
    return `**/${getTestPackageName(workspaceFolder)}/**/*.py`
}

async function whichPythonExe(workspaceFolder: vscode.WorkspaceFolder): Promise<string> {
    try {
        const python = vscode.extensions.getExtension('ms-python.python')
        if (python) {
            if (!python.isActive) {
                await python.activate()
            }
            if (typeof python.exports?.settings?.getExecutionDetails === 'function') {
                const exedetails = await python.exports?.settings?.getExecutionDetails(workspaceFolder.uri)
                if (exedetails?.execCommand) {
                    return exedetails.execCommand[0]
                }
            }
        }
    } catch (e) {
        const err = <Error>e
        output.appendLine(err.message + '\r\n' + err.stack)
    }
    // failover to workspace config
    const pythonConfig = vscode.workspace.getConfiguration('python')
    const pythonPath = pythonConfig.get<string>('defaultInterpreterPath')
    if (pythonPath && pythonPath.trim().length) { return pythonPath }
    // failover to hardcoded defaults
    // TODO: add verbose option
    // output.appendLine('.. using hardcoded python!')
    return process.platform !== 'win32' ? 'python3' : 'python'
}

async function whichDebugpyPath(): Promise<string> {
    const pythonExtension = vscode.extensions.getExtension('ms-python.debugpy')
    // Check if the specific debugger path helper exists
    return path.dirname(await pythonExtension!.exports.debug.getDebuggerPackagePath())
}

async function computePythonPath(workspaceFolder: vscode.WorkspaceFolder | undefined): Promise<string> {
    const root = !workspaceFolder ? '.' : workspaceFolder.uri.fsPath
    try {
        // if there is a `src` dir, use it
        const srcStat = await vscode.workspace.fs.stat(vscode.Uri.file(path.join(root, 'src')))
        if (srcStat.type === vscode.FileType.Directory) { return path.join(root, 'src') }
    } catch (e) {
        // NOP
        const err = <Error>e
        output.appendLine(err.message + '\r\n' + err.stack)
    }
    // otherwise, use the workspace root
    return root
}

function createWorkspaceFilter(prefix: string): string {
    return `${prefix}*`
}

function createFolderFilter(workspaceFolder: vscode.WorkspaceFolder, folderUri: vscode.Uri, prefix: string): string {
    const basedir = path.join(workspaceFolder.uri.fsPath, getTestPackageName(workspaceFolder))
    const reldir = path.relative(basedir, folderUri.fsPath)
    return `${prefix}${reldir.split(path.sep).join('.')}*`
}

function createModuleFilter(workspaceFolder: vscode.WorkspaceFolder, moduleUri: vscode.Uri, prefix: string): string {
    const { base } = path.parse(moduleUri.fsPath)
    const basedir = path.join(workspaceFolder.uri.fsPath, getTestPackageName(workspaceFolder))
    let reldir = path.relative(basedir, moduleUri.fsPath).replace(base, '')
    if (reldir.length > 0) {
        reldir = `${reldir.replace(/^\/+|\/+$/g, '')}/`
    }
    return `${prefix}${reldir.split(path.sep).join('.')}${base.replace('.py', '/')}*`
}

function createClassFilter(workspaceFolder: vscode.WorkspaceFolder, classUri: vscode.Uri, prefix: string): string {
    const { base } = path.parse(classUri.fsPath)
    const basedir = path.join(workspaceFolder.uri.fsPath, getTestPackageName(workspaceFolder))
    let reldir = path.relative(basedir, classUri.fsPath).replace(base, '')
    if (reldir.length > 0) {
        reldir = `${reldir.replace(/^\/+|\/+$/g, '')}/`
    }
    return `${prefix}${reldir.split(path.sep).join('.')}${base.replace('.py', '/')}${classUri.fragment}/*` // all tests having same 'class' scope
}

function createModuleFunctionFilter(workspaceFolder: vscode.WorkspaceFolder, moduleUri: vscode.Uri, prefix: string): string {
    const { base } = path.parse(moduleUri.fsPath)
    const basedir = path.join(workspaceFolder.uri.fsPath, getTestPackageName(workspaceFolder))
    let reldir = path.relative(basedir, moduleUri.fsPath).replace(base, '')
    if (reldir.length > 0) {
        reldir = `${reldir.replace(/^\/+|\/+$/g, '')}/`
    }
    return `${prefix}${reldir.split(path.sep).join('.')}${base.replace('.py', '')}/${moduleUri.fragment}`
}

function createClassMethodFilter(parent: vscode.TestItem, workspaceFolder: vscode.WorkspaceFolder, moduleUri: vscode.Uri, prefix: string): string {
    const className = parent.id.split('#')[1]
    const { base } = path.parse(moduleUri.fsPath)
    const basedir = path.join(workspaceFolder.uri.fsPath, getTestPackageName(workspaceFolder))
    let reldir = path.relative(basedir, moduleUri.fsPath).replace(base, '')
    if (reldir.length > 0) {
        reldir = `${reldir.replace(/^\/+|\/+$/g, '')}/`
    }
    return `${prefix}${reldir.split(path.sep).join('.')}${base.replace('.py', '')}/${className}/${moduleUri.fragment}`
}

function createFunctionFilter(item: vscode.TestItem, workspaceFolder: vscode.WorkspaceFolder, itemUri: vscode.Uri, prefix: string): string {
    if (item.parent?.id.startsWith('module')) {
        return createModuleFunctionFilter(workspaceFolder, itemUri, prefix)
    } else {
        return createClassMethodFilter(item.parent!, workspaceFolder, itemUri, prefix)
    }
}

function parseUriFromItemId(id: string): vscode.Uri {
    const parts = id.split(':')
    const defrag = parts[2].split('#')
    return (defrag.length > 1)
        ? vscode.Uri.parse(`${parts[1]}:${defrag[0]}#${defrag[1]}`)
        : vscode.Uri.parse(`${parts[1]}:${defrag[0]}`)
}

function getTestFilters(controller: vscode.TestController, items: readonly vscode.TestItem[] | undefined, prefix: string): Map<string, Map<string, vscode.TestItem>> {
    let workspaceFiltersMap = new Map<string, Map<string, vscode.TestItem>>()
    if (items === undefined) {
        vscode.workspace.workspaceFolders?.forEach(workspaceFolder => {
            const workspaceTestItem = controller.items.get(`root:${workspaceFolder.uri}/${getTestPackageName(workspaceFolder)}`)
            if (workspaceTestItem) {
                const filtersTestMap = new Map<string, vscode.TestItem>()
                filtersTestMap.set(`${prefix}*`, workspaceTestItem)
                workspaceFiltersMap.set(workspaceFolder.name, filtersTestMap)
            }
        })
    } else {
        for (const item of items) {
            const itemUri = parseUriFromItemId(item.id)
            const workspaceFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(itemUri)
            if (workspaceFolder) {
                let filtersTestMap: Map<string, vscode.TestItem> | undefined = workspaceFiltersMap.get(workspaceFolder.name)
                if (!filtersTestMap) {
                    filtersTestMap = new Map<string, vscode.TestItem>()
                    workspaceFiltersMap.set(workspaceFolder.name, filtersTestMap)
                }
                if (item.id.startsWith('root:')) {
                    const filter = createWorkspaceFilter(prefix)
                    filtersTestMap.set(filter, item)
                } else if (item.id.startsWith('folder:')) {
                    const filter = createFolderFilter(workspaceFolder, itemUri, prefix)
                    filtersTestMap.set(filter, item)
                } else if (item.id.startsWith('module:')) {
                    const filter = createModuleFilter(workspaceFolder, itemUri, prefix)
                    filtersTestMap.set(filter, item)
                } else if (item.id.startsWith('class:')) {
                    const filter = createClassFilter(workspaceFolder, itemUri, prefix)
                    filtersTestMap.set(filter, item)
                } else if (item.id.startsWith('function:')) {
                    const filter = createFunctionFilter(item, workspaceFolder, itemUri, prefix)
                    filtersTestMap.set(filter, item)
                }
            }
        }
    }
    return workspaceFiltersMap
}

function generateToolArgs(workspaceFolder: vscode.WorkspaceFolder): string[] {
    const args: string[] = []
    args.push('--test-package', getTestPackageName(workspaceFolder))
    args.push('--report', 'json')
    args.push('--filter', '@stdin')
    return args
}

export async function activate(context: vscode.ExtensionContext) {
    await ensureDebuggerActive()
    const controller = vscode.tests.createTestController('punit', 'pUnit Tests')
    context.subscriptions.push(controller)

    function removeModule(uri: vscode.Uri): void {
        destroyTestItem('module', uri)
    }

    function hasDecorator(decorator_list: pyast.ExprNode[] | undefined, decoratorNames: string[]): boolean {
        if (decorator_list) {
            for (let decorator_node of decorator_list) {
                switch (decorator_node.nodeType) {
                    case 'Name':
                        if (decoratorNames.includes((<any>decorator_node).id)) {
                            return true
                        }
                        break
                    case 'Call':
                        for (let decoratorName of decoratorNames) {
                            const call = (<pyast.Call>decorator_node)
                            let id = ''
                            if (call.func.nodeType === 'Name') {
                                id = (call.func as pyast.Name).id;
                            } else if (call.func.nodeType === 'Attribute') {
                                id = (call.func as pyast.Attribute).attr;
                            }
                            if (id === decoratorName) {
                                return true
                            }
                        }
                        break
                    case 'Attribute':
                        if (decoratorNames.includes((<any>decorator_node).attr)) {
                            return true
                        }
                        break
                }
            }
        }
        return false
    }

    const knownTestTags: Map<string, vscode.TestTag> = new Map<string, vscode.TestTag>()
    function getOrCreateTestTag(id: string): vscode.TestTag {
        let exists: vscode.TestTag | undefined = knownTestTags.get(id)
        if (!exists) {
            exists = new vscode.TestTag(id)
            knownTestTags.set(id, exists)
        }
        return exists
    }

    function getTestTags(decorator_list: pyast.ExprNode[] | undefined): vscode.TestTag[] {
        const results: vscode.TestTag[] = []
        if (decorator_list) {
            for (let decorator_node of decorator_list) {
                switch (decorator_node.nodeType) {
                    case 'Call':
                        const call = (<pyast.Call>decorator_node)
                        let id = ''
                        if (call.func.nodeType === 'Name') {
                            id = (call.func as pyast.Name).id;
                        } else if (call.func.nodeType === 'Attribute') {
                            id = (call.func as pyast.Attribute).attr;
                        }
                        if (id === 'trait') {
                            if (call.args.length > 1) {
                                results.push(
                                    getOrCreateTestTag(
                                        `${(<any>call.args[0]).value}:${(<any>call.args[1]).value}`))
                            } else if (call.args.length > 0) {
                                results.push(getOrCreateTestTag((<any>call.args[0]).value))
                            }
                        }
                        break
                }
            }
        }
        return results
    }

    function processAstFunction(uri: vscode.Uri, astFunction: pyast.FunctionDef, parent: vscode.TestItem): vscode.TestItem | undefined {
        if (hasDecorator(astFunction?.decorator_list, ['fact', 'theory'])) {
            const range: vscode.Range = new vscode.Range(
                astFunction.lineno - 1,
                0,
                (astFunction.end_lineno ?? astFunction.lineno + astFunction.body.length),
                0)
            const child = getTestItem('function', uri.with({ fragment: astFunction.name }), astFunction.name, range)
            child.tags = getTestTags(astFunction.decorator_list)
            parent.children.add(child)
            if (hasDecorator(astFunction?.decorator_list, ['theory'])) {
                child.children.forEach(childchild => {
                    destroyTestItem('dyndata', childchild.uri!)
                })
            }
            return child
        }
        return undefined
    }

    function processAstClass(uri: vscode.Uri, astClass: pyast.ClassDef, parent: vscode.TestItem): vscode.TestItem | undefined {
        const classUri = uri.with({ fragment: astClass.name })
        const range: vscode.Range = new vscode.Range(
            astClass.lineno - 1,
            astClass.col_offset,
            astClass.lineno - 1,
            astClass.col_offset + astClass.name.length + 6)
        const child = getTestItem('class', classUri, astClass.name, range)
        const discovered: Set<string> = new Set<string>()
        for (let node of astClass.body) {
            switch (node.nodeType) {
                case 'FunctionDef':
                case 'AsyncFunctionDef':
                    const f = processAstFunction(uri, <pyast.FunctionDef>node, child)
                    if (f) {
                        discovered.add(f.id)
                    }
                    break
                case 'ClassDef':
                    const c = processAstClass(uri, <pyast.ClassDef>node, child)
                    if (c) {
                        discovered.add(c.id)
                    }
                    break
            }
        }
        pruneOrphans(child.children, discovered)
        if (child.children.size > 0) {
            parent.children.add(child)
            return child
        } else {
            destroyTestItem('class', classUri)
            return undefined
        }
    }

    function pruneOrphans(items: vscode.TestItemCollection, keeplist: Set<string>): void {
        for (const [id] of items) {
            if (!keeplist.has(id)) {
                const parts = id.split(':')
                const typeName = parts[0]
                parts.shift()
                const uri = parts.join(':')
                destroyTestItem(typeName, vscode.Uri.parse(uri))
                items.delete(id)
            }
        }
    }

    function processAstModule(uri: vscode.Uri, astModule: pyast.Module, parent: vscode.TestItem): vscode.TestItem | undefined {
        const moduleName = uri.path.split('/').reverse()[0]
        const child = getTestItem('module', uri, moduleName, undefined)
        const discovered: Set<string> = new Set<string>()
        for (let node of astModule.body) {
            switch (node.nodeType) {
                case 'FunctionDef':
                case 'AsyncFunctionDef':
                    const f = processAstFunction(uri, <pyast.FunctionDef>node, child)
                    if (f) {
                        discovered.add(f.id)
                    }
                    break
                case 'ClassDef':
                    const c = processAstClass(uri, <pyast.ClassDef>node, child)
                    if (c) {
                        discovered.add(c.id)
                    }
                    break
            }
        }
        parent.children.add(child)
        return child
    }

    const testItems: Map<string, vscode.TestItem> = new Map<string, vscode.TestItem>()
    function getTestItem(type: string, uri: vscode.Uri, name: string, range?: vscode.Range): vscode.TestItem {
        const key = `${type}:${uri}`
        let item = testItems.get(key)
        if (!item) {
            item = controller.createTestItem(
                key,
                name,
                uri.with({ fragment: '' }))
            item.canResolveChildren = (type !== 'dyndata') && (type !== 'function')
            testItems.set(key, item)
        }
        if (range) {
            item.range = range
        }
        return item
    }
    function destroyTestItem(type: string, uri: vscode.Uri) {
        const key = `${type}:${uri}`
        const existing = testItems.get(key)
        if (existing) {
            testItems.delete(key)
            existing.parent?.children.delete(existing.id)
        }
    }
    function getTestItemFromParsedTestResult(workspaceFolder: vscode.WorkspaceFolder, parsedTestResult: ParsedTestResult): vscode.TestItem | undefined {
        const dataparts = parsedTestResult.name.split('(')
        const parts = dataparts[0].split('/')
        const moduleParts = parts[0].split('.')
        const workspaceItem = controller.items.get(`root:${workspaceFolder.uri}/${getTestPackageName(workspaceFolder)}`)!
        let qnitem: vscode.TestItem = workspaceItem
        for (const modulePart of moduleParts) {
            qnitem.children.forEach(e => {
                if (e.label === modulePart || e.label === `${modulePart}.py`) {
                    qnitem = e
                    return false
                }
                return true
            })
        }
        for (let i = 1; i < parts.length; i++) {
            qnitem.children.forEach(e => {
                if (e.label === parts[i]) {
                    qnitem = e
                    return false
                }
                return true
            })
        }
        if (qnitem && dataparts.length > 1) {
            // this test ran "with data" so we dynamically create "data-specific" test items instead of returning the parent item
            dataparts.shift()
            const the_data: string = `(${dataparts.join(',')}`.replace(',)', ')')
            const dyndata_hash = Buffer.from(parsedTestResult.name).toString('base64')
            const dyndata_item = getTestItem('dyndata', qnitem.uri!.with({ fragment: dyndata_hash }), `${qnitem.label}${the_data}}`, qnitem.range)
            qnitem.children.add(dyndata_item)
            return dyndata_item
        } else {
            return qnitem
        }
    }

    function isTestCandidate(content: string): boolean {
        return content.includes('import punit') || content.includes('from punit')
    }

    function ensureWorkspaceItems() {
        vscode.workspace.workspaceFolders?.forEach(workspaceFolder => {
            const testPackageName = getTestPackageName(workspaceFolder)
            const testPackageUri = vscode.Uri.joinPath(workspaceFolder.uri, testPackageName)
            const workspaceItem = getTestItem('root', testPackageUri, workspaceFolder.name)
            controller.items.add(workspaceItem)
        })
    }

    async function processFolder(item: vscode.TestItem) {
        let folderUri = item.uri!
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(folderUri)
        if (workspaceFolder) {
            if (workspaceFolder.uri === item.uri) {
                const testPackageName = getTestPackageName(workspaceFolder)
                folderUri = vscode.Uri.joinPath(folderUri, testPackageName)
            }
            try {
                const entries = [...await fs.readdir(folderUri.fsPath, { withFileTypes: true })]
                for (const entry of entries) {
                    if (entry.name.startsWith('__') && entry.name.endsWith('__')) {
                        // ignore dunder files/folders) such as `__pycache__`, unless they have an extension like `__init__.py`
                        continue
                    }
                    const entryUri = vscode.Uri.file(path.join(folderUri!.fsPath, entry.name))
                    try {
                        if (entry.isDirectory()) {
                            const child = getTestItem('folder', entryUri, entry.name)
                            item.children.add(child)
                            await processFolder(child)
                        } else if (entry.isFile() && entry.name.endsWith('.py')) {
                            const buf = await vscode.workspace.fs.readFile(entryUri)
                            const content = new TextDecoder('utf-8', { fatal: false }).decode(buf)
                            if (isTestCandidate(content)) {
                                const astModule: pyast.Module = pyast.parse(content)
                                processAstModule(entryUri, astModule, item)
                            }
                        }
                    } catch (e) {
                        const err = <Error>e
                        output.appendLine(err.message + '\r\n' + err.stack)
                    }
                }
                if (item.children.size === 0) {
                    const itemType = item.id.split(':')[0]
                    if (itemType === 'folder') {
                        ///destroyTestItem(itemType, item.uri!)
                    }
                }
            } catch (e) {
                const err = <Error>e
                output.appendLine(err.message + '\r\n' + err.stack)
            }
        }
    }

    async function handleChange(uri: vscode.Uri): Promise<void> {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)
        if (!workspaceFolder) {
            output.appendLine(`cannot map uri "${uri}" to a workspace folder.`)
            return
        }
        const remainingPathParts = uri.toString(true).replace(workspaceFolder.uri.toString(true), '').split('/')
        let parent: vscode.TestItem = getTestItem('root', workspaceFolder.uri, workspaceFolder.name)
        let folderUri = workspaceFolder.uri
        for (let index = 0; index < remainingPathParts.length; index++) {
            const pathPart = remainingPathParts[index]
            if (pathPart.length === 0) {
                continue
            } else if (pathPart.endsWith('.py')) {
                try {
                    const entryUri = vscode.Uri.joinPath(folderUri, pathPart)
                    const buf = await vscode.workspace.fs.readFile(entryUri)
                    const content = new TextDecoder('utf-8', { fatal: false }).decode(buf)
                    destroyTestItem('module', entryUri)
                    if (isTestCandidate(content)) {
                        const astModule: pyast.Module = pyast.parse(content)
                        processAstModule(entryUri, astModule, parent)
                    }
                } catch (e) {
                    const err = <Error>e
                    output.appendLine(err.message + '\r\n' + err.stack)
                }
            } else {
                folderUri = vscode.Uri.joinPath(folderUri, pathPart)
                parent = getTestItem('folder', folderUri, pathPart)
            }
        }
    }

    function updateTestItemWithResult(testRun: vscode.TestRun, item: vscode.TestItem, testResult: ParsedTestResult): boolean {
        let anyFailed: boolean = false
        switch (testResult.status) {
            case 'pass':
                if (testResult.message) {
                    testRun.appendOutput(testResult.message.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'), undefined, item)
                }
                testRun.passed(item, testResult.took)
                break
            case 'fail':
                testRun.failed(item, new vscode.TestMessage(testResult.message!), testResult.took)
                break
            case 'skip':
                testRun.skipped(item)
                break
            case 'error':
                testRun.errored(item, new vscode.TestMessage(testResult.message!), testResult.took)
                break
        }
        return anyFailed
    }

    async function performTestRun(mode: string, request: vscode.TestRunRequest, cancellationToken: vscode.CancellationToken): Promise<void> {
        const isDebugRun = mode.indexOf('debug') > -1
        const isCoverageRun = mode.indexOf('coverage') > -1
        const testRun = controller.createTestRun(request)
        try {
            if (!vscode.workspace.workspaceFolders?.[0]) {
                output.appendLine('No workspace folder(s), aborting.\r\n')
                output.show(true)
            } else {
                const includedWorkspaceFiltersMap = getTestFilters(controller, request.include, '')
                const excludedWorkspaceFiltersMap = getTestFilters(controller, request.exclude, '!')
                for (let workspaceFolder of vscode.workspace.workspaceFolders) {
                    const includedFilterItemMap = includedWorkspaceFiltersMap.get(workspaceFolder.name)
                    const includedTestFilters = includedFilterItemMap ? [...includedFilterItemMap.keys()] : []
                    const excludedFilterItemMap = excludedWorkspaceFiltersMap.get(workspaceFolder.name)
                    const excludedTestFilters = excludedFilterItemMap ? [...excludedFilterItemMap.keys()] : []
                    const aggregateTestFilters = [...excludedTestFilters, ...includedTestFilters].join('\n')
                    if (aggregateTestFilters.length === 0) {
                        continue
                    }
                    const punitArgs = generateToolArgs(workspaceFolder)
                    const pythonExe = await whichPythonExe(workspaceFolder)
                    const pythonPath = isDebugRun
                        ? `${await computePythonPath(workspaceFolder)}${path.delimiter}${await whichDebugpyPath()}`
                        : await computePythonPath(workspaceFolder)
                    const pythonEnv = { ...process.env, PYTHONPATH: pythonPath, PYTHONUNBUFFERED: '1' }
                    let pythonArgs = ['-m', 'punit', ...punitArgs]
                    if (isCoverageRun) {
                        // relies on standard python `coverage` tool, simply injects it as a module resulting in using the 'correct' venv
                        // TODO: produce a coverage report (extension settings)
                        // TODO: support arbitrary coverage args/options (extension settings)
                        pythonArgs = ['-m', 'coverage', 'run', ...pythonArgs]
                    }
                    let debuggerPortNumber: number | undefined = undefined
                    let debugWaiter: Thenable<boolean> | undefined = undefined
                    if (isDebugRun) {
                        debuggerPortNumber = await getDebuggerPortNumber()
                        pythonArgs = ['-m', 'debugpy', '--connect', `0.0.0.0:${debuggerPortNumber}`, ...pythonArgs]
                        const debugConfig: vscode.DebugConfiguration = {
                            name: 'Attach to pUnit',
                            type: 'debugpy',
                            request: 'attach',
                            listen: {
                                host: '127.0.0.1',
                                port: debuggerPortNumber
                            },
                            pathMappings: [
                                {
                                    localRoot: workspaceFolder.uri.fsPath,
                                    remoteRoot: workspaceFolder.uri.fsPath
                                }
                            ],
                            justMyCode: true,
                            console: 'integratedTerminal',
                            redirectOutput: true
                        }
                        const debugSessionOptions: vscode.DebugSessionOptions = {
                            suppressDebugView: true
                        }
                        debugWaiter = vscode.debug.startDebugging(workspaceFolder, debugConfig, debugSessionOptions)

                        setTimeout(async () => {
                            await vscode.debug.startDebugging(workspaceFolder, debugConfig).then(success => {
                                if (success) {
                                    const debuggerSession = vscode.debug.activeDebugSession!
                                    const debuggerDisposables: vscode.Disposable[] = []
                                    debuggerDisposables.push(
                                        vscode.debug.onDidTerminateDebugSession(s => {
                                            if (s.id === debuggerSession.id) {
                                                ps.kill()
                                            }
                                        })
                                    )
                                }
                            })
                        }, 0)
                        await waitForDebugger(debuggerPortNumber, 5000)
                    }

                    pythonArgs = ['-Xfrozen_modules=off', ...pythonArgs]
                    const ps = cp.spawn(
                        pythonExe,
                        pythonArgs,
                        {
                            cwd: workspaceFolder.uri.fsPath,
                            env: pythonEnv,
                            shell: false,
                            stdio: ["pipe", "overlapped", "overlapped"]
                        })

                    ps.stdin!.write(aggregateTestFilters, "utf8", err => {
                        if (err) {
                            ps.kill()
                        }
                        ps.stdin!.end()
                    })
                    cancellationToken.onCancellationRequested(() => {
                        output.appendLine('.. cancellation detected.')
                        if (!ps.killed) {
                            ps.kill()
                        }
                    })

                    const collectedResults: string[] = []
                    const stdout_decoder = new TextDecoder('utf-8')
                    ps.stdout.on('data', chunk => {
                        const testResult = stdout_decoder.decode(chunk, { stream: false })
                        collectedResults.push(testResult)
                    })
                    const stderr_decoder = new TextDecoder('utf-8')
                    ps.stderr.on('data', chunk => {
                        const line = stderr_decoder.decode(chunk, { stream: false }).replace('\n', '\r\n')
                        output.appendLine(line)
                    })

                    // `once` returns a promise that resolves with the event arguments
                    const closePromise = once(ps, 'close') as Promise<[number | null, NodeJS.Signals | null]>
                    const errorPromise = once(ps, 'error') as Promise<[Error]>

                    // Race the two: if `error` fires first we reject, otherwise we resolve with close args
                    await Promise.race([
                        closePromise.then(([code,]) => {
                            if (code && code !== 0) {
                                // NOP
                            }
                        }),
                        errorPromise.then(([e]) => {
                            const err = <Error>e
                            output.appendLine(err.message + '\r\n' + err.stack)
                        })
                    ])

                    // process test results
                    const testResultsJson = collectedResults.join(' ')
                    try {
                        const testResults = JSON.parse(testResultsJson)
                        for (const testResult of testResults) {
                            const executedTestItem = getTestItemFromParsedTestResult(workspaceFolder, <ParsedTestResult>testResult)
                            if (executedTestItem) {
                                updateTestItemWithResult(testRun, executedTestItem, testResult)
                            }
                        }
                    } catch (e) {
                        const err = <Error>e
                        output.appendLine(err.message + '\r\n' + err.stack)
                        const workspaceItem = controller.items.get(`root:${workspaceFolder.uri}/${getTestPackageName(workspaceFolder)}`)
                        if (workspaceItem) {
                            updateTestItemWithResult(testRun, workspaceItem, <ParsedTestResult>{
                                name: workspaceFolder.name,
                                status: testResultsJson.length === 0 ? 'skip' : 'error',
                                message: testResultsJson.length === 0 ? 'No Tests Run' : testResultsJson,
                                took: 0
                            })
                        }
                    }
                }
            }
        } finally {
            testRun.end()
        }
    }

    // configure "run profiles"
    const testRunProfile = controller.createRunProfile(
        'Run',
        vscode.TestRunProfileKind.Run,
        async (request, token): Promise<void> =>
            performTestRun('run', request, token))

    const debugRunProfile = controller.createRunProfile(
        'Debug',
        vscode.TestRunProfileKind.Debug,
        async (request, token): Promise<void> =>
            await performTestRun('debug', request, token))

    const coverageRunProfile = controller.createRunProfile(
        'Coverage',
        vscode.TestRunProfileKind.Coverage,
        async (request, token): Promise<void> =>
            await performTestRun('coverage', request, token))

    context.subscriptions.push(testRunProfile)
    context.subscriptions.push(debugRunProfile)
    context.subscriptions.push(coverageRunProfile)

    let resolverLock: Promise<void> = Promise.resolve()
    const activeResolves: Set<string> = new Set<string>()

    async function discoverTestItems(item?: vscode.TestItem) {
        const guardId = item?.id ?? '__root__'
        if (!activeResolves.has(guardId)) {
            activeResolves.add(guardId)
            resolverLock = resolverLock.then(async () => {
                if (!item) {
                    ensureWorkspaceItems()
                } else {
                    if (item.id.startsWith('folder') || item.id.startsWith('root')) {
                        await processFolder(item)
                    } else if (item.id.startsWith('module')) {
                        try {
                            const buf = await vscode.workspace.fs.readFile(item.uri!)
                            const content = new TextDecoder('utf-8', { fatal: false }).decode(buf)
                            if (isTestCandidate(content)) {
                                const astModule: pyast.Module = pyast.parse(content)
                                processAstModule(item.uri!, astModule, item.parent!)
                            }
                        } catch (e) {
                            const err = <Error>e
                            output.appendLine(err.message + '\r\n' + err.stack)
                        }
                    }
                }
            }).finally(() => {
                activeResolves.delete(guardId)
            })
            await resolverLock
        }
    }

    controller.resolveHandler = discoverTestItems

    controller.refreshHandler = async () => {
        // evicting from own list to ensure anything we extend into it later has proper upkeep on refresh
        for (const [id,] of testItems) {
            const parts = id.split(':')
            const typeName = parts[0]
            parts.shift()
            const uri = parts.join(':')
            destroyTestItem(typeName, vscode.Uri.parse(uri))
        }
        ensureWorkspaceItems()
        refreshWatchers()
        for (const [, rootItem] of controller.items) {
            await controller.resolveHandler!(rootItem)
        }
    }

    let watchers: vscode.FileSystemWatcher[] = []
    function refreshWatchers(): void {
        for (let watcher of watchers) {
            watcher.dispose()
        }
        vscode.workspace.workspaceFolders?.forEach(workspaceFolder => {
            const pattern = getWatcherPattern(workspaceFolder)
            const watcher = vscode.workspace.createFileSystemWatcher(pattern)
            watcher.onDidCreate(handleChange)
            watcher.onDidChange(handleChange)
            watcher.onDidDelete(removeModule)
            context.subscriptions.push(watcher)
            watchers.push(watcher)
        })
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            refreshWatchers()
            ensureWorkspaceItems()
        })
    )
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('punit.--test-package')) {
                refreshWatchers()
            }
        })
    )
    refreshWatchers()
    ensureWorkspaceItems()
}

export function deactivate() { }
