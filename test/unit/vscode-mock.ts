// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Mock helper for vscode.workspace in vscode-test unit tests.
 * vscode.workspace properties are read-only getters — we use
 * Object.defineProperty to temporarily override them.
 */

import * as vscode from 'vscode'

interface SavedProps {
    config: PropertyDescriptor | undefined
    folders: PropertyDescriptor | undefined
}

/**
 * Override vscode.workspace.getConfiguration and workspaceFolders for testing.
 * Returns a restore function to be called after the test.
 */
export function mockVscodeWorkspace(testPackage: string): [() => void, vscode.WorkspaceFolder] {
    const saved: SavedProps = {
        config: Object.getOwnPropertyDescriptor(vscode.workspace, 'getConfiguration'),
        folders: Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders'),
    }

    const mockConfig: vscode.WorkspaceConfiguration = {
        get<T>(section: string, defaultValue?: T): T | undefined {
            if (section === '--test-package') return testPackage as unknown as T
            if (section === 'just_my_code') return true as unknown as T
            if (section === 'PYTHONPATH') return undefined
            return defaultValue
        },
        has: () => false,
        inspect: () => undefined,
        update: () => Promise.resolve(),
        onDidChange: () => ({ dispose() {} }),
        willReload: false,
    }

    const mockFolder: vscode.WorkspaceFolder = {
        uri: vscode.Uri.parse('file:///workspace'),
        name: 'w',
        index: 0,
    }

    const origGetConfig = vscode.workspace.getConfiguration
    Object.defineProperty(vscode.workspace, 'getConfiguration', {
        value: ((s?: string, scope?: vscode.ConfigurationScope | null) => {
            if (s === 'punit') return mockConfig
            return origGetConfig!(s, scope) as vscode.WorkspaceConfiguration
        }) as any,
        configurable: true,
        writable: true,
    })
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        value: [mockFolder],
        writable: true,
        configurable: true,
    })

    const restore = () => {
        if (saved.config) {
            Object.defineProperty(vscode.workspace, 'getConfiguration', saved.config)
        }
        if (saved.folders) {
            Object.defineProperty(vscode.workspace, 'workspaceFolders', saved.folders)
        }
    }

    return [restore, mockFolder]
}
