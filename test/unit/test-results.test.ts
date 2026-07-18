// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Unit tests for extractTestResults — pure function, zero vscode dependencies.
 */

import { describe, it } from 'mocha'
import * as assert from 'assert'
import { extractTestResults, ParsedTestResult } from '../../src/test-results'

describe('extractTestResults', () => {
    it('parses empty array "[]" — throws because no [{" found', () => {
        assert.throws(() => extractTestResults('[]'), /Unable to extract/)
    })

    it('throws on only whitespace', () => {
        assert.throws(() => extractTestResults('   \n\t  '), /Unable to extract/)
    })

    it('parses result with null message field', () => {
        const input = '[{"status":"pass","name":"test_single","took":0,"message":null}]'
        const result = extractTestResults<ParsedTestResult[]>(input)
        assert.strictEqual(Array.isArray(result), true)
        assert.strictEqual(result[0].status, 'pass')
        assert.strictEqual(result[0].name, 'test_single')
        assert.strictEqual(result[0].took, 0)
        // JSON null becomes JS null, not undefined
        assert.strictEqual(result[0].message, null)
    })

    it('parses and returns field "not" when input has {"not":"valid"}', () => {
        const input = '[{"not":"valid"}]'
        const result = extractTestResults<Array<Record<string, unknown>>>(input)
        assert.strictEqual(Array.isArray(result), true)
        assert.strictEqual(result[0]['not'], 'valid')
    })

    it('skips first invalid JSON candidate, parses second valid one', () => {
        // '[{"x":' is invalid JSON → catch → i = 9, indexOf('[{"', 9) finds nothing
        // Add a space then another [{" to make it work
        const input = '[{"x": [{"status":"pass","name":"good","took":5,"message":"ok"}]'
        const result = extractTestResults<ParsedTestResult[]>(input)
        assert.strictEqual(result[0].status, 'pass')
        assert.strictEqual(result[0].name, 'good')
    })

    it('handles single valid candidate after garbage', () => {
        const input = 'some garbage [{"status":"skip","name":"x","took":0,"message":null}]'
        const result = extractTestResults<ParsedTestResult[]>(input)
        assert.strictEqual(result[0].status, 'skip')
        assert.strictEqual(result[0].name, 'x')
    })

    it('returns mixed statuses with correct fields', () => {
        const input = '[{"status":"pass","name":"a","took":1,"message":null},{"status":"fail","name":"b","took":5,"message":"boom"},{"status":"skip","name":"c","took":0,"message":null},{"status":"error","name":"d","took":50,"message":"segfault"}]'
        const result = extractTestResults<ParsedTestResult[]>(input)
        assert.strictEqual(result.length, 4)
        assert.strictEqual(result[0].status, 'pass')
        assert.strictEqual(result[0].name, 'a')
        assert.strictEqual(result[1].status, 'fail')
        assert.strictEqual(result[1].message, 'boom')
        assert.strictEqual(result[2].status, 'skip')
        assert.strictEqual(result[3].status, 'error')
        assert.strictEqual(result[3].message, 'segfault')
    })

    it('parses message with unicode characters', () => {
        const input = '[{"status":"fail","name":"test","took":0,"message":"émojis 🎉 not found"}]'
        const result = extractTestResults<ParsedTestResult[]>(input)
        assert.strictEqual(result[0].message, 'émojis 🎉 not found')
    })

    it('handles large response with 1000 items', () => {
        const items = Array.from({ length: 1000 }, (_, i) =>
            `{"status":"pass","name":"test_${i}","took":${i},"message":null}`
        ).join(',')
        const input = `[${items}]`
        const result = extractTestResults<ParsedTestResult[]>(input)
        assert.strictEqual(Array.isArray(result), true)
        assert.strictEqual(result.length, 1000)
        assert.strictEqual(result[0].name, 'test_0')
        assert.strictEqual(result[999].name, 'test_999')
    })

    it('trailing whitespace after JSON array is trimmed', () => {
        const input = '[{"status":"pass","name":"test","took":0,"message":null}]  \n\r  '
        const result = extractTestResults<ParsedTestResult[]>(input)
        assert.strictEqual(result[0].status, 'pass')
    })

    it('returns non-array object when input is JSON object', () => {
        const input = '{"status":"pass","name":"single"}'
        assert.throws(() => extractTestResults(input), /Unable to extract/)
    })

    it('skips multiple invalid candidates then finds valid JSON', () => {
        // '[{"bad":' is invalid (missing closing brace/quote) → catch → i = 9
        // indexOf('[{"', 9) finds '[{"status":...' next
        const input = '[{"bad": [{"status":"error","name":"test_err","took":99,"message":"crash"}]'
        const result = extractTestResults<ParsedTestResult[]>(input)
        assert.strictEqual(result[0].status, 'error')
        assert.strictEqual(result[0].name, 'test_err')
    })
})
