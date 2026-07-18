// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Pure test execution helpers for pUnit test adapter.
 * These functions have no process-spawning or vscode-API-side-effect dependencies.
 */

import * as vscode from 'vscode'
import { extractTestResults, ParsedTestResult } from './test-results'
import { getTestPackageName } from './config'
import type { ParsedTestResult as SharedParsedTestResult } from './test-results'

// Use the shared type from test-results.ts instead of duplicating.
type TestResult = SharedParsedTestResult

// ── pure helpers ────────────────────────────────────────────────────────────

/** Generate pUnit CLI arguments for a workspace. */
export function generateToolArgs(workspaceFolder: vscode.WorkspaceFolder): string[] {
    const args: string[] = []
    args.push('--test-package', getTestPackageName(workspaceFolder))
    args.push('--report', 'json')
    args.push('--no-exitcode')
    args.push('--filter', '@stdin')
    return args
}

/** Map a pUnit result into a TestRun pass/fail/skip/error call. */
export function updateTestItemWithResult(
    testRun: vscode.TestRun,
    item: vscode.TestItem,
    testResult: TestResult,
): void {
    switch (testResult.status) {
        case 'pass':
            if (testResult.message) {
                testRun.appendOutput(
                    testResult.message.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'),
                    undefined,
                    item,
                )
            }
            testRun.passed(item, testResult.took)
            break
        case 'fail':
            testRun.failed(item, new vscode.TestMessage(testResult.message!), testResult.took)
            break
        case 'skip':
            testRun.skipped(item)
            break
        case 'error':
            testRun.errored(item, new vscode.TestMessage(testResult.message!), testResult.took)
            break
    }
}

// ── result item lookup ──────────────────────────────────────────────────────

/**
 * Resolve a parsed test result back to a vscode.TestItem using the TestController's
 * item registry. Handles `@data` (dynamic) items by creating them on-demand.
 */
export function getTestItemFromParsedTestResult(
    workspaceFolder: vscode.WorkspaceFolder,
    controller: vscode.TestController,
    parsedResult: TestResult,
): vscode.TestItem | undefined {
    const dataparts = parsedResult.name.split('(')
    const parts = dataparts[0].split('/')
    const moduleParts = parts[0].split('.')
    const workspaceItem = controller.items.get(
        `root:${workspaceFolder.uri}/${getTestPackageName(workspaceFolder)}`,
    )!
    let qnitem: vscode.TestItem = workspaceItem

    for (const modulePart of moduleParts) {
        qnitem.children.forEach(e => {
            if (e.label === modulePart || e.label === `${modulePart}.py`) {
                qnitem = e
                return false
            }
            return true
        })
    }
    for (let i = 1; i < parts.length; i++) {
        qnitem.children.forEach(e => {
            if (e.label === parts[i]) {
                qnitem = e
                return false
            }
            return true
        })
    }

    if (qnitem && dataparts.length > 1) {
        dataparts.shift()
        const the_data: string = `(${dataparts.join(',')}`.replace(',)', ')')
        const dyndata_hash = Buffer.from(parsedResult.name).toString('base64')
        const dyndata_item = controller.createTestItem(
            `dyndata:${qnitem.uri!.with({ fragment: dyndata_hash })}`,
            `${qnitem.label}${the_data}}`,
            qnitem.uri!.with({ fragment: '' }),
        )
        dyndata_item.range = qnitem.range
        qnitem.children.add(dyndata_item)
        return dyndata_item
    }
    return qnitem
}
