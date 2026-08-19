export type SourceLang = "js" | "jsx" | "ts" | "tsx" | "dts";
export type SourceType = "script" | "module" | "commonjs";

export interface BaseNode {
	type: string;
	start: number;
	end: number;
}

export interface Statement extends BaseNode {}
export interface Expression extends BaseNode {}
export interface Pattern extends BaseNode {}

export interface Program extends BaseNode {
	type: "Program";
	body: Array<Statement | TSRXExpression | TSRXJSXElement | TSRXJSXFragment>;
	sourceType: "script" | "module";
	hashbang?: string | null;
}

export interface BlockStatement extends Statement {
	type: "BlockStatement";
	body: Array<Statement | TSRXExpression | TSRXJSXElement | TSRXJSXFragment>;
}

export interface ExpressionStatement extends Statement {
	type: "ExpressionStatement";
	expression: Expression | TSRXExpression;
	directive?: string;
}

export interface VariableDeclarator extends BaseNode {
	type: "VariableDeclarator";
	id: Pattern;
	init: Expression | null;
	definite?: boolean;
}

export interface VariableDeclaration extends Statement {
	type: "VariableDeclaration";
	declarations: VariableDeclarator[];
	kind: "var" | "let" | "const" | "using" | "await using";
	declare?: boolean;
}

export interface ForOfStatement extends Statement {
	type: "ForOfStatement";
	left: VariableDeclaration | Pattern;
	right: Expression;
	body: Statement;
	await: boolean;
	index: Expression | undefined;
	key: Expression | undefined;
}

export interface ForStatement extends Statement {
	type: "ForStatement";
	init: BaseNode | null;
	test: Expression | null;
	update: Expression | null;
	body: Statement;
}

export interface SwitchCase extends BaseNode {
	type: "SwitchCase";
	test: Expression | null;
	consequent: Statement[];
}

export interface SwitchStatement extends Statement {
	type: "SwitchStatement";
	discriminant: Expression;
	cases: SwitchCase[];
}

export interface CatchClause extends BaseNode {
	type: "CatchClause";
	param: Pattern | null;
	body: BlockStatement;
}

export interface TryStatement extends Statement {
	type: "TryStatement";
	block: BlockStatement;
	handler: CatchClause | undefined;
	finalizer: BlockStatement | undefined;
}

export interface JSXCodeBlock extends Expression {
	type: "JSXCodeBlock";
	body: Statement[];
	render: Expression | TSRXExpression | null;
}

export interface JSXIfExpression extends Expression {
	type: "JSXIfExpression";
	test: Expression;
	consequent: BlockStatement;
	alternate: JSXIfExpression | BlockStatement | null;
}

export interface JSXForExpression extends Expression {
	type: "JSXForExpression";
	statement: ForOfStatement | ForStatement;
	empty: BlockStatement | null;
}

export interface JSXSwitchExpression extends Expression {
	type: "JSXSwitchExpression";
	statement: SwitchStatement;
}

export interface JSXTryExpression extends Expression {
	type: "JSXTryExpression";
	statement: TryStatement;
	pending: BlockStatement | null;
}

export interface TSRXExpression extends Expression {
	type: "TSRXExpression";
	expression: Expression;
}

export type JSXName = BaseNode;
export type JSXAttribute = BaseNode;

export interface TSRXJSXOpeningElement extends BaseNode {
	type: "JSXOpeningElement";
	name: JSXName;
	attributes: JSXAttribute[];
	selfClosing: boolean;
	typeArguments: BaseNode | null;
}

export interface TSRXJSXClosingElement extends BaseNode {
	type: "JSXClosingElement";
	name: JSXName;
}

export interface TSRXJSXOpeningFragment extends BaseNode {
	type: "JSXOpeningFragment";
}

export interface TSRXJSXClosingFragment extends BaseNode {
	type: "JSXClosingFragment";
}

export type TSRXJSXChild = BaseNode | TSRXExpression | JSXStyleElement;

export interface TSRXJSXElement extends Expression {
	type: "JSXElement";
	openingElement: TSRXJSXOpeningElement;
	children: TSRXJSXChild[];
	closingElement: TSRXJSXClosingElement | null;
}

export interface TSRXJSXFragment extends Expression {
	type: "JSXFragment";
	openingFragment: TSRXJSXOpeningFragment;
	children: TSRXJSXChild[];
	closingFragment: TSRXJSXClosingFragment;
}

export interface StyleSheet extends BaseNode {
	type: "StyleSheet";
	source: string;
}

export interface JSXStyleElement extends Expression {
	type: "JSXStyleElement";
	openingElement: TSRXJSXOpeningElement;
	children: StyleSheet[];
	closingElement: TSRXJSXClosingElement;
	css: string;
}

export interface DiagnosticLabel {
	message?: string;
	start?: number;
	end?: number;
}

export interface Diagnostic {
	severity: "error" | "warning" | "hint" | "info";
	message: string;
	start: number;
	end: number;
	help: string | null;
	labels: DiagnosticLabel[];
}

export interface Comment extends BaseNode {
	type: "Line" | "Block";
	value: string;
}

export interface ParseResult {
	program: Program;
	comments: BaseNode[];
	diagnostics: Diagnostic[];
}

export interface ParseOptions {
	lang?: SourceLang;
	sourceType?: SourceType;
	preserveParens?: boolean;
	semanticErrors?: boolean;
	attachComments?: boolean;
	loose?: boolean;
}

export interface ParseModuleOptions extends Omit<ParseOptions, "sourceType"> {
	collect?: boolean;
	errors?: Diagnostic[];
	comments?: Comment[];
}

/**
 * Position of a node in the analyzer's flat node table. Every semantic table
 * refers to syntax by this index; `AnalyzerNodeAccess.nodeOf` materializes it.
 */
export type NodeIndex = number;

/** Row index into `SemanticView.scope`. */
export type ScopeId = number;
/** Row index into `SemanticView.symbol`. */
export type SymbolId = number;
/** Row index into `SemanticView.reference`. */
export type ReferenceId = number;

export type ScopeKind =
	| "global"
	| "module"
	| "function"
	| "block"
	| "class"
	| "staticBlock"
	| "expressionName"
	| "tsModule"
	| "functionBody";

/** Which declaration space a reference resolves against. */
export type ReferenceSpace = "value" | "type" | "namespace" | "typeof" | "any";

export type ImportKind =
	| "named"
	| "namespace"
	| "sideEffect"
	| "importEquals"
	| "dynamic"
	| "require";

export type ImportPhase = "source" | "defer";

export type ExportKind = "named" | "reExport" | "namespace" | "star" | "equals" | "global";

/**
 * Lexical scopes, ordered so a scope's parent always precedes it. Scope 0 is
 * the enclosing `global` scope; a module's own bindings live in scope 1.
 */
export interface SemanticScopeTable {
	/** Number of rows. Valid ids are `0` through `count - 1`. */
	count: number;
	kind(id: ScopeId): ScopeKind;
	/** Whether code in this scope runs in strict mode. */
	strict(id: ScopeId): boolean;
	/** The syntax node that introduced the scope. */
	node(id: ScopeId): BaseNode;
	nodeIndex(id: ScopeId): NodeIndex;
	/** Enclosing scope, or `null` for the root `global` scope. */
	parentId(id: ScopeId): ScopeId | null;
	/** Scope that `var` and function declarations hoist into. */
	hoistTargetId(id: ScopeId): ScopeId;
	/** Source offset where `node(id)` starts. */
	start(id: ScopeId): number;
	/** Source offset where `node(id)` ends. */
	end(id: ScopeId): number;
}

/** Bindings introduced by declarations. */
export interface SemanticSymbolTable {
	/** Number of rows. Valid ids are `0` through `count - 1`. */
	count: number;
	name(id: SymbolId): string;
	/**
	 * Bit set describing the binding, as produced by the analyzer. The bit
	 * meanings are owned by the analyzer, not described by this package.
	 */
	flags(id: SymbolId): number;
	/** Scope that owns the binding. */
	scopeId(id: SymbolId): ScopeId;
	/** How many declarations bind this symbol. */
	declCount(id: SymbolId): number;
	/** Declaration site; `declIndex` runs `0` through `declCount(id) - 1`. */
	declNode(id: SymbolId, declIndex: number): BaseNode;
	declNodeIndex(id: SymbolId, declIndex: number): NodeIndex;
}

/** Identifier uses, each resolved to a symbol where one was found. */
export interface SemanticReferenceTable {
	/** Number of rows. Valid ids are `0` through `count - 1`. */
	count: number;
	name(id: ReferenceId): string;
	/** Scope the reference was resolved from. */
	scopeId(id: ReferenceId): ScopeId;
	/** The identifier node making the reference. */
	node(id: ReferenceId): BaseNode;
	nodeIndex(id: ReferenceId): NodeIndex;
	space(id: ReferenceId): ReferenceSpace;
	/** True for the spaces that only occur in type position. */
	inTypePosition(id: ReferenceId): boolean;
	/** True when the reference is the target of an assignment. */
	isWrite(id: ReferenceId): boolean;
	/** Resolved binding, or `null` when the reference is unresolved. */
	symbolId(id: ReferenceId): SymbolId | null;
	/** Source offset where `node(id)` starts. */
	start(id: ReferenceId): number;
	/** Source offset where `node(id)` ends. */
	end(id: ReferenceId): number;
}

/** One row per imported binding or import statement without bindings. */
export interface SemanticImportTable {
	/** Number of rows. Valid ids are `0` through `count - 1`. */
	count: number;
	kind(id: number): ImportKind;
	/** Local binding, or `null` for forms that introduce none. */
	symbolId(id: number): SymbolId | null;
	/** Imported name; the empty string when the form carries none. */
	name(id: number): string;
	/** Module specifier as written in the source. */
	specifier(id: number): string;
	typeOnly(id: number): boolean;
	/** Phase modifier, or `null` when none was written. */
	phase(id: number): ImportPhase | null;
	node(id: number): BaseNode;
}

/** One row per exported name. */
export interface SemanticExportTable {
	/** Number of rows. Valid ids are `0` through `count - 1`. */
	count: number;
	kind(id: number): ExportKind;
	typeOnly(id: number): boolean;
	/** Exported name; the empty string when the form carries none. */
	name(id: number): string;
	/** Local name behind a renamed export; the empty string when not applicable. */
	fromName(id: number): string;
	/** Source module of a re-export; the empty string for a local export. */
	specifier(id: number): string;
	/** Exported binding, or `null` when no local symbol backs the export. */
	symbolId(id: number): SymbolId | null;
	node(id: number): BaseNode;
}

/** Module-level facts collected while analyzing. */
export interface SemanticModuleFlags {
	usesRequire: boolean;
	usesModule: boolean;
	usesExports: boolean;
	usesImportMeta: boolean;
}

/**
 * Semantic tables for one analyzed source. Every table is a column store read
 * through accessors by row id; nothing is materialized until it is asked for.
 */
export interface SemanticView {
	scope: SemanticScopeTable;
	symbol: SemanticSymbolTable;
	reference: SemanticReferenceTable;
	import: SemanticImportTable;
	export: SemanticExportTable;
	moduleFlags: SemanticModuleFlags;
	/** Innermost scope enclosing the node at a given node index. */
	nodeScope(nodeIndex: NodeIndex): ScopeId;
}

/**
 * Node-table navigation shared by every analyzer result. These bridge the
 * semantic tables, which speak in node indexes, to materialized AST nodes.
 */
export interface AnalyzerNodeAccess {
	/** Materializes the node at a node-table index, memoized per result. */
	nodeOf(index: NodeIndex): BaseNode;
	/**
	 * Index of an already-materialized node, or `undefined` when the node did
	 * not come from this result.
	 */
	indexOf(node: BaseNode): NodeIndex | undefined;
	/** Parent node index, or `-1` for the root program. */
	parentIndex(index: NodeIndex): NodeIndex;
	/** Source offset where the node at `index` starts. */
	startOf(index: NodeIndex): number;
	/** Source offset where the node at `index` ends. */
	endOf(index: NodeIndex): number;
	/** Decodes a source slice from an offset and byte length. */
	str(offset: number, length: number): string;
}

export interface AnalyzeResult extends ParseResult, AnalyzerNodeAccess {
	readonly semantic: SemanticView;
}

/**
 * Result of decoding an analyzer buffer directly. `semantic` is `null` when the
 * buffer was produced without semantic data; buffers from `analyze` always
 * carry it.
 */
export interface DecodeAnalyzerResult extends ParseResult, AnalyzerNodeAccess {
	readonly semantic: SemanticView | null;
}

export interface GenerateOptions {
	strip?: boolean;
	minify?: boolean | { whitespace?: boolean; syntax?: boolean; quotes?: boolean };
	format?: "pretty" | "compact";
	indent?: number;
	quotes?: "preserve" | "double" | "single" | "shortest";
	comments?: boolean | "all" | "some" | "none" | "line" | "block";
}

export interface GenerateResult {
	code: string;
	errors: Array<{ message: string; start: number; end: number }>;
	map: unknown | null;
}

export type WalkVisitor = (
	node: BaseNode,
	context: { parent: BaseNode | null; state: unknown },
) => void;
export type Visitors = Record<
	string,
	WalkVisitor | { enter?: WalkVisitor; leave?: WalkVisitor }
> & {
	enter?: WalkVisitor;
	leave?: WalkVisitor;
};

export function parse(source: string | Uint8Array, options?: ParseOptions): ParseResult;
export function analyze(source: string | Uint8Array, options?: ParseOptions): AnalyzeResult;
export function generate(program: Program, options?: GenerateOptions): GenerateResult;
export function parseWire(source: string | Uint8Array, options?: ParseOptions): ArrayBuffer;
export function parseModule(
	source: string | Uint8Array,
	filename: string,
	options?: ParseModuleOptions,
): Program;
export function isEventAttribute(attribute: string): boolean;
export function normalizeEventName(attribute: string): string;
export function walk<T extends BaseNode>(root: T, visitors: Visitors, state?: unknown): T;
export function decode(buffer: ArrayBuffer, source: string): ParseResult;
export function decodeAnalyzer(buffer: ArrayBuffer, source: string): DecodeAnalyzerResult;
export function encode(program: Program): ArrayBuffer;
