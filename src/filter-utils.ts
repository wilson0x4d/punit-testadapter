// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Pure path manipulation for pUnit test filters.
 * Zero vscode dependencies — testable in plain Node.js.
 */

import * as path from 'node:path'

/**
 * Split a relative path by OS separator and join with the given separator.
 * Empty input returns empty string.
 */
export function joinPathSegments(relPath: string, separator: string): string {
    if (relPath.length === 0) {
        return ''
    }
    return relPath.split(/[/\\]/).join(separator)
}

/**
 * Build a filter string: `${prefix}${pathPart}${suffix}`
 */
export function buildFilter(prefix: string, pathPart: string, suffix: string): string {
    return `${prefix}${pathPart}${suffix}`
}
