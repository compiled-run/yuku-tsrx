import { expectTypeOf, test } from "vitest";
import type {
	BlockStatement,
	Expression,
	ForOfStatement,
	JSXCodeBlock,
	JSXForExpression,
	JSXIfExpression,
	JSXStyleElement,
	JSXSwitchExpression,
	JSXTryExpression,
	Program,
	StyleSheet,
	TSRXExpression,
	TSRXJSXElement,
	TSRXJSXFragment,
	VariableDeclaration,
} from "yuku-tsrx";

const expression: Expression = { type: "Identifier", start: 1, end: 2 };
const tsrxExpression: TSRXExpression = {
	type: "TSRXExpression",
	start: 1,
	end: 2,
	expression,
};
const block: BlockStatement = { type: "BlockStatement", start: 0, end: 2, body: [] };
const declaration: VariableDeclaration = {
	type: "VariableDeclaration",
	start: 0,
	end: 1,
	declarations: [],
	kind: "const",
};
const forOf: ForOfStatement = {
	type: "ForOfStatement",
	start: 0,
	end: 2,
	left: declaration,
	right: expression,
	body: block,
	await: false,
	index: undefined,
	key: undefined,
};
const codeBlock: JSXCodeBlock = {
	type: "JSXCodeBlock",
	start: 0,
	end: 2,
	body: [],
	render: expression,
};
const ifExpression: JSXIfExpression = {
	type: "JSXIfExpression",
	start: 0,
	end: 2,
	test: expression,
	consequent: block,
	alternate: null,
};
const forExpression: JSXForExpression = {
	type: "JSXForExpression",
	start: 0,
	end: 2,
	statement: forOf,
	empty: null,
};
const switchExpression: JSXSwitchExpression = {
	type: "JSXSwitchExpression",
	start: 0,
	end: 2,
	statement: {
		type: "SwitchStatement",
		start: 0,
		end: 2,
		discriminant: expression,
		cases: [],
	},
};
const tryExpression: JSXTryExpression = {
	type: "JSXTryExpression",
	start: 0,
	end: 2,
	statement: {
		type: "TryStatement",
		start: 0,
		end: 2,
		block,
		handler: undefined,
		finalizer: undefined,
	},
	pending: null,
};
const sheet: StyleSheet = { type: "StyleSheet", start: 1, end: 2, source: "a{}" };
const style: JSXStyleElement = {
	type: "JSXStyleElement",
	start: 0,
	end: 2,
	openingElement: {
		type: "JSXOpeningElement",
		start: 0,
		end: 1,
		name: expression,
		attributes: [],
		selfClosing: false,
		typeArguments: null,
	},
	children: [sheet],
	closingElement: { type: "JSXClosingElement", start: 1, end: 2, name: expression },
	css: "a{}",
};
const element: TSRXJSXElement = {
	type: "JSXElement",
	start: 0,
	end: 2,
	openingElement: style.openingElement,
	children: [codeBlock, ifExpression, style],
	closingElement: style.closingElement,
};
const fragment: TSRXJSXFragment = {
	type: "JSXFragment",
	start: 0,
	end: 2,
	openingFragment: { type: "JSXOpeningFragment", start: 0, end: 1 },
	children: [forExpression, switchExpression, tryExpression],
	closingFragment: { type: "JSXClosingFragment", start: 1, end: 2 },
};
const program: Program = {
	type: "Program",
	start: 0,
	end: 2,
	body: [element, fragment],
	sourceType: "module",
};

test("exports structurally useful TSRX consumer types", () => {
	expectTypeOf(tsrxExpression).toMatchTypeOf<TSRXExpression>();
	expectTypeOf<TSRXExpression>().not.toEqualTypeOf<JSXCodeBlock>();
	expectTypeOf(program).toMatchTypeOf<Program>();
});
