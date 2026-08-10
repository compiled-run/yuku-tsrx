import { expect, test } from "vitest";
import {
	isEventAttribute,
	normalizeEventName,
	parseModule,
	walk,
	type Comment,
	type Diagnostic,
	type JSXForExpression,
} from "yuku-tsrx";

test("collects structured parser diagnostics without weakening strict mode", () => {
	const source = "const = ;";
	const errors: Diagnostic[] = [];
	const program = parseModule(source, "broken.tsrx", { collect: true, errors });

	expect(program.type).toBe("Program");
	expect(errors).toHaveLength(1);
	expect(errors[0]).toMatchObject({
		severity: "error",
		message: expect.any(String),
		start: expect.any(Number),
		end: expect.any(Number),
		labels: expect.any(Array),
	});
	expect(() => parseModule(source, "broken.tsrx")).toThrow(SyntaxError);
});

test("loose parsing returns a usable tree and preserves collected comments", () => {
	const source = "export function App() @{ <div>{/* kept */}<span>text</div> }";
	const errors: Diagnostic[] = [];
	const comments: Comment[] = [];
	const program = parseModule(source, "App.tsrx", {
		collect: true,
		loose: true,
		errors,
		comments,
	});

	expect(program.type).toBe("Program");
	expect(errors).toEqual([]);
	expect(comments).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ type: "Block", value: " kept ", start: 31, end: 41 }),
		]),
	);
});

test("exports Markless-compatible event attribute helpers", () => {
	expect(isEventAttribute("onClick")).toBe(true);
	expect(isEventAttribute("onclick")).toBe(false);
	expect(isEventAttribute("on")).toBe(false);
	expect(normalizeEventName("onClick")).toBe("click");
	expect(normalizeEventName("onPointerDownCapture")).toBe("pointerdown");
});

test("parses JSX-child @for index and key overlays", () => {
	const source =
		"const list = <ul>@for (const item of items; index slot; key item.id) { <li /> }</ul>;";
	const errors: Diagnostic[] = [];
	const program = parseModule(source, "list.tsrx", { collect: true, errors });
	let directive: JSXForExpression | undefined;
	walk(program, {
		enter(node) {
			if (node.type === "JSXForExpression") directive = node;
		},
	});

	expect(errors).toEqual([]);
	expect(directive?.statement.type).toBe("ForOfStatement");
	if (directive?.statement.type !== "ForOfStatement") throw new Error("missing for-of");
	expect(directive.statement.index).toMatchObject({ type: "Identifier", name: "slot" });
	expect(directive.statement.key).toMatchObject({ type: "MemberExpression" });
	expect(source.slice(directive.statement.key?.start, directive.statement.key?.end)).toBe(
		"item.id",
	);
});
