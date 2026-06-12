// SPDX-FileCopyrightText: © 2026 Shaun Wilson
// SPDX-License-Identifier: MIT

/**
 * TypeScript type definitions for Python's AST module.
 *
 * These types are the schema contract between the Python JSON-RPC service
 * (resources/ast_service.py) and the extension's TypeScript client (ast_service.ts).
 * All standard Python AST node types from 3.11+ are included for future reuse.
 */

// ── Core Base ────────────────────────────────────────────────────────────────

/** Every AST node carries location info; lineno/col_offset required, end variants optional */
export interface AstNode {
    readonly nodeType: string
    readonly lineno?: number
    readonly col_offset?: number
    readonly end_lineno?: number | null
    readonly end_col_offset?: number | null
}

// ── Module ───────────────────────────────────────────────────────────────────

interface Module extends AstNode {
    readonly nodeType: 'Module'
    readonly type_ignores?: string[] | null
    body: StmtNode[]
}

// ── Statement Nodes ──────────────────────────────────────────────────────────

type StmtNode =
    | FunctionDef
    | AsyncFunctionDef
    | ClassDef
    | Return
    | Delete
    | Assign
    | AnnAssign
    | AugAssign
    | TypeAlias
    | For
    | AsyncFor
    | While
    | If
    | With
    | AsyncWith
    | Match
    | Raise
    | Try
    | Assert
    | Import
    | ImportFrom
    | Global
    | Nonlocal
    | Expr
    | Pass
    | Break
    | Continue

interface FunctionDef extends AstNode {
    readonly lineno: number
    readonly col_offset: number
    readonly nodeType: 'FunctionDef'
    name: string
    args: Arguments
    body: StmtNode[]
    decorator_list: ExprNode[]
    returns?: ExprNode | null
    type_comment?: string | null
}

interface AsyncFunctionDef extends AstNode {
    readonly nodeType: 'AsyncFunctionDef'
    name: string
    args: Arguments
    body: StmtNode[]
    decorator_list: ExprNode[]
    returns?: ExprNode | null
    type_comment?: string | null
}

interface ClassDef extends AstNode {
    readonly lineno: number
    readonly col_offset: number
    readonly nodeType: 'ClassDef'
    name: string
    bases: ExprNode[]
    keywords: Keyword[]
    body: StmtNode[]
    decorator_list: ExprNode[]
}

interface Return extends AstNode {
    readonly nodeType: 'Return'
    value?: ExprNode | null
}

interface Delete extends AstNode {
    readonly nodeType: 'Delete'
    targets: ExprNode[]
}

interface Assign extends AstNode {
    readonly nodeType: 'Assign'
    targets: ExprNode[]
    value: ExprNode
}

interface AnnAssign extends AstNode {
    readonly nodeType: 'AnnAssign'
    target: ExprNode
    annotation: ExprNode
    value?: ExprNode | null
    simple: number
}

interface AugAssign extends AstNode {
    readonly nodeType: 'AugAssign'
    target: ExprNode
    op: OperatorNode
    value: ExprNode
}

type TypeParamNode = Name | ExprNode

interface TypeAlias extends AstNode {
    readonly nodeType: 'TypeAlias'
    name: ExprNode
    type_params: TypeParamNode[]
    value: ExprNode
}

interface For extends AstNode {
    readonly nodeType: 'For'
    target: ExprNode
    iter: ExprNode
    body: StmtNode[]
    orelse: StmtNode[]
}

interface AsyncFor extends AstNode {
    readonly nodeType: 'AsyncFor'
    target: ExprNode
    iter: ExprNode
    body: StmtNode[]
    orelse: StmtNode[]
}

interface While extends AstNode {
    readonly nodeType: 'While'
    test: ExprNode
    body: StmtNode[]
    orelse: StmtNode[]
}

interface If extends AstNode {
    readonly nodeType: 'If'
    test: ExprNode
    body: StmtNode[]
    orelse: StmtNode[]
}

interface With extends AstNode {
    readonly nodeType: 'With'
    items: WithItem[]
    body: StmtNode[]
}

interface AsyncWith extends AstNode {
    readonly nodeType: 'AsyncWith'
    items: WithItem[]
    body: StmtNode[]
}

interface Match extends AstNode {
    readonly nodeType: 'Match'
    subject: ExprNode
    cases: MatchCase[]
}

interface Raise extends AstNode {
    readonly nodeType: 'Raise'
    exc?: ExprNode | null
    cause?: ExprNode | null
}

interface Try extends AstNode {
    readonly nodeType: 'Try'
    body: StmtNode[]
    handlers: ExceptHandler[]
    orelse: StmtNode[]
    finalbody: StmtNode[]
}

interface Assert extends AstNode {
    readonly nodeType: 'Assert'
    test: ExprNode
    msg?: ExprNode | null
}

interface Import extends AstNode {
    readonly nodeType: 'Import'
    names: Alias[]
}

interface ImportFrom extends AstNode {
    readonly nodeType: 'ImportFrom'
    module?: string | null
    names: Alias[]
    level?: number | null
}

interface Global extends AstNode {
    readonly nodeType: 'Global'
    names: string[]
}

interface Nonlocal extends AstNode {
    readonly nodeType: 'Nonlocal'
    names: string[]
}

interface Expr extends AstNode {
    readonly nodeType: 'Expr'
    value: ExprNode
}

interface Pass extends AstNode {
    readonly nodeType: 'Pass'
}

interface Break extends AstNode {
    readonly nodeType: 'Break'
}

interface Continue extends AstNode {
    readonly nodeType: 'Continue'
}

// ── Expression Nodes ─────────────────────────────────────────────────────────

type ExprNode =
    | BoolOpNode
    | BinOpNode
    | UnaryOpNode
    | Lambda
    | IfExp
    | DictExpr
    | Set
    | ListComp
    | SetComp
    | DictComp
    | GeneratorExp
    | Await
    | Yield
    | YieldFrom
    | Subscript
    | Starred
    | Name
    | Constant
    | FormattedValue
    | JoinedStr
    | Attribute
    | NamedExpr
    | Call

interface BoolOpNode extends AstNode {
    readonly nodeType: 'BoolOp'
    op: string  // 'And' | 'Or'
    values: ExprNode[]
}

interface BinOpNode extends AstNode {
    readonly nodeType: 'BinOp'
    left: ExprNode
    op: OperatorNode
    right: ExprNode
}

interface UnaryOpNode extends AstNode {
    readonly nodeType: 'UnaryOp'
    op: string  // 'UAdd' | 'USub' | 'Invert' | 'Not'
    operand: ExprNode
}

interface Lambda extends AstNode {
    readonly nodeType: 'Lambda'
    args: Arguments
    body: ExprNode
}

interface IfExp extends AstNode {
    readonly nodeType: 'IfExp'
    test: ExprNode
    body: ExprNode
    orelse: ExprNode
}

// Dict expression (renamed from Dict to avoid clashing with JS keyword)
interface DictExpr extends AstNode {
    readonly nodeType: 'Dict'
    keys: (ExprNode | null)[]
    values: ExprNode[]
}

interface Set extends AstNode {
    readonly nodeType: 'Set'
    elts: ExprNode[]
}

interface ListComp extends AstNode {
    readonly nodeType: 'ListComp'
    elt: ExprNode
    generators: Comprehension[]
}

interface SetComp extends AstNode {
    readonly nodeType: 'SetComp'
    elt: ExprNode
    generators: Comprehension[]
}

interface DictComp extends AstNode {
    readonly nodeType: 'DictComp'
    key: ExprNode
    value: ExprNode
    generators: Comprehension[]
}

interface GeneratorExp extends AstNode {
    readonly nodeType: 'GeneratorExp'
    elt: ExprNode
    generators: Comprehension[]
}

interface Await extends AstNode {
    readonly nodeType: 'Await'
    value: ExprNode
}

interface Yield extends AstNode {
    readonly nodeType: 'Yield'
    value?: ExprNode | null
}

interface YieldFrom extends AstNode {
    readonly nodeType: 'YieldFrom'
    value: ExprNode
}

interface Subscript extends AstNode {
    readonly nodeType: 'Subscript'
    value: ExprNode
    slice: ExprNode
    ctx: string  // 'Load' | 'Store' | 'Del'
}

interface Starred extends AstNode {
    readonly nodeType: 'Starred'
    value: ExprNode
    ctx: string
}

/** Name reference (e.g. `x` in `x + 1`) — used by hasDecorator() reads .id */
export interface Name extends AstNode {
    readonly nodeType: 'Name'
    id: string
    ctx: string  // 'Load' | 'Store' | 'Del'
}

/** Constant literal (str, int, float, bool, None, bytes, ellipsis) — used by getTestTags() reads .value */
export interface Constant extends AstNode {
    readonly nodeType: 'Constant'
    value: string | number | boolean | null | object
    kind?: string | null
}

interface FormattedValue extends AstNode {
    readonly nodeType: 'FormattedValue'
    value: ExprNode
    conversion: number  // -1, 0 (repr), 1 (str), 2 (ascii)
    format_spec?: JoinedStr | null
}

interface JoinedStr extends AstNode {
    readonly nodeType: 'JoinedStr'
    values: ExprNode[]
}

/** Attribute access (e.g. `obj.method`) — used by hasDecorator() reads .attr */
export interface Attribute extends AstNode {
    readonly nodeType: 'Attribute'
    value: ExprNode
    attr: string
    ctx: string
}

interface NamedExpr extends AstNode {
    readonly nodeType: 'NamedExpr'
    target: ExprNode
    value: ExprNode
}

/** Call expression — used by hasDecorator() and getTestTags() reads .func, .args[0].value */
export interface Call extends AstNode {
    readonly nodeType: 'Call'
    func: ExprNode
    args: ExprNode[]
    keywords: Keyword[]
}

// ── Supporting Types ─────────────────────────────────────────────────────────

/** Function / method argument specification */
interface Arguments extends AstNode {
    readonly nodeType: 'arguments'
    posonlyargs: Arg[]
    args: Arg[]
    vararg?: Arg | null
    kwonlyargs: Arg[]
    kw_defaults: (ExprNode | null)[]
    kwarg?: Arg | null
    defaults: ExprNode[]
}

/** Single function argument */
interface Arg extends AstNode {
    readonly nodeType: 'arg'
    arg: string
    annotation?: ExprNode | null
    type_comment?: string | null
}

interface Keyword extends AstNode {
    readonly nodeType: 'keyword'
    arg?: string | null
    value: ExprNode
}

interface Alias extends AstNode {
    readonly nodeType: 'alias'
    name: string
    asname?: string | null
}

interface Comprehension extends AstNode {
    readonly nodeType: 'comprehension'
    target: ExprNode
    iter: ExprNode
    ifs: ExprNode[]
    is_async: number
}

interface ExceptHandler extends AstNode {
    readonly nodeType: 'ExceptHandler'
    type?: ExprNode | null
    name?: string | null
    body: StmtNode[]
}

interface WithItem extends AstNode {
    readonly nodeType: 'withitem'
    context_expr: ExprNode
    optional_vars?: ExprNode | null
}

// ── Pattern Nodes (match/case, Python 3.10+) ────────────────────────────────

type PatternNode =
    | MatchValue
    | MatchSingleton
    | MatchSequence
    | MatchMapping
    | MatchClass
    | MatchStar
    | MatchAs
    | MatchOr

interface MatchCase extends AstNode {
    readonly nodeType: 'match_case'
    pattern: PatternNode
    guard?: ExprNode | null
    body: StmtNode[]
}

interface MatchValue extends AstNode {
    readonly nodeType: 'MatchValue'
    value: ExprNode
}

interface MatchSingleton extends AstNode {
    readonly nodeType: 'MatchSingleton'
    value: boolean | null  // True, False, None
}

interface MatchSequence extends AstNode {
    readonly nodeType: 'MatchSequence'
    patterns: PatternNode[]
}

interface MatchMapping extends AstNode {
    readonly nodeType: 'MatchMapping'
    keys: ExprNode[]
    patterns: PatternNode[]
    rest?: string | null
}

interface MatchClass extends AstNode {
    readonly nodeType: 'MatchClass'
    cls: ExprNode
    patterns: PatternNode[]
    kwd_attrs: string[]
    kwd_patterns: PatternNode[]
}

interface MatchStar extends AstNode {
    readonly nodeType: 'MatchStar'
    name?: string | null
}

interface MatchAs extends AstNode {
    readonly nodeType: 'MatchAs'
    pattern?: PatternNode | null
    name?: string | null
}

interface MatchOr extends AstNode {
    readonly nodeType: 'MatchOr'
    patterns: PatternNode[]
}

// ── Operator Type Aliases ────────────────────────────────────────────────────

type OperatorType =
    | 'Add' | 'Sub' | 'Mult' | 'MatMult' | 'Div' | 'Mod' | 'Pow'
    | 'LShift' | 'RShift' | 'BitOr' | 'BitXor' | 'BitAnd' | 'FloorDiv'
    | 'UAdd' | 'USub' | 'Invert' | 'Not'

type OperatorNode = OperatorType

// ── JSON-RPC Types (re-exported from json_rpc_types.ts) ─────────────────────

// Required to make this file a module.
export {}

/** Convenience re-export of core node types for consumers that import from py_ast_types. */
export type {
    Module,
    FunctionDef,
    AsyncFunctionDef,
    ClassDef,
    ExprNode,
    StmtNode,
}

