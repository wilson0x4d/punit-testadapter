// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Unit tests for pure functions. Written in mocha's BDD style.
 * These run in plain Node.js — no Electron or VS Code instance needed.
 */

import { describe, it } from 'mocha'
import * as assert from 'assert'
import { extractTestResults } from '../../src/test-results'

describe('extractTestResults', () => {
    it('parses clean JSON output', () => {
        const input = `[{"status":"pass","name":"test_foo","took":42,"message":null}]`
        const result = extractTestResults(input)
        assert.strictEqual(Array.isArray(result), true)
    })

    it('ignores leading text before JSON', () => {
        const input = 'some log output\n[{"status":"fail","name":"test_bar","took":10,"message":"assertion failed"}]'
        const result = extractTestResults(input)
        assert.strictEqual(Array.isArray(result), true)
    })

    it('parses JSON with surrounding text', () => {
        // Input with leading logs then JSON — should find and parse the array
        const input = 'punit running tests\n[{"status":"skip","name":"test_baz","took":0,"message":null}]'
        const result = extractTestResults(input)
        assert.strictEqual(Array.isArray(result), true)
    })

    it('throws on invalid output with no JSON', () => {
        assert.throws(() => extractTestResults('just some text\nnothing here'), /Unable to extract/)
    })
})
