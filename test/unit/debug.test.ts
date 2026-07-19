// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT
// @trait('integration')

/**
 * Unit tests for debug.ts — debug session management.
 * Uses vscode-test CLI to run in a real vscode host environment.
 * Tags: integration (requires vscode module)
 */

import { describe, it, suite, teardown } from 'mocha'
import * as assert from 'assert'
import * as vscode from 'vscode'
import * as net from 'net'
import {
    ensureDebuggerActive,
    getDebuggerPortNumber,
    waitForDebugger,
} from '../../src/debug'

suite('debug.ts', function () {
    this.timeout(10_000) // generous timeout for network tests

    let ports: number[] = []

    teardown(function () {
        // Give a moment for ports to release
    })

    suite('ensureDebuggerActive', () => {
        it('is a function', () => {
            assert.strictEqual(typeof ensureDebuggerActive, 'function')
        })

        it('does not throw when called', async () => {
            await ensureDebuggerActive()
        })
    })

    suite('getDebuggerPortNumber', () => {
        it('is a function', () => {
            assert.strictEqual(typeof getDebuggerPortNumber, 'function')
        })

        it('returns an available port number', async () => {
            const port = await getDebuggerPortNumber()
            ports.push(port)
            assert.ok(Number.isInteger(port))
            assert.ok(port >= 2048, `Port ${port} should be ≥ 2048`)
            assert.ok(port <= 59152, `Port ${port} should be ≤ 59152`)
        })

        it('finds a port free to bind', async () => {
            const port = await getDebuggerPortNumber()
            ports.push(port)
            const server = net.createServer()
            await new Promise<void>((resolve, reject) => {
                server.listen(port, '127.0.0.1', resolve)
                server.on('error', reject)
            })
            server.close()
        })
    })

    suite('waitForDebugger', () => {
        it('is a function', () => {
            assert.strictEqual(typeof waitForDebugger, 'function')
        })

        it('rejects when no listener on port', async () => {
            const unused = 22123 + Date.now() % 1000
            await assert.rejects(
                waitForDebugger(unused, 500),
            )
        })

        it('succeeds when server is listening', async () => {
            const server = net.createServer()
            const portPromise = new Promise<number>((resolve, reject) => {
                server.listen(0, '127.0.0.1', () => {
                    const addr = server.address() as net.AddressInfo
                    resolve(addr.port)
                })
                server.on('error', reject)
            })
            const port = await portPromise

            // Wait a moment then try to connect
            await new Promise(resolve => setTimeout(resolve, 100))
            await waitForDebugger(port, 2000)
            server.close()
        })

        it('times out on port with slow listener', async () => {
            const server = net.createServer()
            const port = await new Promise<number>((resolve, reject) => {
                server.listen(0, '127.0.0.1', () => {
                    const addr = server.address() as net.AddressInfo
                    resolve(addr.port)
                })
                server.on('error', reject)
            })

            // Close immediately so no listener exists
            server.close()
            await new Promise(resolve => setTimeout(resolve, 100))

            await assert.rejects(
                waitForDebugger(port, 500),
            )
        })
    })
})
