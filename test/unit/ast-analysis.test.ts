// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Unit tests for AST analysis helpers — pure functions, zero vscode dependencies.
 * Test data uses plain TS objects matching py_ast_types.ts shapes.
 */

import { describe, it } from 'mocha'
import * as assert from 'assert'
import { hasDecorator, extractTraitTags } from '../../src/ast-analysis'
import type { ExprNode, Name, Attribute, Call, Constant } from '../../src/py_ast_types'

// ── helper factories for test data ────────────────────────────────────────

function nameExpr(id: string): Name {
    return { nodeType: 'Name', id, ctx: 'Load', col_offset: 0, lineno: 1 }
}

function attrExpr(attr: string, value: ExprNode): Attribute {
    return { nodeType: 'Attribute', attr, value, ctx: 'Load', col_offset: 0, lineno: 1 }
}

function callExpr(func: ExprNode, ...args: ExprNode[]): Call {
    return { nodeType: 'Call', func, args, keywords: [], col_offset: 0, lineno: 1 }
}

function constant(value: string | number | boolean | null): Constant {
    return { nodeType: 'Constant', value, kind: null, col_offset: 0, lineno: 1 }
}

// ── hasDecorator tests ────────────────────────────────────────────────────

describe('hasDecorator', () => {
    it('returns true for @fact (Name decorator)', () => {
        const decorators = [nameExpr('fact')]
        assert.strictEqual(hasDecorator(decorators, ['fact', 'theory']), true)
    })

    it('returns true for @theory (Name decorator)', () => {
        const decorators = [nameExpr('theory')]
        assert.strictEqual(hasDecorator(decorators, ['fact', 'theory']), true)
    })

    it('returns true for @skip (not in list)', () => {
        const decorators = [nameExpr('skip')]
        assert.strictEqual(hasDecorator(decorators, ['fact', 'theory']), false)
    })

    it('returns true for @data.fact (Attribute decorator)', () => {
        const decorators = [attrExpr('fact', nameExpr('data'))]
        assert.strictEqual(hasDecorator(decorators, ['fact', 'theory']), true)
    })

    it('returns true for @fact() (Call wrapping Name)', () => {
        const decorators = [callExpr(nameExpr('fact'))]
        assert.strictEqual(hasDecorator(decorators, ['fact', 'theory']), true)
    })

    it('returns true for @trait() (Call wrapping Name, not in decoratorNames)', () => {
        const decorators = [callExpr(nameExpr('trait'), constant('smoke'))]
        assert.strictEqual(hasDecorator(decorators, ['fact', 'theory']), false)
    })

    it('returns false for undefined decorator list', () => {
        assert.strictEqual(hasDecorator(undefined, ['fact']), false)
    })

    it('returns false for empty decorator list', () => {
        assert.strictEqual(hasDecorator([], ['fact']), false)
    })

    it('returns true when decorator appears anywhere in list', () => {
        const decorators = [
            nameExpr('skip'),
            nameExpr('someutil'),
            nameExpr('fact'),
            nameExpr('other'),
        ]
        assert.strictEqual(hasDecorator(decorators, ['theory']), false)
        assert.strictEqual(hasDecorator(decorators, ['fact']), true)
    })

    it('returns true for @data.theory (Attribute wrapping Name)', () => {
        const decorators = [attrExpr('theory', nameExpr('data'))]
        assert.strictEqual(hasDecorator(decorators, ['fact', 'theory']), true)
    })

    it('returns true for @fact(with args) Call pattern', () => {
        const decorators = [
            callExpr(nameExpr('fact'), constant('arg1'), constant('arg2'))
        ]
        assert.strictEqual(hasDecorator(decorators, ['fact']), true)
    })
})

// ── extractTraitTags tests ────────────────────────────────────────────────

describe('extractTraitTags', () => {
    it('returns empty array for undefined input', () => {
        assert.deepStrictEqual(extractTraitTags(undefined), [])
    })

    it('returns empty array for empty list', () => {
        assert.deepStrictEqual(extractTraitTags([]), [])
    })

    it('extracts single tag from @trait("unit")', () => {
        const decorators = [
            callExpr(nameExpr('trait'), constant('unit'))
        ]
        assert.deepStrictEqual(extractTraitTags(decorators), ['unit'])
    })

    it('extracts two tags from @trait("smoke", "regression")', () => {
        const decorators = [
            callExpr(nameExpr('trait'), constant('smoke'), constant('regression'))
        ]
        assert.deepStrictEqual(extractTraitTags(decorators), ['smoke:regression'])
    })

    it('extracts multiple trait tags from list', () => {
        const decorators = [
            callExpr(nameExpr('fact')),
            callExpr(nameExpr('trait'), constant('smoke')),
            nameExpr('skip'),
            callExpr(nameExpr('trait'), constant('critical'), constant('integration')),
        ]
        const result = extractTraitTags(decorators)
        assert.strictEqual(result.length, 2)
        assert.strictEqual(result[0], 'smoke')
        assert.strictEqual(result[1], 'critical:integration')
    })

    it('extracts data.trait pattern', () => {
        const decorators = [
            callExpr(attrExpr('trait', nameExpr('data')), constant('feature'))
        ]
        // attribute.func.attr == 'trait' is correctly matched
        assert.deepStrictEqual(extractTraitTags(decorators), ['feature'])
    })

    it('skips non-trait decorators', () => {
        const decorators = [
            callExpr(nameExpr('skip')),
            callExpr(nameExpr('someDecorator'), constant('value'))
        ]
        assert.deepStrictEqual(extractTraitTags(decorators), [])
    })

    it('skips Call with empty args', () => {
        const decorators = [callExpr(nameExpr('trait'))]
        assert.deepStrictEqual(extractTraitTags(decorators), [])
    })

    it('skips Name decorator (not a call)', () => {
        const decorators = [nameExpr('trait')]
        assert.deepStrictEqual(extractTraitTags(decorators), [])
    })

    it('skips Attribute decorator (not a call)', () => {
        const decorators = [attrExpr('trait', nameExpr('someModule'))]
        assert.deepStrictEqual(extractTraitTags(decorators), [])
    })

    it('handles mixed valid and invalid patterns', () => {
        const decorators = [
            nameExpr('fact'),
            callExpr(nameExpr('fact')), // hasDecorator returns true, but extractTraitTags ignores fact
            callExpr(nameExpr('trait'), constant('unit')),
        ]
        const result = extractTraitTags(decorators)
        assert.strictEqual(result.length, 1)
        assert.strictEqual(result[0], 'unit')
    })
})
