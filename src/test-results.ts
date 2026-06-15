// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Pure utility functions for parsing pUnit test output.
 * This module has zero vscode dependencies and can be tested in plain Node.js.
 */

export type TestResultStatus = 'pass' | 'fail' | 'skip' | 'error'

export interface ParsedTestResult {
    status: TestResultStatus
    name: string
    took: number
    message: string | undefined
}

/**
 * Extract test results JSON from pUnit command output.
 * The output may contain whitespace, logs, or other text before the JSON array.
 * This function finds the first valid `[{"...}]` substring and parses it.
 */
export function extractTestResults<T = unknown>(input: string): T {
    const trimmed = input.trimEnd()
    let i = 0
    while (true) {
        const idx = trimmed.indexOf('[{"', i)
        if (idx === -1) {
            break
        }
        const candidate = trimmed.slice(idx)
        try {
            return JSON.parse(candidate) as T
        } catch {
            i = idx + 1
        }
    }
    throw new Error('Unable to extract test results from output.')
}
