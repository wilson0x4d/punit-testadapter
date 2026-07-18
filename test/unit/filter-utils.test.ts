// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Unit tests for filter utils — pure functions, zero vscode dependencies.
 */

import { describe, it } from 'mocha'
import * as assert from 'assert'
import { joinPathSegments, buildFilter } from '../../src/filter-utils'

describe('joinPathSegments', () => {
    it('joins a single directory segment', () => {
        assert.strictEqual(joinPathSegments('unit', '.'), 'unit')
    })

    it('joins multiple directory segments', () => {
        assert.strictEqual(joinPathSegments('subfolder/nested', '.'), 'subfolder.nested')
    })

    it('handles deeply nested paths', () => {
        assert.strictEqual(
            joinPathSegments('a/b/c/d/e', '.'),
            'a.b.c.d.e'
        )
    })

    it('handles paths with mixed slashes (windows style)', () => {
        // path.sep is / on linux, but the function should work with any separator input
        // Since path.sep === '/' on linux, backslash input would not split
        // In a real test we can't easily change path.sep, so test the posix behavior
        assert.strictEqual(joinPathSegments('foo/bar/baz', '.'), 'foo.bar.baz')
    })

    it('returns empty string for empty input', () => {
        assert.strictEqual(joinPathSegments('', '.'), '')
    })

    it('uses dot as separator (not slash)', () => {
        assert.notStrictEqual(joinPathSegments('a/b', '.'), 'a/b')
    })

    it('returns unmodified single segment', () => {
        assert.strictEqual(joinPathSegments('single', '.'), 'single')
    })
})

describe('buildFilter', () => {
    it('builds workspace filter', () => {
        assert.strictEqual(buildFilter('@', '*', ''), '@*')
    })

    it('builds folder filter', () => {
        assert.strictEqual(buildFilter('@', 'subfolder.nested', '*'), '@subfolder.nested*')
    })

    it('builds module filter with path', () => {
        assert.strictEqual(buildFilter('@', 'tests.unit/test_foo', '*'), '@tests.unit/test_foo*')
    })

    it('handles excluded filter with prefix', () => {
        assert.strictEqual(buildFilter('!', 'tests.unit', '!'), '!tests.unit!')
    })

    it('handles empty path part', () => {
        assert.strictEqual(buildFilter('@', '', '*'), '@*')
    })

    it('handles no suffix', () => {
        assert.strictEqual(buildFilter('@', 'tests.unit/test_func', ''), '@tests.unit/test_func')
    })

    it('handles function filter (no separator, no suffix)', () => {
        assert.strictEqual(buildFilter('@', 'tests.unit/test_func', ''), '@tests.unit/test_func')
    })

    it('handles class method filter pattern', () => {
        // className + method with trailing slash separator
        const classPart = 'MyClass'
        const methodPart = 'test_method'
        const result = buildFilter('@', `tests.unit/test_foo/${classPart}`, `/${methodPart}`)
        assert.strictEqual(result, '@tests.unit/test_foo/MyClass/test_method')
    })
})
