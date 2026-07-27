// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * AstService -- manages a long-running Python AST background process.
 *
 * Communicates via JSON-over-lines on stdin/stdout pipes (JSON-RPC 2.0 style).
 * Service is spawned lazily on first use and auto-restarts if the process dies.
 */

import { ChildProcess, spawn } from 'child_process'
import * as crypto from 'node:crypto'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { AstNode, Module } from './py_ast_types'
import type { JsonRpcResponse } from './json_rpc_types'

// ── constants ────────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 30_000

// ── types ────────────────────────────────────────────────────────────────────

interface PendingRequest {
    moduleResolve: ((value: Module) => void) | null
    reject: (reason: Error) => void
    timer: ReturnType<typeof setTimeout>
}

// ── class ────────────────────────────────────────────────────────────────────

export class AstService {

    private readonly __pythonExe: string
    /** Absolute path to the AST service Python script. */
    private readonly __svcPath: string
    private __child: ChildProcess | null = null
    private __nextId = 1
    private __pending = new Map<number, PendingRequest>()
    private __buffer = ''
    private __started = false

    constructor(pythonExe: string, workspaceRootOrSvcPath: string | vscode.Uri, svcPath?: string) {
        this.__pythonExe = pythonExe
        // Support either a raw workspace root (backward compat) or an extension Uri.
        if (typeof workspaceRootOrSvcPath === 'string' && path.isAbsolute(workspaceRootOrSvcPath)) {
            // Caller passed absolute path directly as the second arg — likely svcPath already.
            this.__svcPath = workspaceRootOrSvcPath
        } else if (workspaceRootOrSvcPath instanceof vscode.Uri) {
            // context.extensionUri is already the extension root; just append resources/.
            this.__svcPath = path.join(workspaceRootOrSvcPath.fsPath, 'resources', 'ast_service.py')
        } else if (svcPath && path.isAbsolute(svcPath)) {
            // Explicit svcPath provided.
            this.__svcPath = svcPath
        } else {
            // Fallback to workspace-relative.
            this.__svcPath = path.resolve(
                <string>workspaceRootOrSvcPath, 'resources', 'ast_service.py')
        }
    }

    // ── public API ────────────────────────────────────────────────────────

    /** Parse source code string and return a Module node. */
    async parseFile(source: string): Promise<Module> {
        await this.__ensureStarted()
        const id = this.__nextId++
        let moduleResolve!: (value: Module) => void
        let moduleReject!: (reason: Error) => void
        const promise = new Promise<Module>((resolve, reject) => {
            moduleResolve = resolve
            moduleReject = reject
        })
        const timer = setTimeout(() => {
            this.__pending.delete(id)
            moduleReject(new Error('AST service parse timed out'))
        }, REQUEST_TIMEOUT_MS)
        this.__pending.set(id, { moduleResolve, reject: (reason: Error) => {
            clearTimeout(timer)
            moduleReject(reason)
            this.__pending.delete(id)
        }, timer })
        this.__writeLine({ jsonrpc: '2.0', method: 'parseFile', params: { source }, id })
        return promise
    }

    /** Parse a file on disk and return a Module node. */
    async parseFileAtPath(filePath: string): Promise<Module> {
        await this.__ensureStarted()
        const id = this.__nextId++
        let moduleResolve!: (value: Module) => void
        let moduleReject!: (reason: Error) => void
        const promise = new Promise<Module>((resolve, reject) => {
            moduleResolve = resolve
            moduleReject = reject
        })
        const timer = setTimeout(() => {
            this.__pending.delete(id)
            moduleReject(new Error('AST service parse timed out'))
        }, REQUEST_TIMEOUT_MS)
        this.__pending.set(id, { moduleResolve, reject: (reason: Error) => {
            clearTimeout(timer)
            moduleReject(reason)
            this.__pending.delete(id)
        }, timer })
        this.__writeLine({ jsonrpc: '2.0', method: 'parseRaw', params: { path: filePath }, id })
        return promise
    }

    /** Send shutdown signal and forcefully terminate after a grace period. */
    async shutdown(): Promise<void> {
        const id = 0 // unused on shutdown
        this.__writeLine({ jsonrpc: '2.0', method: 'shutdown', params: {}, id })
        // Give the process a moment to exit gracefully, then kill.
        await new Promise<void>(resolve => setTimeout(resolve, 500))
        if (this.__child && !this.__child.killed) {
            this.__child.kill()
        }
    }

    /** Dispose of all resources (synonym for shutdown). */
    dispose(): void {
        this.shutdown().catch(() => { /* ignore */ })
    }

    // ── private helpers ───────────────────────────────────────────────────

    /** Start the Python process if it hasn't been started yet. */
    private async __ensureStarted(): Promise<void> {
        if (this.__started) { return }
        await this.__start()
    }

    private async __start(): Promise<void> {
        // Use the pre-resolved absolute path so the service lives in the extension bundle,
        // not whatever workspace happens to be open at discovery time.
        const resolved = this.__svcPath

        // Diagnostic: log the exact file and interpreter being used.
        console.log(`[AST service] python=${this.__pythonExe} svc=${resolved}`)

        // Quick path check — if we can stat via workspace.fs, great. If not,
        // fall back to a synchronous fs.existsSync guard before spawning.
        let fileExists = false
        try {
            const stats = await vscode.workspace.fs.stat(vscode.Uri.file(resolved))
            fileExists = stats.type === vscode.FileType.File
        } catch {
            // workspace.fs may not support this path; fall through.
        }

        if (!fileExists) {
            console.error(`[AST service] service file does not exist: ${resolved}`)
        }

        try {
            const stats = await vscode.workspace.fs.stat(vscode.Uri.file(resolved))
            if (stats.type !== vscode.FileType.File) {
                throw new Error('AST service file is not a regular file: ' + resolved)
            }
        } catch {
            // The file may not be accessible via workspace.fs (production builds).
            // We still try to spawn — if it fails, the child will exit and we'll know.
        }

        this.__child = spawn(this.__pythonExe, [resolved], {
            stdio: 'pipe',
        })

        if (!this.__child?.stdin) {
            throw new Error('Failed to start AST service -- stdin not available')
        }

        this.__started = true

        // ── stdout handler: accumulate chunks, split on newlines ───────
        const proc = this.__child!
        const decoder = new TextDecoder('utf-8')
        proc.stdout!.on('data', (chunk: Buffer) => {
            this.__buffer += decoder.decode(chunk, { stream: false })
            let newlineIdx: number
            while ((newlineIdx = this.__buffer.indexOf('\n')) !== -1) {
                const line = this.__buffer.slice(0, newlineIdx).trim()
                this.__buffer = this.__buffer.slice(newlineIdx + 1)
                if (line.length === 0) { continue }

                let resp: JsonRpcResponse
                try {
                    resp = JSON.parse(line) as JsonRpcResponse
                } catch {
                    continue // skip malformed lines -- likely partial data
                }

                const reqId: number | null = typeof resp.id === 'number' ? resp.id : null

                if (reqId !== null) {
                    const pending = this.__pending.get(reqId)
                    if (!pending) { continue }
                    if ('error' in resp && resp.error) {
                        pending.reject(new Error(resp.error.message))
                    } else if ('result' in resp && resp.result !== undefined) {
                        // Cast result to Module — Python always sends a Module for parse requests.
                        (pending.moduleResolve ?? (() => {}))(resp.result as Module)
                    }
                    clearTimeout(pending.timer)
                    this.__pending.delete(reqId)
                } else if ('result' in resp && typeof resp.id === 'number' && resp.id === 0) {
                    // Untracked pong / shutdown ack -- discard
                }
            }
        })

        // ── stderr handler: forward to stdout for diagnostic logging ─────
        const svcStderr = decoder.decode.bind(decoder)
        this.__child.stderr?.on('data', (chunk: Buffer) => {
            const msg = svcStderr(chunk, { stream: false }).trim()
            if (msg) {
                console.error(`[AST service stderr] ${msg}`)
            }
        })

        // ── error handler: reject pending requests and mark dead ───────
        proc.on('error', (err: Error) => {
            this.__rejectAll(`AST service process error: ${err.message}`)
        })

        // ── exit handler: reject pending requests and mark dead ────────
        const svcPathForLogs = resolved
        proc.on('exit', (code: number | null) => {
            if (code !== 0 && code !== null) {
                console.error(`[AST service] exited with code ${code} at ${svcPathForLogs}`)
                this.__rejectAll(`AST service exited with code ${code}`)
            } else {
                // Clean exit -- pending requests may have already been resolved.
                // Just log in case there are unexpected leftovers.
                if (this.__pending.size > 0) {
                    this.__rejectAll('AST service shut down unexpectedly')
                }
            }
            this.__started = false
            this.__child = null
        })
    }

    private __writeLine(obj: Record<string, unknown>): void {
        if (!this.__child?.stdin?.writable) { return }
        const line = JSON.stringify(obj) + '\n'
        this.__child.stdin.write(line, 'utf-8')
    }

    private __rejectAll(message: string): void {
        for (const [, pending] of this.__pending) {
            clearTimeout(pending.timer)
            pending.reject(new Error(message))
        }
        this.__pending.clear()
    }

}

// ── module-level singleton ───────────────────────────────────────────────────

let __serviceInstance: AstService | null = null

/** Get or create the global AST service singleton. */
export async function getAstService(
    pythonExe: string,
    extensionUri: vscode.Uri,
): Promise<AstService> {
    if (!__serviceInstance || !__serviceInstance['__started']) {
        __serviceInstance = new AstService(pythonExe, extensionUri)
    }
    return __serviceInstance
}

/** Convenience function that replaces `pyast.parse(content)` usage. */
export async function parsePythonSource(
    pythonExe: string,
    extensionUri: vscode.Uri,
    source: string,
): Promise<Module> {
    const svc = await getAstService(pythonExe, extensionUri)
    return svc.parseFile(source)
}

/** Convenience function for parsing a file on disk. */
export async function parsePythonFile(
    pythonExe: string,
    extensionUri: vscode.Uri,
    filePath: string,
): Promise<Module> {
    const svc = await getAstService(pythonExe, extensionUri)
    return svc.parseFileAtPath(filePath)
}

// Re-export types so consumers can import from this module if they prefer.
export type { JsonRpcResponse } from './json_rpc_types'
export type { Module, AstNode, FunctionDef, ClassDef, ExprNode } from './py_ast_types'
export type {
    StmtNode,
    Name,
    Attribute,
    Call,
    Constant,
} from './py_ast_types'
