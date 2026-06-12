# SPDX-FileCopyrightText: © 2026 Shaun Wilson
# SPDX-License-Identifier: MIT

"""Background AST parsing service.

Reads JSON-RPC 2.0 requests from stdin (one-line-per-request),
parses Python source using the builtin ``ast`` module, and writes
JSON responses to stdout (one-line-per-response).

Methods
-------
parseFile : Parse *source* string provided in ``params['source']``.
parseRaw  : Parse a file on disk at *params['path']*.
ping      : Health check — returns ``{'status': 'ok'}``.
shutdown  : Graceful exit (Python process terminates after responding).

Supported Python versions
-------------------------
3.11+  -- matches the extension's minimum interpreter requirement.

"""

from __future__ import annotations

import ast as _ast
import json
import sys
from pathlib import Path
from typing import Any, Dict

# ── constants ────────────────────────────────────────────────────────────────

_METHODS: Dict[str, str] = {
    'parseFile': 'Parse source code string',
    'parseRaw': 'Parse file on disk',
    'ping': 'Health check',
    'shutdown': 'Graceful exit',
}

# ── helpers ──────────────────────────────────────────────────────────────────


def __serialize_field(value: Any) -> Any:
    """Recursively serialize an AST field to a JSON-compatible Python object.

    Returns *None* for None values, dicts for AST nodes, lists for sequences,
    and the raw value for all others (strings, numbers, booleans, bytes).

    """
    if value is None:
        return None

    # Recurse into AST nodes
    if isinstance(value, _ast.AST):
        return __node_to_dict(value)

    # Lists of items
    if isinstance(value, list):
        return [__serialize_field(item) for item in value]

    # Constants -- str / int / float / bool
    if isinstance(value, (str, int, float, bool)):
        return value

    # Ellipsis literal
    if value is ...:
        return '...'

    # Bytes -- decode as latin-1 (AST bytes literals may contain non-UTF-8)
    if isinstance(value, bytes):
        return value.decode('latin-1')

    # type_param nodes (list of AST subclasses) handled via recursion above

    # Fallback -- shouldn't happen for standard AST, but be safe
    return str(value)


def __node_to_dict(node: _ast.AST) -> Dict[str, Any]:
    """Convert a Python AST node to a JSON-serializable dictionary.

    Preserves **all** fields from the node's ``_fields`` attribute so the
    TypeScript client can inspect any field it wishes.  Location attributes
    (lineno, col_offset, end_lineno, end_col_offset) are always present when
    the underlying Python AST provides them.

    Important: *decorator_list* is always produced as a list (never None / null),
    matching py-ast's behaviour and keeping the TypeScript truthiness check
    ``if (decorator_list)`` consistent.  An empty decorator list serialises to
    an empty JSON array ``[]``, which is still truthy in JS so the for-loop
    iterates zero times and falls through correctly.

    """
    result: Dict[str, Any] = {}

    # Always include location info when available
    for attr in ('lineno', 'col_offset', 'end_lineno', 'end_col_offset'):
        if hasattr(node, attr):
            result[attr] = getattr(node, attr)

    # Add the type name (the AST class name -- this is nodeType in TS)
    result['nodeType'] = type(node).__name__

    # Serialize every declared field from _fields
    for field in getattr(node, '_fields', ()):
        result[field] = __serialize_field(getattr(node, field))

    return result


def __send_response(response: Dict[str, Any]) -> None:
    """Write a JSON response line to stdout and flush immediately."""
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def __send_error(error_code: int, message: str, request_id: Any = None) -> None:
    """Write an error response line."""
    __send_response({
        'jsonrpc': '2.0',
        'error': {'code': error_code, 'message': message},
        'id': request_id,
    })


# ── method handlers ──────────────────────────────────────────────────────────


def __handle_parse_file(params: Dict[str, Any]) -> Dict[str, Any]:
    """Parse source code provided in params['source']."""
    source = params.get('source', '')
    tree = _ast.parse(source, filename='<stdin>')
    return __node_to_dict(tree)


def __handle_parse_raw(params: Dict[str, Any]) -> Dict[str, Any]:
    """Parse a file on disk at params['path']."""
    path_str = params.get('path', '')
    if not path_str:
        raise ValueError("Missing 'path' in params")
    source = Path(path_str).read_text(encoding='utf-8')
    tree = _ast.parse(source, filename=path_str)
    return __node_to_dict(tree)


def __handle_ping(_params: Dict[str, Any]) -> Dict[str, str]:
    """Return health status."""
    return {'status': 'ok'}


# ── dispatch table ───────────────────────────────────────────────────────────

_HANDLERS = {
    'parseFile': __handle_parse_file,
    'parseRaw': __handle_parse_raw,
    'ping': __handle_ping,
}


# ── main loop ────────────────────────────────────────────────────────────────


def main() -> int:
    """Run the JSON-RPC service loop until shutdown or EOF."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        # Parse request
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            __send_error(-32600, f'Invalid JSON: {exc}')
            continue

        method = request.get('method')
        request_id = request.get('id')

        # Shutdown is special -- no dispatch needed
        if method == 'shutdown':
            __send_response({
                'jsonrpc': '2.0',
                'result': {'status': 'ok'},
                'id': request_id,
            })
            return 0

        # Look up handler
        handler = _HANDLERS.get(method)
        if handler is None:
            __send_error(-32601, f'Method not found: {method}', request_id)
            continue

        try:
            params = request.get('params') or {}
            result = handler(params)
            __send_response({
                'jsonrpc': '2.0',
                'result': result,
                'id': request_id,
            })
        except SyntaxError as exc:
            line_no = f' at line {exc.lineno}' if exc.lineno else ''
            __send_error(-32603, f'SyntaxError{line_no}: {exc.msg}', request_id)
        except FileNotFoundError as exc:
            __send_error(-32603, f'File not found: {exc.filename}', request_id)
        except ValueError as exc:
            __send_error(-32602, f'Invalid params: {exc}', request_id)
        except Exception as exc:
            __send_error(-32603, f'Internal error: {exc}', request_id)

    # EOF -- treat like shutdown
    return 0


if __name__ == '__main__':
    sys.exit(main())
