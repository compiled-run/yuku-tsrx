---
title: TSRX Syntax Support
description: Every TSRX construct the parser accepts, with a real example each, and the cases it rejects.
---

# TSRX Syntax Support

Every construct on this page has a fixture in
[`test/parser/misc/tsrx/`](https://github.com/compiled-run/yuku-tsrx/tree/main/test/parser/misc/tsrx),
and every snippet below is taken from one. The fixture name is given with each
section so you can read the whole file and its snapshot.

| Construct | Fixture |
| --- | --- |
| `@{ }` code blocks | `code-block.module.tsrx` |
| `@{ }` in expression position | `code-block-expression.module.tsrx` |
| `@{ }` as a function body | `code-block-function.module.tsrx` |
| `@if` / `@else` | `control-flow-if.module.tsrx` |
| `@for` / `@empty` | `control-flow-for.module.tsrx` |
| `@switch` / `@case` / `@default` | `control-flow-switch.module.tsrx` |
| `@try` / `@pending` / `@catch` | `control-flow-try.module.tsrx` |
| Dynamic tags `<{expr}>` | `dynamic-tag.module.tsrx` |
| `<style>` elements | `style-element.module.tsrx` |
| Lazy destructuring `&{ }` and `&[ ]` | `lazy-destructuring.module.tsrx` |
| Submodule imports | `submodule-import.module.tsrx` |
| Text entities | `text-entities.module.tsrx` |

<!-- node-chips -->

## Code blocks

A code block is `@{ }`. It lets statements and markup sit next to each other.
The statements run, and the last markup expression is what the block renders.

In child position, inside an element (`code-block.module.tsrx`):

```tsrx
const view = (
    <section>
        before
        @{ const label = "ready"; const count = 1; }
        after
    </section>
);

const rendered = (
    <section>
        @{ const label = "ready"; <span>{label}</span> }
    </section>
);
```

In expression position, and nested inside another block
(`code-block-expression.module.tsrx`):

```tsrx
const value = @{ const label = "expr"; <span>{label}</span> };

const nested = (
    <section>
        @{ const label = "outer"; @{ const inner = label; <span>{inner}</span> } }
    </section>
);
```

As a function body, on a declaration and on an arrow
(`code-block-function.module.tsrx`):

```tsrx
function View(): unknown @{ const label = "fn"; <span>{label}</span> }

const Arrow = (): unknown => @{ const label = "arrow"; <span>{label}</span> };
```

Each of these parses to a `JSXCodeBlock`, whose `body` is the statements and
whose `render` is the final markup expression or `null`.

## `@if`, `@else if`, `@else`

Chained, in child position, and standalone as an expression
(`control-flow-if.module.tsrx`):

```tsrx
const child = (
    <section>
        @if (ready) {
            const label = "ready";
            <span>{label}</span>
        } @else @if (fallback) {
            <span>fallback</span>
        } @else {
            <span>empty</span>
        }
    </section>
);

const value = @if (ready) {
    <span>yes</span>
} @else {
    <span>no</span>
};
```

The node is a `JSXIfExpression` with `test`, `consequent`, and an `alternate`
that is another `JSXIfExpression`, a block, or `null`. A branch body is a block,
so it can hold statements as well as markup.

## `@for`, with `index`, `key`, and `@empty`

`@for` takes a for-of head, and after the iterable it accepts `; index <name>`
and `; key <expr>` tail clauses. `@empty` is the branch for an iterable with
nothing in it (`control-flow-for.module.tsrx`):

```tsrx
const list = (
    <section>
        @for (const item of items) {
            const label = item.toUpperCase();
            <span>{label}</span>
        } @empty {
            <span>empty</span>
        }
    </section>
);

const indexed = @for (const item of items; index item_index) {
    <span>{item_index}:{item}</span>
};

const keyed_list = @for (const item of keyed; index item_index; key item.id) {
    <span>{item_index}:{item.id}</span>
};
```

A counted C-style header works too:

```tsrx
const counted = @for (let i = 0; i < items.length; i++) {
    <span>{items[i]}</span>
};
```

The node is a `JSXForExpression` whose `statement` is either a `ForOfStatement`
or a `ForStatement`, and whose `empty` is the `@empty` block or `null`. The
`index` and `key` clauses are two extra fields on the `ForOfStatement` itself,
so the ordinary for-of shape is preserved and the TSRX-only parts hang off it.

## `@switch`, `@case`, `@default`

Clause bodies are braced blocks, and `@case` takes a value followed by a colon
(`control-flow-switch.module.tsrx`):

```tsrx
const view = (
    <section>
        @switch (status) {
            @case "ready": {
                <span>ready</span>
            }
            @case "empty": {
                const label = "empty";
                <span>{label}</span>
            }
            @default: {
                <span>error</span>
            }
        }
    </section>
);
```

The node is a `JSXSwitchExpression` wrapping an ordinary `SwitchStatement`.

## `@try`, `@pending`, `@catch`

`@try` is the async boundary: `@pending` is what shows while the content is
loading, `@catch` is what shows when it fails. `@catch` takes an optional
parameter list, and the second parameter is a reset callback
(`control-flow-try.module.tsrx`):

```tsrx
const view = (
    <section>
        @try {
            const label = ready ? "ready" : "waiting";
            <span>{label}</span>
        } @pending {
            <span>pending</span>
        } @catch (error: Error, reset) {
            <button onClick={reset}>{error.message}</button>
        }
    </section>
);
```

Either branch alone is fine:

```tsrx
const pending_only = @try {
    <span>ready</span>
} @pending {
    <span>pending</span>
};

const catch_only = @try {
    <span>ready</span>
} @catch {
    <span>failed</span>
};
```

The node is a `JSXTryExpression` wrapping a `TryStatement`, with `pending` as
the `@pending` block or `null`. A `@try` with neither `@pending` nor `@catch` is
reported: `TSRX try directive requires '@pending' or '@catch'`.

## Dynamic tags

A tag name can be an expression, written `<{expr}>`. The closing tag repeats it
(`dynamic-tag.module.tsrx`):

```tsrx
export function Panel({ as, title }: { as: Tag; title: string }) {
    return (
        <{as} className="panel">
            <h2>{title}</h2>
        </{as}>
    );
}

export const Icon = ({ as }: { as: Tag }) => <{as} />;
```

Whitespace inside the braces is allowed, and the opening and closing names still
have to match:

```tsrx
export const WithWhitespace = ({ as }: { as: Tag }) => (
    <{ as }>
        <span />
    </{as}>
);
```

## `<style>` elements

A `<style>` element holds raw CSS. Its contents are not parsed as JSX, so
braces, comments, and at-rules inside it stay CSS
(`style-element.module.tsrx`):

```tsrx
const view = (
    <section>
        <style>
            .card {
                color: red;
            }

            /* stays in css */
            @media (min-width: 40rem) {
                .card {
                    display: grid;
                }
            }
        </style>
        <article className="card">content</article>
    </section>
);

const standalone = <style>.inline { color: blue; }</style>;
```

It works from inside a code block as well:

```tsrx
const from_code_block = @{
    const tone = "green";
    <style>.from-code-block { color: green; }</style>
};
```

The node is a `JSXStyleElement`. Its `children` are `StyleSheet` nodes carrying
the raw `source`, and the element itself carries the whole `css` string.

## Lazy destructuring patterns

A destructuring pattern marked with `&` is a lazy pattern
(`lazy-destructuring.module.tsrx`). It works in declarations, in assignments,
and in a parameter list:

```tsrx
let &{ title, count: total = 0 } = props;
const &[first, , ...rest] = values;

&{ title } = props;
&[first] = values;

export function pick(&{ title: label }: Props) {
    return label;
}
```

The pattern keeps its ordinary `ObjectPattern` or `ArrayPattern` type; the
dialect records the lazy marking alongside it rather than inventing a new node
type, so a consumer that only cares about the bindings does not have to learn
anything new.

## Submodule imports

A `module` block can be imported from by name, with no string specifier
(`submodule-import.module.tsrx`):

```tsrx
module server {
    export function load() {
        return "ok";
    }
}

import { load } from server;

export function View(): unknown @{
    const value = load();
    <span>{value}</span>
}
```

## Text entities

Entities in JSX text are decoded: the five named ones (`&quot;`, `&amp;`,
`&lt;`, `&gt;`, `&apos;`), decimal `&#66;`, and hex `&#x42;`. Anything else is
copied through exactly as written, so `&unknown;` stays `&unknown;`
(`text-entities.module.tsrx`, decoded in `src/dialect/text.zig`):

```tsrx
const view = (
    <p>&quot;A&#x42;&#66;&amp;&lt;&gt;&apos;&unknown;</p>
);
```

## What is rejected

Three fixtures exist to hold the cases that must not parse silently. Each one
produces diagnostics rather than a plausible-looking tree.

### `return` inside a template block

`template-return-invalid.module.tsrx`. A `return` inside a `@{ }` block that
sits in child position is invalid, because the block is a template, not a
function body:

```tsrx no-playground
const child = (
    <section>
        @{
            return <span>invalid</span>;
        }
    </section>
);
```

The message is `` `return` is invalid inside TSRX template blocks ``, with the
help line "Use rendered output as the final expression instead." The same
fixture shows the legal case: a `@{ }` that *is* a function body may return.

### `break` and `return` inside `@switch` cases

`control-flow-switch-invalid.module.tsrx`. A `@case` body is not a JavaScript
switch clause, so control transfer out of it is refused:

```tsrx no-playground
const view = @switch (status) {
    @case "ready": {
        break;
    }
    @case "empty": {
        if (status) {
            return <span>empty</span>;
        }
    }
};
```

The messages are `` `break` is invalid inside `@switch` cases. `` and
`` `return` is invalid inside `@switch` cases. `` A `break` that belongs to a
loop written inside the case is fine; only a `break` targeting the case itself
is reported.

### Dynamic tag names that are not element names

`dynamic-tag-invalid.module.tsrx`. The expression in `<{ }>` has to resolve to
something that can name an element, and these do not:

```tsrx no-playground
const call_tag = <{getTag()} />;
const concat_tag = <{"x" + name} />;
const interpolated_tag = <{`x${name}`} />;
const object_tag = <{{ tag: "div" }} />;
const undefined_tag = <{undefined} />;
const void_tag = <{void 0} />;
```

The message is `TSRX dynamic tag expression must resolve to an element name`.

### Malformed directives

A directive that starts but does not complete is reported where it breaks, with
a help line naming the shape it expected. The set includes:

| Message | Help |
| --- | --- |
| `Expected 'if' after '@'` | `TSRX if directives are written '@if (...) { ... }'` |
| `Expected 'else' after '@'` | `TSRX else clauses are written '@else { ... }'` |
| `Expected 'switch' after '@'` | `TSRX switch directives are written '@switch (...) { ... }'` |
| `Expected '{' to start TSRX switch body` | `TSRX switch bodies contain '@case' and '@default' clauses.` |
| `Expected 'try' after '@'` | `TSRX try directives are written '@try { ... }'.` |
| `Expected 'catch' after '@'` | `TSRX catch clauses are written '@catch { ... }' or '@catch (error) { ... }'.` |
| `Expected '{' after TSRX control-flow directive` | `TSRX control-flow bodies are written with braces.` |

Every one of these is a diagnostic on the parse result, not a thrown exception.
[Parser](/guide/parser) covers how diagnostics are returned and which of them
`parseModule` treats as fatal.
