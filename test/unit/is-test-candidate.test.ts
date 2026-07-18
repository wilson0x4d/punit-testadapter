// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Unit tests for isTestCandidate — pure function, zero vscode dependencies.
 */

import { describe, it } from 'mocha'
import * as assert from 'assert'
import { isTestCandidate } from '../../src/test-candidate'

describe('isTestCandidate', () => {
    it('returns true for "import punit"', () => {
        assert.strictEqual(isTestCandidate('import punit'), true)
    })

    it('returns true for "from punit"', () => {
        assert.strictEqual(isTestCandidate('from punit.core import fact'), true)
    })

    it('returns true for "import punit.core"', () => {
        assert.strictEqual(isTestCandidate('import punit.core'), true)
    })

    it('returns true for "from punit"', () => {
        assert.strictEqual(isTestCandidate('from punit import *'), true)
    })

    it('returns false for "import unittest"', () => {
        assert.strictEqual(isTestCandidate('import unittest'), false)
    })

    it('returns false for "import pytest"', () => {
        assert.strictEqual(isTestCandidate('import pytest'), false)
    })

    it('returns false for "from unittest"', () => {
        assert.strictEqual(isTestCandidate('from unittest import TestCase'), false)
    })

    it('returns false for standalone word "punit" without import', () => {
        assert.strictEqual(isTestCandidate('this is a punit test'), false)
    })

    it('returns false for empty string', () => {
        assert.strictEqual(isTestCandidate(''), false)
    })

    it('returns false for whitespace only', () => {
        assert.strictEqual(isTestCandidate('   \n\t  '), false)
    })

    it('matches python file with mixed content', () => {
        const content = `
class TestExample:
    def test_something(self):
        pass
import punit
from punit.decorators import fact
        `
        assert.strictEqual(isTestCandidate(content), true)
    })

    it('matches import in a comment but not in code', () => {
        // The function checks string inclusion, so comments also match.
        // This is intentional — it's a fast pre-filter before AST parsing.
        assert.strictEqual(isTestCandidate('# import punit'), true)
    })
})
