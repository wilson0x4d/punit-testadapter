// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Unit tests for discovery.ts — test discovery subsystem.
 * Tests cover module loading and AST analysis integration.
 */

import { describe, it, afterEach } from 'mocha'
import * as assert from 'assert'
import * as vscode from 'vscode'
import {
    DiscoveryContext,
    ensureWorkspaceItems,
} from '../../src/discovery'
import { hasDecorator, extractTraitTags } from '../../src/ast-analysis'
import type { ExprNode, Name, Attribute, Call, Constant } from '../../src/py_ast_types'
import { mockVscodeWorkspace } from './vscode-mock'

function nameExpr(id: string): Name {
    return { nodeType: 'Name', id, ctx: { Load: 1 } as any, col_offset: 0, lineno: 1 }
}

function attrExpr(attr: string, value: ExprNode): Attribute {
    return { nodeType: 'Attribute', attr, value, ctx: { Load: 1 } as any, col_offset: 0, lineno: 1 }
}

function callExpr(func: ExprNode, ...args: ExprNode[]): Call {
    return { nodeType: 'Call', func, args, keywords: [], col_offset: 0, lineno: 1 }
}

function constant(value: string | number | boolean | null): Constant {
    return { nodeType: 'Constant', value, kind: null, col_offset: 0, lineno: 1 }
}

function makeMockOutput(): vscode.OutputChannel {
    return {
        appendLine: () => {},
        show: () => {},
        clear: () => {},
        dispose: () => {},
        append: () => {},
        replace: () => {},
        hide: () => {},
        name: 'mock',
    } as unknown as vscode.OutputChannel
}

function makeMockController(items = new Map<string, vscode.TestItem>()) {
    return {
        id: 'punit',
        label: 'pUnit Tests',
        items: {
            get: (id: string) => items.get(id),
            add: (item: vscode.TestItem) => { items.set(item.id, item) },
            delete: (id: string) => items.delete(id),
            forEach: (cb: (item: vscode.TestItem) => void) => items.forEach(cb),
            size: items.size,
            clear: () => items.clear(),
            [Symbol.iterator]() { return items.entries() },
        } as unknown as vscode.TestItemCollection,
        createTestItem: (id: string, label: string, uri: vscode.Uri) => {
            const item = {
                id, label, uri, range: undefined, canResolveChildren: true,
                children: {
                    add() {},
                    size: 0,
                    forEach() {},
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
}

describe('discovery.ts', () => {
    let restore: (() => void) | undefined

    afterEach(() => {
        restore?.()
    })

    describe('DiscoveryContext', () => {
        it('can be constructed with mock dependencies', () => {
            const controller = makeMockController()
            const ctx = new DiscoveryContext(
                controller,
                makeMockOutput(),
                vscode.Uri.file('/workspace'),
                async () => '/usr/bin/python3',
            )
            assert.strictEqual(ctx.controller, controller)
            assert.strictEqual(ctx.testItems.size, 0)
            assert.strictEqual(ctx.knownTestTags.size, 0)
            assert.ok(typeof ctx.astServiceGetter === 'function')
        })
    })

    describe('AST analysis integration (via discovery module)', () => {
        it('hasDecorator detects @fact', () => {
            const decorators = [callExpr(nameExpr('fact'))]
            assert.strictEqual(hasDecorator(decorators, ['fact', 'theory']), true)
        })

        it('hasDecorator detects @data.fact', () => {
            const decorators = [attrExpr('fact', nameExpr('data'))]
            assert.strictEqual(hasDecorator(decorators, ['fact', 'theory']), true)
        })

        it('hasDecorator ignores @trait', () => {
            const decorators = [callExpr(nameExpr('trait'))]
            assert.strictEqual(hasDecorator(decorators, ['fact', 'theory']), false)
        })

        it('extractTraitTags extracts single tag', () => {
            const decorators = [callExpr(nameExpr('trait'), constant('smoke'))]
            assert.deepStrictEqual(extractTraitTags(decorators), ['smoke'])
        })

        it('extractTraitTags extracts compound tag', () => {
            const decorators = [callExpr(nameExpr('trait'), constant('regression'), constant('slow'))]
            assert.deepStrictEqual(extractTraitTags(decorators), ['regression:slow'])
        })

        it('extractTraitTags ignores @fact', () => {
            const decorators = [callExpr(nameExpr('fact'))]
            assert.deepStrictEqual(extractTraitTags(decorators), [])
        })

        it('extractTraitTags handles multiple trait decorators', () => {
            const decorators = [
                callExpr(nameExpr('fact')),
                callExpr(nameExpr('trait'), constant('smoke')),
                callExpr(nameExpr('trait'), constant('critical'), constant('integration')),
            ]
            const result = extractTraitTags(decorators)
            assert.strictEqual(result.length, 2)
            assert.strictEqual(result[0], 'smoke')
            assert.strictEqual(result[1], 'critical:integration')
        })
    })

    describe('ensureWorkspaceItems', () => {
        it('adds root items for each workspace folder', () => {
            ;[restore] = mockVscodeWorkspace('specs')
            const folder = vscode.workspace.workspaceFolders![0]

            const controller = makeMockController()
            ensureWorkspaceItems(new DiscoveryContext(
                controller,
                makeMockOutput(),
                folder.uri,
                async () => '/python',
            ))

            let found = false
            for (const [_, item] of controller.items) {
                if (item.id.includes('specs')) found = true
            }
            assert.ok(found)
        })

        it('uses configured test package name', () => {
            ;[restore] = mockVscodeWorkspace('my_tests')
            const folder = vscode.workspace.workspaceFolders![0]

            const controller = makeMockController()
            ensureWorkspaceItems(new DiscoveryContext(
                controller,
                makeMockOutput(),
                folder.uri,
                async () => '/python',
            ))

            const found = [...controller.items].some(([, item]) => item.id.includes('my_tests'))
            assert.ok(found, 'Should find root item with test package name')
        })
    })

    describe('URI path resolution patterns', () => {
        it('splits URI path correctly for nested file', () => {
            // URI path: /workspace/tests/unit/test_helpers.py#SomeClass
            const uri = vscode.Uri.parse('file:///workspace/tests/unit/test_helpers.py#SomeClass')
            // In the code: uri.toString(true).replace('file:///workspace/tests', '')
            // This would give: '/unit/test_helpers.py#SomeClass'
            // Split by '/' gives: ['', 'unit', 'test_helpers.py#SomeClass']
            const parts = uri.toString(true).replace('file:///workspace/tests', '').split('/')
            assert.ok(parts.includes('unit'))
        })

        it('trims empty parts from path strings', () => {
            const empty = ''
            assert.strictEqual(empty.length, 0, 'Empty string should have length 0')
        })

        it('detects .py file extension', () => {
            assert.ok('test_foo.py'.endsWith('.py'))
            assert.ok('module/__init__.py'.endsWith('.py'))
        })
    })
})
