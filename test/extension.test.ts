// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Integration test suite for the extension.
 * These tests require a real VS Code / Electron instance and run via
 * `@vscode/test-cli` in environments with a display server (local dev or CI + Xvfb).
 *
 * To write an integration test:
 *   1. Import 'vscode' from the actual vscode module (provided by Electron)
 *   2. Use real vscode APIs (windows, workspace, etc.)
 *   3. Save as `test/extension.test.ts` or add to this suite
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Integration Test Suite', () => {
    test('placeholder', async () => {
        assert.strictEqual(1 + 1, 2);
    });
});
