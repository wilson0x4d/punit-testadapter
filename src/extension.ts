// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

import * as cp from 'child_process'
import { once } from 'events'
import * as path from 'node:path'
import * as net from 'net'
import { randomInt } from 'node:crypto'
import * as vscode from 'vscode'
import { AstService } from './ast_service'
import { extractTestResults, ParsedTestResult as SharedParsedTestResult } from './test-results'
import { isTestCandidate } from './test-candidate'
import { getTestPackageName, getParallelism, whichPythonExe, whichDebugpyPath, getPythonPath, getJustMyCode } from './config'
import { ensureDebuggerActive, waitForDebugger as waitForDebuggerPort } from './debug'
import { getTestFilters } from './uris'
import {
    generateToolArgs,
    updateTestItemWithResult,
    getTestItemFromParsedTestResult,
} from './execution'
import {
    DiscoveryContext,
    ensureWorkspaceItems,
    processFolder as discoverProcessFolder,
    handleChange as discoveryHandleChange,
    refreshWatchers as discoveryRefreshWatchers,
} from './discovery'

// Use the shared type from test-results.ts instead of duplicating.
type ParsedTestResult = SharedParsedTestResult

export { isTestCandidate } from './test-candidate'
export { extractTestResults } from './test-results'

/** Re-export for backwards compatibility. */
export { getTestFilters, getTestPackageName, getParallelism, whichPythonExe, whichDebugpyPath, getPythonPath, getJustMyCode }

const output: vscode.OutputChannel = vscode.window.createOutputChannel('punit-testadapter')

let astService: AstService | null = null

// ── debug session port helpers (inline: needs to be sync with performTestRun state) ──

async function findPort(): Promise<number> {
    const isPortAvailable = (port: number): Promise<boolean> =>
        new Promise(resolve => {
            const socket = new net.Socket()
            socket.setTimeout(1000)
            socket.once('connect', () => { socket.destroy(); resolve(false) })
            socket.once('error', (err: any) => { socket.destroy(); resolve(err.code === 'ECONNREFUSED') })
            socket.once('timeout', () => { socket.destroy(); resolve(true) })
            socket.connect(port, '127.0.0.1')
        })
    while (true) {
        const port = randomInt(2048, 59152)
        if (await isPortAvailable(port)) {return port}
    }
}

// ── test execution ──────────────────────────────────────────────────────────

async function performTestRun(
    mode: string,
    request: vscode.TestRunRequest,
    cancellationToken: vscode.CancellationToken,
    ctx: DiscoveryContext,
): Promise<void> {
    const isDebugRun = mode.indexOf('debug') > -1
    const isCoverageRun = mode.indexOf('coverage') > -1
    const testRun = ctx.controller.createTestRun(request)
    let activeDebugSession: vscode.DebugSession | undefined
    let debugCleanupDone = false

    function terminateActiveDebugSession(): void {
        if (activeDebugSession) {
            vscode.commands.executeCommand('workbench.action.debug.stop', activeDebugSession.id)
        }
        activeDebugSession = undefined
    }

    try {
        if (!vscode.workspace.workspaceFolders?.[0]) {
            output.appendLine('No workspace folder(s), aborting.\r\n')
            output.show(true)
        } else {
            for (const workspaceFolder of vscode.workspace.workspaceFolders) {
                const includedFilterItemMap = getTestFilters(ctx.controller, request.include, '').get(workspaceFolder.name)
                const includedTestFilters = includedFilterItemMap ? [...includedFilterItemMap.keys()] : []
                const excludedFilterItemMap = getTestFilters(ctx.controller, request.exclude, '!').get(workspaceFolder.name)
                const excludedTestFilters = excludedFilterItemMap ? [...excludedFilterItemMap.keys()] : []
                const aggregateTestFilters = [...excludedTestFilters, ...includedTestFilters].join('\n')
                if (aggregateTestFilters.length === 0) {continue}

                const punitArgs = generateToolArgs(workspaceFolder)
                const parallelism = getParallelism(workspaceFolder)
                if (parallelism && !isDebugRun) {
                    punitArgs.push('--parallelism')
                }
                const pythonExe = await whichPythonExe(workspaceFolder, output)
                const pythonPath = isDebugRun
                    ? `${await getPythonPath(workspaceFolder)}${path.delimiter}${await whichDebugpyPath()}`
                    : await getPythonPath(workspaceFolder)
                let pythonEnv: Record<string, string | undefined> = {
                    ...process.env,
                    PYTHONPATH: pythonPath,
                    PYTHONUNBUFFERED: '1',
                    DEBUG_UNCAUGHT_EXCEPTIONS: '0',
                }
                let pythonArgs: string[] = ['-m', 'punit', ...punitArgs]
                if (isCoverageRun) {
                    pythonArgs = ['-m', 'coverage', 'run', '--save-signal=USR1', ...pythonArgs]
                    pythonEnv.COVERAGE_RUN = 'True'
                }

                let debuggerPortNumber: number | undefined
                let ps: cp.ChildProcess | undefined

                if (isDebugRun) {
                    debuggerPortNumber = await findPort()
                    pythonArgs = ['-m', 'debugpy', '--connect', `0.0.0.0:${debuggerPortNumber}`, ...pythonArgs]
                    pythonEnv.DEBUG_RUN = 'True'
                    const debugConfig: vscode.DebugConfiguration = {
                        name: 'Attach to pUnit',
                        type: 'debugpy',
                        request: 'attach',
                        listen: { host: '127.0.0.1', port: debuggerPortNumber },
                        pathMappings: [{ localRoot: workspaceFolder.uri.fsPath, remoteRoot: workspaceFolder.uri.fsPath }],
                        justMyCode: getJustMyCode(workspaceFolder),
                        console: 'integratedTerminal',
                        redirectOutput: true,
                    }
                    const debugSessionOptions: vscode.DebugSessionOptions = { testRun }

                    const startPortWatchdog = () => {
                        const watchdogTimer = setInterval(() => {
                            if (ps?.killed || !activeDebugSession) { return }
                            const socket = new net.Socket()
                            socket.setTimeout(300)
                            socket.on('error', () => {
                                if (!debugCleanupDone && !ps!.killed && ps!.exitCode === null) {
                                    output.appendLine('.. debugpy port unreachable, cleaning up.')
                                    debugCleanupDone = true
                                    activeDebugSession = undefined
                                    vscode.commands.executeCommand('workbench.action.debug.stop')
                                    ps!.kill()
                                }
                                socket.destroy()
                            })
                            socket.on('timeout', () => { socket.destroy() })
                            socket.connect(debuggerPortNumber!, '127.0.0.1')
                        }, 2000)
                    }

                    setTimeout(async () => {
                        try {
                            const success = await vscode.debug.startDebugging(workspaceFolder, debugConfig, debugSessionOptions)
                            if (!success) {return}
                            const stopListeners: vscode.Disposable[] = [
                                vscode.debug.onDidStartDebugSession(session => {
                                    if (session.name.includes('pUnit')) {activeDebugSession = session}
                                }),
                                vscode.debug.onDidTerminateDebugSession(() => {
                                    if (debugCleanupDone) {return}
                                    debugCleanupDone = true
                                    terminateActiveDebugSession()
                                    if (ps) {ps.kill()}
                                }),
                                vscode.debug.onDidChangeActiveDebugSession(() => {
                                    if (!activeDebugSession && !ps?.killed && ps?.exitCode === null && !debugCleanupDone) {
                                        output.appendLine('.. detected active-debug-session cleared while process alive, cleaning up.')
                                        debugCleanupDone = true
                                        activeDebugSession = undefined
                                        vscode.commands.executeCommand('workbench.action.debug.stop')
                                        ps?.kill()
                                    }
                                }),
                            ]
                            startPortWatchdog()
                            // Watchdog auto-runs; cleaned up by process exit
                        } catch {
                            terminateActiveDebugSession()
                        }
                    }, 0)
                    await waitForDebuggerPort(debuggerPortNumber, 5000)
                }

                pythonArgs = ['-Xfrozen_modules=off', ...pythonArgs]
                ps = cp.spawn(
                    pythonExe,
                    pythonArgs,
                    {
                        cwd: workspaceFolder.uri.fsPath,
                        env: pythonEnv,
                        shell: false,
                        stdio: 'pipe',
                    },
                )

                ps.stdin!.write(aggregateTestFilters, 'utf8', err => {
                    if (err) {ps.kill()}
                    ps.stdin!.end()
                })
                cancellationToken.onCancellationRequested(() => {
                    output.appendLine('.. cancellation detected.')
                    if (!ps.killed) {ps.kill()}
                })

                const collectedResults: string[] = []
                const stdout_decoder = new TextDecoder('utf-8')
                ps.stdout!.on('data', chunk => {
                    collectedResults.push(stdout_decoder.decode(chunk, { stream: false }))
                })
                const stderr_decoder = new TextDecoder('utf-8')
                ps.stderr!.on('data', chunk => {
                    output.appendLine(stderr_decoder.decode(chunk, { stream: false }).replace('\n', '\r\n'))
                })

                const closePromise = once(ps, 'exit') as Promise<[number | null, NodeJS.Signals | null]>
                const errorPromise = once(ps, 'error') as Promise<[Error]>
                const processDeadPromise = new Promise<number>(resolve => {
                    const interval = setInterval(() => {
                        try { ps.kill(0) } catch {
                            clearInterval(interval)
                            resolve(ps.exitCode ?? 1)
                        }
                    }, 100)
                })

                let exitCode: number = 0
                await Promise.race([
                    closePromise.then(([code]) => {
                        if (code && code !== 0) {exitCode = code}
                        terminateActiveDebugSession()
                    }),
                    errorPromise.then(([e]) => {
                        const err = <Error>e
                        output.appendLine(err.message + '\r\n' + err.stack)
                        terminateActiveDebugSession()
                    }),
                    processDeadPromise.then(code => {
                        exitCode = code
                        terminateActiveDebugSession()
                    }),
                ])

                // Process results
                if (exitCode === 0 || exitCode === 119) {
                    const raw_output = collectedResults.join(' ')
                    try {
                        const testResults = extractTestResults<ParsedTestResult[]>(raw_output)
                        for (const testResult of testResults) {
                            const executedTestItem = getTestItemFromParsedTestResult(workspaceFolder, ctx.controller, testResult)
                            if (executedTestItem) {
                                updateTestItemWithResult(testRun, executedTestItem, testResult)
                            }
                        }
                    } catch (e) {
                        const err = <Error>e
                        output.appendLine(err.message + '\r\n' + err.stack)
                        const workspaceItem = ctx.controller.items.get(
                            `root:${workspaceFolder.uri}/${getTestPackageName(workspaceFolder)}`,
                        )
                        if (workspaceItem) {
                            updateTestItemWithResult(testRun, workspaceItem,
                                { name: workspaceFolder.name, status: raw_output.length === 0 ? 'skip' : 'error',
                                  message: raw_output.length === 0 ? 'No Tests Run' : raw_output, took: 0 })
                        }
                    }
                } else {
                    const workspaceItem = ctx.controller.items.get(
                        `root:${workspaceFolder.uri}/${getTestPackageName(workspaceFolder)}`,
                    )
                    if (workspaceItem) {
                        let message = `pUnit failed to run (EXITCODE:${exitCode})`
                        switch (exitCode) {
                            case 1: message += ' \r\nMost likely means pUnit is not installed as a development dependency, install pUnit as a dependency in the affected workspace(s).' ; break
                            case 4: message += ' \r\nThe version of pUnit installed is too old, try upgrading to the latest version in the affected workspace(s).' ; break
                        }
                        updateTestItemWithResult(testRun, workspaceItem,
                            { name: workspaceFolder.name, status: 'error', message, took: 0 })
                    }
                }
            }
        }
    } finally {
        testRun.end()
    }
}

// ── extension entry point ───────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<{ controller: vscode.TestController }> {
    await ensureDebuggerActive()
    const extensionUri = context.extensionUri
    const controller = vscode.tests.createTestController('punit', 'pUnit Tests')
    context.subscriptions.push(controller)

    // Resolve AstService with lazy initialization
    const pythonExeResolver = async () => {
        const firstFolder = vscode.workspace.workspaceFolders?.[0]
        if (!firstFolder) {throw new Error('No workspace folder')}
        return await whichPythonExe(firstFolder, output)
    }

    // Shared discovery context manages test item state
    const ctx = new DiscoveryContext(controller, output, extensionUri, pythonExeResolver)
    // Expose single accessor for use in discovery handlers
    const getAstService = async () => {
        if (!astService) {
            astService = await ctx.astServiceGetter()
        }
        return astService
    }

    // Override the context's astServiceGetter to reuse the module-level astService
    const originalGetter = ctx.astServiceGetter
    ctx.astServiceGetter = async () => {
        if (!astService) {astService = await originalGetter()}
        return astService
    }

    // ── Test profiles ──
    const runProfile = controller.createRunProfile(
        'Run', vscode.TestRunProfileKind.Run,
        async (request, token) => performTestRun('run', request, token, ctx),
    )
    const debugProfile = controller.createRunProfile(
        'Debug', vscode.TestRunProfileKind.Debug,
        async (request, token) => performTestRun('debug', request, token, ctx),
    )
    const coverageProfile = controller.createRunProfile(
        'Coverage', vscode.TestRunProfileKind.Coverage,
        async (request, token) => performTestRun('coverage', request, token, ctx),
    )
    context.subscriptions.push(runProfile, debugProfile, coverageProfile)

    // ── Test discovery scheduling ──
    let resolverLock: Promise<void> = Promise.resolve()
    const activeResolves: Set<string> = new Set<string>()

    async function discoverTestItems(item?: vscode.TestItem): Promise<void> {
        const guardId = item?.id ?? '__root__'
        if (!activeResolves.has(guardId)) {
            activeResolves.add(guardId)
            resolverLock = resolverLock.then(async () => {
                if (!item) {
                    ensureWorkspaceItems(ctx)
                } else if (item.id.startsWith('folder') || item.id.startsWith('root')) {
                    await discoverProcessFolder(ctx, item)
                } else if (item.id.startsWith('module')) {
                    try {
                        const buf = await vscode.workspace.fs.readFile(item.uri!)
                        const content = new TextDecoder('utf-8', { fatal: false }).decode(buf)
                        if (isTestCandidate(content)) {
                            const astModule = await (await getAstService()).parseFile(content)
                            const discovery = await import('./discovery')
                            discovery.processAstModule(ctx, item.uri!, astModule, item.parent!)
                        }
                    } catch (e) {
                        const err = <Error>e
                        output.appendLine(err.message + '\r\n' + err.stack)
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
        for (const [id] of ctx.testItems) {
            const parts = id.split(':')
            parts.shift()
            ctx.testItems.delete(id)
        }
        ensureWorkspaceItems(ctx)
        discoveryRefreshWatchers(ctx, context)
        for (const [, rootItem] of controller.items) {
            await controller.resolveHandler!(rootItem)
        }
    }

    // ── Event subscriptions ──
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            discoveryRefreshWatchers(ctx, context)
            ensureWorkspaceItems(ctx)
        }),
    )
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('punit.--test-package')) {
                discoveryRefreshWatchers(ctx, context)
            }
        }),
    )

    // ── Initial state ──
    discoveryRefreshWatchers(ctx, context)
    ensureWorkspaceItems(ctx)
    // Trigger initial discovery so the tree is populated for tests/profiles
    for (const [, rootItem] of controller.items) {
        await (controller.resolveHandler!(rootItem) as Promise<void>).catch(() => { /* ignore */ })
    }

    (globalThis as Record<string, unknown>).punitTestController = controller
    ;(globalThis as Record<string, unknown>).punitDebugProfile = debugProfile
    return { controller }
}

export async function deactivate(): Promise<void> {
    if (astService) {
        await astService.shutdown().catch(() => { /* ignore */ })
    }
}
