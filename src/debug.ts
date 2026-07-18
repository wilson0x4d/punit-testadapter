// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Debug session management utilities for pUnit test adapter.
 * Handles debugger extension activation, port allocation, and connection waiting.
 */

import * as net from 'net'
import { randomInt } from 'node:crypto'
import * as vscode from 'vscode'

/** Ensure the debugpy VS Code extension is activated. */
export async function ensureDebuggerActive(): Promise<void> {
    const debugpy = vscode.extensions.getExtension('ms-python.debugpy')
    if (debugpy) {
        if (!debugpy.isActive) {
            await debugpy.activate()
        }
    }
}

/** Check if a TCP port is available (not in use). */
async function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket()
        socket.setTimeout(1000)
        socket.once('connect', () => {
            socket.destroy()
            resolve(false)
        })
        socket.once('error', (err: any) => {
            socket.destroy()
            resolve(err.code === 'ECONNREFUSED')
        })
        socket.once('timeout', () => {
            socket.destroy()
            resolve(true)
        })
        socket.connect(port, '127.0.0.1')
    })
}

/** Find a random available TCP port in the ephemeral range. */
export async function getDebuggerPortNumber(): Promise<number> {
    while (true) {
        const port = randomInt(2048, 59152)
        if (await isPortAvailable(port)) {
            return port
        }
    }
}

/** Wait for a debugger to connect on the given port. */
export async function waitForDebugger(port: number, timeout = 5000): Promise<void> {
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
        } catch (_e) {
            await new Promise(r => setTimeout(r, 100))
        }
    }
    throw new Error(`Debugger port ${port} timed out.`)
}
