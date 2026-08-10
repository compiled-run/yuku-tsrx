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
export function parseWire(source: string | Uint8Array, options?: ParseOptions): ArrayBuffer;
export function parseModule(
	source: string | Uint8Array,
	filename: string,
	options?: Omit<ParseOptions, "sourceType">,
): Program;
export function walk<T extends BaseNode>(root: T, visitors: Visitors, state?: unknown): T;
export function decode(buffer: ArrayBuffer, source: string): ParseResult;
export function decodeAnalyzer(buffer: ArrayBuffer, source: string): unknown;
export function encode(program: Program): ArrayBuffer;
