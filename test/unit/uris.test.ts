// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT
// @trait('integration')

/**
 * Unit tests for uris.ts — URI parsing and filter creation.
 */

import { describe, it, afterEach } from 'mocha'
import * as assert from 'assert'
import * as vscode from 'vscode'
import {
    createWorkspaceFilter,
    createFolderFilter,
    createModuleFilter,
} from '../../src/uris'
import { mockVscodeWorkspace } from './vscode-mock'

describe('uris.ts', () => {
    let restore: (() => void) | undefined

    afterEach(() => {
        restore?.()
    })

    describe('createWorkspaceFilter', () => {
        it('builds filter with @ prefix', () => {
            assert.strictEqual(createWorkspaceFilter('@'), '@*')
        })

        it('builds exclusion filter with ! prefix', () => {
            assert.strictEqual(createWorkspaceFilter('!'), '!*')
        })
    })

    describe('createFolderFilter', () => {
        it('builds filter from relative dir path', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const folder = vscode.workspace.workspaceFolders![0]
            const uri = vscode.Uri.parse('file:///workspace/tests/sub')
            const result = createFolderFilter(folder, uri, '@')
            assert.strictEqual(result, '@sub*')
        })

        it('joins nested dir segments with dots', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const folder = vscode.workspace.workspaceFolders![0]
            const uri = vscode.Uri.parse('file:///workspace/tests/a/b/c')
            const result = createFolderFilter(folder, uri, '@')
            assert.strictEqual(result, '@a.b.c*')
        })
    })

    describe('createModuleFilter', () => {
        it('builds filter with module base name', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const folder = vscode.workspace.workspaceFolders![0]
            const uri = vscode.Uri.parse('file:///workspace/tests/test_foo.py')
            const result = createModuleFilter(folder, uri, '@')
            assert.strictEqual(result, '@test_foo/*')
        })

        it('includes relative path prefix for nested module', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const folder = vscode.workspace.workspaceFolders![0]
            const uri = vscode.Uri.parse('file:///workspace/tests/sub/test_mod.py')
            const result = createModuleFilter(folder, uri, '@')
            assert.strictEqual(result, '@sub.test_mod/*')
        })
    })
})
