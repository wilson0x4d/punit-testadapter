// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * JSON-RPC 2.0 types shared between the AST service and its TypeScript client.
 */

interface JsonRpcRequest {
    jsonrpc: '2.0'
    method: string
    params?: Record<string, unknown>
    id: number
}

interface JsonRpcSuccessResponse {
    jsonrpc: '2.0'
    result: unknown
    id: number | null
}

interface JsonRpcErrorResponse {
    jsonrpc: '2.0'
    error: { code: number; message: string; data?: unknown }
    id: number | null
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse

export type {
    JsonRpcRequest,
    JsonRpcSuccessResponse,
    JsonRpcErrorResponse,
    JsonRpcResponse,
}
