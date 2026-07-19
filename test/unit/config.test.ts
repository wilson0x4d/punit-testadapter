// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT
// @trait('integration')

/**
 * Unit tests for config.ts — workspace configuration accessors.
 */

import { describe, it, afterEach } from 'mocha'
import * as assert from 'assert'
import * as vscode from 'vscode'
import * as config from '../../src/config'
import { mockVscodeWorkspace } from './vscode-mock'

describe('config.ts', () => {
    let restore: (() => void) | undefined

    afterEach(() => {
        restore?.()
    })

    describe('getTestPackageName', () => {
        it('returns configured value', () => {
            [restore] = mockVscodeWorkspace(vscode, 'my_tests')
            const folder = vscode.workspace.workspaceFolders![0]
            assert.strictEqual(config.getTestPackageName(folder), 'my_tests')
        })

        it('returns default "tests" when empty', () => {
            [restore] = mockVscodeWorkspace(vscode, '')
            const folder = vscode.workspace.workspaceFolders![0]
            assert.strictEqual(config.getTestPackageName(folder), 'tests')
        })

        it('trims whitespace', () => {
            [restore] = mockVscodeWorkspace(vscode, '   ')
            const folder = vscode.workspace.workspaceFolders![0]
            assert.strictEqual(config.getTestPackageName(folder), 'tests')
        })
    })

    describe('getWatcherPattern', () => {
        it('wraps test package with glob pattern', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const folder = vscode.workspace.workspaceFolders![0]
            assert.strictEqual(config.getWatcherPattern(folder), '**/tests/**/*.py')
        })

        it('handles custom package name', () => {
            [restore] = mockVscodeWorkspace(vscode, 'spec')
            const folder = vscode.workspace.workspaceFolders![0]
            assert.strictEqual(config.getWatcherPattern(folder), '**/spec/**/*.py')
        })
    })

    describe('getJustMyCode', () => {
        it('returns true by default', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const folder = vscode.workspace.workspaceFolders![0]
            assert.strictEqual(config.getJustMyCode(folder), true)
        })
    })

    describe('getParallelism', () => {
        it('returns true by default', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            const folder = vscode.workspace.workspaceFolders![0]
            assert.strictEqual(config.getParallelism(folder), true)
        })

        it('returns false when configured', () => {
            [restore] = mockVscodeWorkspace(vscode, 'tests')
            Object.defineProperty(vscode.workspace, 'getConfiguration', {
                value: () => ({ get: (_: string, _def: boolean) => false }),
                configurable: true,
            })
            const folder = vscode.workspace.workspaceFolders![0]
            assert.strictEqual(config.getParallelism(folder), false)
        })
    })
})
