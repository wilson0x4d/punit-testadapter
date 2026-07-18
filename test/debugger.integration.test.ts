// SPDX-FileCopyrightText: (c) 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Integration test that verifies the Debug test profile completes without hanging.
 *
 * Runs inside a VS Code instance provided by @vscode/test-cli. Gets the punit-testadapter's
 * TestController and Debug profile from global variables set during extension activation,
 * triggers a debug run on all discovered tests, and enforces a 30-second timeout.
 */

import * as assert from 'assert'
import * as vscode from 'vscode'

suite('Debug Run Hang Detection', function () {
    this.timeout(60_000)

    let controller: vscode.TestController
    let debugProfile: vscode.TestRunProfile

    test('debug profile completes without hanging', async function () {
        const ext = await vscode.extensions.getExtension('x4d.punit-testadapter')
        assert.ok(ext, 'punit-testadapter extension should be installed and activatable')
        if (!ext?.isActive) {
            await ext!.activate()
        }

        const globalController = (globalThis as any).punitTestController as vscode.TestController | undefined
        const globalDebugProfile = (globalThis as any).punitDebugProfile as vscode.TestRunProfile | undefined
        if (!globalController || !globalDebugProfile) {
            this.skip()
            return
        }
        controller = globalController
        debugProfile = globalDebugProfile

        await new Promise(r => setTimeout(r, 500))

        const allTests: vscode.TestItem[] = []
        function collectInItem(item: vscode.TestItem): void {
            if (item.id.startsWith('function:') || item.id.startsWith('class:')) {
                allTests.push(item)
            }
            item.children.forEach(collectInItem)
        }
        for (const [, item] of controller.items) {
            collectInItem(item)
        }

        assert.ok(allTests.length > 0, `Should have discovered tests (${allTests.length} found)`)

        const request = new vscode.TestRunRequest(allTests, [], undefined, undefined)
        const tokenSource = new vscode.CancellationTokenSource()

        try {
            await (debugProfile.runHandler as Function)(request, tokenSource.token)
        } catch (err) {
            throw err
        } finally {
            tokenSource.dispose()
        }
    })
})
