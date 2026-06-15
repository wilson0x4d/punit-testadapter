// SPDX-FileCopyrightText: (c) 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Integration test that verifies the Debug test profile completes without hanging.
 *
 * Runs inside a VS Code instance provided by @vscode/test-cli. Gets the punit-testadapter's
 * TestController from our own extension exports, finds the Debug run profile, triggers it on
 * all discovered tests, and enforces a 15-second timeout. A hang causes the test to fail via
 * mocha's global `this.timeout()` mechanism.
 */

import * as assert from 'assert'
import * as vscode from 'vscode'

suite('Debug Run Hang Detection', function () {
    this.timeout(15_000) // 15-second global timeout for the entire test

    let controller: vscode.TestController

    suiteSetup(async () => {
        const ext = await vscode.extensions.getExtension('x4d.punit-testadapter')
        assert.ok(ext, 'punit-testadapter extension should be installed and activatable')

        // Activate if not already active; the activation registers the TestController.
        if (!ext.isActive) {
            await ext.activate()
        }

        // Retrieve our controller from the extension's exports (set by activate()).
        const exportsObj = ext.exports as { controller: vscode.TestController } | undefined
        assert.ok(exportsObj?.controller, 'Extension should export a TestController via `exports.controller`')
        controller = exportsObj!.controller

        // Poll for test discovery — the extension discovers tests asynchronously.
        let foundItems = false
        for (let i = 0; i < 50; i++) {
            let totalItems = 0
            controller.items.forEach(() => { totalItems++ })
            if (totalItems > 0) {
                foundItems = true
                break
            }
            await new Promise(resolve => setTimeout(resolve, 200))
        }

        assert.ok(foundItems, 'Test discovery should populate controller.items')

        // Recursively collect all test functions/classes.
        const allTests: vscode.TestItem[] = []
        function collectTests(item: vscode.TestItem): void {
            if (item.id.startsWith('function:') || item.id.startsWith('class:')) {
                allTests.push(item)
            }
            item.children.forEach(collectTests)
        }

        controller.items.forEach(rootItem => {
            void controller.resolveHandler!(rootItem)
            collectTests(rootItem)
        })

        // At minimum, our fixture file should have been discovered.
        assert.ok(allTests.length > 0, 'Should have discovered at least one test from the fixture file')
    })

    test('debug profile completes without hanging', async () => {
        // Find the Debug run profile on our controller.
        // Note: `profiles` is a VS Code 1.97+ API; @types/vscode doesn't include it yet,
        // so we cast through `any` to bypass the type checker.
        const profiles = (controller as any).profiles as Iterable<vscode.TestRunProfile> | undefined
        assert.ok(profiles, 'Controller should have a `profiles` collection')

        let debugProfile: vscode.TestRunProfile | undefined
        for (const profile of profiles) {
            if (profile.kind === vscode.TestRunProfileKind.Debug) {
                debugProfile = profile
                break
            }
        }

        assert.ok(debugProfile, 'Debug run profile should be registered on the punit TestController')

        // Collect all discovered test items again (in case discovery updated since suiteSetup).
        const allTests: vscode.TestItem[] = []
        function collectTests(item: vscode.TestItem): void {
            if (item.id.startsWith('function:') || item.id.startsWith('class:')) {
                allTests.push(item)
            }
            item.children.forEach(collectTests)
        }

        controller.items.forEach(rootItem => collectTests(rootItem))

        if (allTests.length === 0) {
            assert.fail('No test items found; cannot invoke Debug run.')
        }

        // Create a TestRunRequest targeting all discovered tests.
        const request = new vscode.TestRunRequest(allTests, [], undefined, undefined)
        const tokenSource = new vscode.CancellationTokenSource()

        try {
            // Invoke the Debug profile directly. The VS Code 1.97+ API adds a `.run()` method
            // to TestRunProfile that accepts (request, token). @types/vscode doesn't include it,
            // so we cast through `any` — this works at runtime because our test runs inside the
            // actual Electron host where the real implementation is present.
            // The profile's handler manages its own TestRun lifecycle internally.
            await (debugProfile as any).run!(request, tokenSource.token)

            // If we reach here, the run completed within the timeout. No hang detected.
        } catch (err) {
            throw err  // Re-throw so mocha marks the test as failed.
        } finally {
            tokenSource.dispose()
        }
    })
})
