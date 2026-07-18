// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * Pure AST analysis helpers for decorator detection and test tag extraction.
 * Zero vscode dependencies — testable in plain Node.js.
 */

import type { ExprNode, Name, Attribute, Call, Constant } from './py_ast_types'

/**
 * Check if a decorator list contains any of the given decorator names.
 * Handles plain Name decorators (e.g. @fact), Attribute decorators (e.g. @data.fact),
 * and Call decorators (e.g. @fact or @trait('smoke')).
 */
export function hasDecorator(decorator_list: ExprNode[] | undefined, decoratorNames: string[]): boolean {
    if (!decorator_list) {
        return false
    }
    for (const decorator_node of decorator_list) {
        if (matchesDecoratorName(decorator_node, decoratorNames)) {
            return true
        }
    }
    return false
}

/**
 * Extract raw trait tag strings from a decorator list.
 * Returns values like "smoke" or "smoke:regression".
 */
export function extractTraitTags(decorator_list: ExprNode[] | undefined): string[] {
    const results: string[] = []
    if (!decorator_list) {
        return results
    }
    for (const decorator_node of decorator_list) {
        if (decorator_node.nodeType !== 'Call') {
            continue
        }
        const call = decorator_node as Call
        const funcId = extractDecoratorFunctionName(call)
        if (funcId !== 'trait') {
            continue
        }
        if (call.args.length > 1) {
            const a0 = (call.args[0] as unknown as Constant).value
            const a1 = (call.args[1] as unknown as Constant).value
            if (typeof a0 === 'string' && typeof a1 === 'string') {
                results.push(`${a0}:${a1}`)
            }
        } else if (call.args.length > 0) {
            const a0 = (call.args[0] as unknown as Constant).value
            if (typeof a0 === 'string') {
                results.push(a0)
            }
        }
    }
    return results
}

// ── internal helpers (not exported) ────────────────────────────────────────

function extractDecoratorFunctionName(call: Call): string {
    let id = ''
    if (call.func.nodeType === 'Name') {
        id = (call.func as Name).id
    } else if (call.func.nodeType === 'Attribute') {
        id = (call.func as Attribute).attr
    }
    return id
}

function matchesDecoratorName(decorator_node: ExprNode, decoratorNames: string[]): boolean {
    switch (decorator_node.nodeType) {
        case 'Name':
            return decoratorNames.includes((decorator_node as unknown as Name).id)
        case 'Call': {
            const call = decorator_node as Call
            const id = extractDecoratorFunctionName(call)
            return decoratorNames.includes(id)
        }
        case 'Attribute':
            return decoratorNames.includes((decorator_node as unknown as Attribute).attr)
        default:
            return false
    }
}
