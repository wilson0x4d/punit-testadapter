// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Detect whether a Python file is a pUnit test candidate.
 * Pure function — zero vscode or external dependencies.
 */

/** Check if Python source content references the pUnit framework. */
export function isTestCandidate(content: string): boolean {
    return content.includes('import punit') || content.includes('from punit')
}
