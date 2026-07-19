// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT
// @trait('integration')

/**
 * Unit tests for execution.ts — test execution helpers.
 */

import { describe, it, afterEach } from 'mocha'
import * as assert from 'assert'
import * as vscode from 'vscode'
import { generateToolArgs } from '../../src/execution'
import { mockVscodeWorkspace } from './vscode-mock'

describe('execution.ts', () => {
    let restore: (() => void) | undefined

    afterEach(() => {
        restore?.()
    })

    describe('generateToolArgs', () => {
        it('includes test-package argument', () => {
            [restore] = mockVscodeWorkspace(vscode, 'my_tests')
            const folder = vscode.workspace.workspaceFolders![0]
            const args = generateToolArgs(folder)
            assert.deepStrictEqual(args.slice(0, 2), ['--test-package', 'my_tests'])
        })

        it('default package name is tests', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const folder = vscode.workspace.workspaceFolders![0]
            const args = generateToolArgs(folder)
            assert.strictEqual(args[1], 'tests')
        })

        it('always includes report json', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const folder = vscode.workspace.workspaceFolders![0]
            const args = generateToolArgs(folder)
            assert.deepStrictEqual(args[2], '--report')
            assert.strictEqual(args[3], 'json')
        })

        it('always includes no-exitcode', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const folder = vscode.workspace.workspaceFolders![0]
            const args = generateToolArgs(folder)
            assert.strictEqual(args[4], '--no-exitcode')
        })

        it('always includes filter @stdin', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const folder = vscode.workspace.workspaceFolders![0]
            const args = generateToolArgs(folder)
            assert.strictEqual(args[6], '@stdin')
        })

        it('produces correct full argument list', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const folder = vscode.workspace.workspaceFolders![0]
            const args = generateToolArgs(folder)
            assert.deepStrictEqual(args, ['--test-package', 'tests', '--report', 'json', '--no-exitcode', '--filter', '@stdin'])
        })
    })

    describe('getTestItemFromParsedTestResult', () => {
        it('returns workspace item for unmatched simple result name', async () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const items = new Map<string, vscode.TestItem>()
            const workspaceUri = vscode.workspace.workspaceFolders![0].uri
            const testPackageName = 'tests'
            const expectedId = `root:${workspaceUri}/${testPackageName}`

            const workspaceItem = {
                id: expectedId,
                label: testPackageName,
                uri: workspaceUri,
                range: undefined,
                canResolveChildren: true,
                children: {
                    add() {},
                    forEach() {},
                    size: 0,
                } as unknown as vscode.TestItemCollection,
                tags: [],
                parent: undefined,
                busy: false,
                error: undefined,
            } as vscode.TestItem
            items.set(workspaceItem.id, workspaceItem)
            const controller = {
                id: 'punit',
                label: 'pUnit Tests',
                items: {
                    get: (id: string) => items.get(id),
                    add: (item: vscode.TestItem) => { items.set(item.id, item) },
                    delete: (id: string) => items.delete(id),
                    forEach: () => {},
                    size: items.size,
                    clear: () => items.clear(),
                    [Symbol.iterator]() { return items.entries() },
                } as unknown as vscode.TestItemCollection,
                createTestItem: (id: string, label: string, uri: vscode.Uri) => {
                    const item = {
                        id, label, uri, range: new vscode.Range(0, 0, 1, 0),
                        children: {
                            add() {},
                            forEach() {},
                            size: 0,
                        } as unknown as vscode.TestItemCollection,
                        tags: [], parent: undefined, busy: false, error: undefined,
                    } as unknown as vscode.TestItem
                    items.set(id, item)
                    return item
                },
                createTestRunGroup: () => ({}) as any,
                onDidDispose: () => ({ dispose() {} }),
                resolveHandler: undefined,
                refreshHandler: undefined,
            } as unknown as vscode.TestController

            const { getTestItemFromParsedTestResult } = await import('../../src/execution')
            const result = getTestItemFromParsedTestResult(
                vscode.workspace.workspaceFolders![0],
                controller,
                { status: 'pass', name: 'some_unknown_test', took: 5, message: undefined },
            )
            assert.strictEqual(result!.id, expectedId)
        })
    })
})
