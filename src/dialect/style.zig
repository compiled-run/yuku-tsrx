const std = @import("std");
const abi = @import("dialect_abi");
const schema = @import("dialect_schema");

pub fn afterOpen(comptime Host: type, parser: anytype, opening: Host.NodeIndex, comptime context: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    const opening_data = switch (Host.data(parser, opening)) {
        .jsx_opening_element => |data| data,
        else => return .unhandled,
    };
    const name_value = switch (Host.data(parser, opening_data.name)) {
        .jsx_identifier => |data| data.name,
        else => return .unhandled,
    };
    if (!std.mem.eql(u8, Host.string(parser, name_value), "style")) return .unhandled;

    const opening_span = Host.nodeSpan(parser, opening);
    if (opening_data.self_closing) {
        return .{ .handled = try Host.addDialectNode(parser, schema.Record{ .jsx_style_element = .{
            .opening_element = abi.NodeRef.init(@intFromEnum(opening)),
            .children = .{ .start = 0, .len = 0 },
            .closing_element = abi.OptionalNodeRef.init(@intFromEnum(Host.NodeIndex.null)),
            .css = .{ .start = 0, .end = 0 },
        } }, opening_span) };
    }

    const source = Host.source(parser);
    const close = "</style>";
    const close_index = std.mem.indexOfPos(u8, source, opening_span.end, close) orelse {
        try Host.reportWithHelp(
            parser,
            .{ .start = opening_span.end, .end = opening_span.end },
            "Unclosed TSRX style element",
            "Add '</style>' before the end of the template.",
        );
        return .{ .handled = null };
    };
    const close_start: u32 = @intCast(close_index);
    const close_end: u32 = @intCast(close_index + close.len);
    const css = Host.sourceSlice(parser, opening_span.end, close_start);
    const structure = try scanSheet(Host, parser, source, opening_span.end, close_start);
    const sheet = try Host.addDialectNode(parser, schema.Record{ .style_sheet = .{
        .source = .{ .start = css.start, .end = css.end },
        .children = structure orelse .{ .start = 0, .len = 0 },
        .scanned = structure != null,
    } }, .{ .start = opening_span.end, .end = close_start });
    const children = try Host.addExtra(parser, &.{sheet});

    const closing_name_span: Host.Span = .{ .start = close_start + 2, .end = close_start + 7 };
    const closing_name = try Host.addNode(parser, Host.NodeData{ .jsx_identifier = .{
        .name = Host.sourceSlice(parser, closing_name_span.start, closing_name_span.end),
    } }, closing_name_span);
    const closing = try Host.addNode(parser, Host.NodeData{ .jsx_closing_element = .{
        .name = closing_name,
    } }, .{ .start = close_start, .end = close_end });

    const node = try Host.addDialectNode(parser, schema.Record{ .jsx_style_element = .{
        .opening_element = abi.NodeRef.init(@intFromEnum(opening)),
        .children = .{ .start = children.start, .len = children.len },
        .closing_element = abi.OptionalNodeRef.init(@intFromEnum(closing)),
        .css = .{ .start = css.start, .end = css.end },
    } }, .{ .start = opening_span.start, .end = close_end });
    if (!try Host.resumeAfterRawSpan(parser, close_end, context)) return .{ .handled = null };
    return .{ .handled = node };
}

// ---------------------------------------------------------------------------
// CSS structure scanner
//
// Emits only what a byte-splice scoper needs: rule and at-rule boundaries plus,
// per complex selector, the offset at which a scope class must be inserted.
// Anything the scanner cannot model leaves the sheet unscanned; `<style>` never
// produces a diagnostic, so the host owns the failure surface.
// ---------------------------------------------------------------------------

/// Raised for any construct the scanner refuses to model. Never escapes to the parser.
const ScanError = error{Unmodellable};

/// Guards both Zig recursion and the deserializer's own dialect-record depth cap.
const max_depth: u8 = 32;

/// Runs a validating pass first so a bail leaves no half-built records behind,
/// then a second pass that emits. Returns null when the sheet is unmodellable.
fn scanSheet(
    comptime Host: type,
    parser: anytype,
    source: []const u8,
    start: u32,
    end: u32,
) Host.ErrorType!?abi.NodeList {
    _ = scanBlock(Host, false, parser, source, start, start, end, 0) catch |err| switch (err) {
        ScanError.Unmodellable => return null,
        else => |other| return other,
    };
    return scanBlock(Host, true, parser, source, start, start, end, 0) catch |err| switch (err) {
        ScanError.Unmodellable => return null,
        else => |other| return other,
    };
}

fn scanBlock(
    comptime Host: type,
    comptime emit: bool,
    parser: anytype,
    source: []const u8,
    // `base` is the offset of the sheet text; scope_insert is reported relative to it.
    base: u32,
    start: u32,
    end: u32,
    depth: u8,
) (Host.ErrorType || ScanError)!abi.NodeList {
    if (depth > max_depth) return ScanError.Unmodellable;

    var items: std.ArrayList(Host.NodeIndex) = .empty;
    defer if (emit) items.deinit(Host.allocator(parser));

    var cursor = try skipTrivia(source, start, end);
    while (cursor < end) {
        const prelude_start = cursor;
        const stop = try statementEnd(source, cursor, end);
        switch (stop.kind) {
            // A `}` here has no opener: the sheet's braces do not balance.
            .close => return ScanError.Unmodellable,
            .semi, .eof => {
                const statement_end = if (stop.kind == .semi) stop.index + 1 else stop.index;
                if (source[prelude_start] == '@') {
                    const node = try emitAtrule(Host, emit, parser, source, prelude_start, stop.index, .{ .start = 0, .len = 0 }, statement_end);
                    if (emit) try items.append(Host.allocator(parser), node);
                }
                cursor = if (stop.kind == .semi) stop.index + 1 else end;
            },
            .brace => {
                const open = stop.index;
                const block_end = try blockEnd(source, open, end);
                const inner_start = open + 1;
                const inner_end = block_end - 1;
                if (source[prelude_start] == '@') {
                    const name = atruleName(source, prelude_start, open);
                    const keyframes = std.ascii.endsWithIgnoreCase(source[name.start..name.end], "keyframes");
                    // A keyframes body holds percentage selectors, never scopable ones.
                    const block = if (keyframes)
                        abi.NodeList{ .start = 0, .len = 0 }
                    else
                        try scanBlock(Host, emit, parser, source, base, inner_start, inner_end, depth + 1);
                    const node = try emitAtrule(Host, emit, parser, source, prelude_start, open, block, block_end);
                    if (emit) try items.append(Host.allocator(parser), node);
                } else if (isCustomProperty(source, prelude_start, open)) {
                    // `--name: { ... }` is a custom-property value, not a rule.
                } else {
                    const prelude = try emitPrelude(Host, emit, parser, source, base, prelude_start, open);
                    const block = try scanBlock(Host, emit, parser, source, base, inner_start, inner_end, depth + 1);
                    if (emit) {
                        const node = try Host.addDialectNode(parser, schema.Record{ .css_rule = .{
                            .prelude = prelude,
                            .block = block,
                        } }, .{ .start = prelude_start, .end = block_end });
                        try items.append(Host.allocator(parser), node);
                    }
                }
                cursor = block_end;
            },
        }
        cursor = try skipTrivia(source, cursor, end);
    }

    if (!emit) return .{ .start = 0, .len = 0 };
    const range = try Host.addExtra(parser, items.items);
    return .{ .start = range.start, .len = range.len };
}

fn emitAtrule(
    comptime Host: type,
    comptime emit: bool,
    parser: anytype,
    source: []const u8,
    start: u32,
    prelude_end: u32,
    block: abi.NodeList,
    end: u32,
) (Host.ErrorType || ScanError)!Host.NodeIndex {
    const name = atruleName(source, start, prelude_end);
    if (!emit) return Host.NodeIndex.null;
    return Host.addDialectNode(parser, schema.Record{ .css_atrule = .{
        .name = .{ .start = name.start, .end = name.end },
        .block = block,
        .keyframes = std.ascii.endsWithIgnoreCase(source[name.start..name.end], "keyframes"),
    } }, .{ .start = start, .end = end });
}

/// Splits a rule prelude on top-level commas and emits one CssSelector per complex selector.
fn emitPrelude(
    comptime Host: type,
    comptime emit: bool,
    parser: anytype,
    source: []const u8,
    base: u32,
    start: u32,
    end: u32,
) (Host.ErrorType || ScanError)!abi.NodeList {
    var items: std.ArrayList(Host.NodeIndex) = .empty;
    defer if (emit) items.deinit(Host.allocator(parser));

    var cursor = start;
    while (true) {
        const comma = try selectorEnd(source, cursor, end);
        const selector = try scanSelector(source, cursor, comma);
        if (emit) {
            const node = try Host.addDialectNode(parser, schema.Record{ .css_selector = .{
                .scope_insert = abi.ScalarU32.init(selector.insert - base),
            } }, .{ .start = selector.start, .end = selector.end });
            try items.append(Host.allocator(parser), node);
        }
        if (comma >= end) break;
        cursor = comma + 1;
    }

    if (!emit) return .{ .start = 0, .len = 0 };
    const range = try Host.addExtra(parser, items.items);
    return .{ .start = range.start, .len = range.len };
}

const Selector = struct {
    start: u32,
    end: u32,
    insert: u32,
};

/// Locates the scope-insertion offset for one complex selector in `[start, end)`.
///
/// The subject compound is the run after the last top-level combinator. The class
/// goes before that compound's first pseudo, so `.card:hover::before` inserts at
/// `:hover`; with no pseudo it goes at the compound's end, trailing trivia excluded.
fn scanSelector(source: []const u8, start: u32, end: u32) ScanError!Selector {
    var cursor = start;
    var nesting: u32 = 0;
    var first: ?u32 = null;
    var last_end: u32 = start;
    var compound_start: ?u32 = null;
    var first_colon: ?u32 = null;
    var pending_space = false;

    while (cursor < end) {
        const byte = source[cursor];
        if (isSpace(byte)) {
            if (nesting == 0) pending_space = true;
            cursor += 1;
            continue;
        }
        if (byte == '/' and cursor + 1 < end and source[cursor + 1] == '*') {
            cursor = try commentEnd(source, cursor, end);
            continue;
        }

        if (nesting == 0) {
            const combinator: u32 = if (byte == '>' or byte == '+' or byte == '~')
                1
            else if (byte == '|' and cursor + 1 < end and source[cursor + 1] == '|')
                2
            else
                0;
            if (combinator > 0) {
                if (first == null) first = cursor;
                compound_start = null;
                first_colon = null;
                pending_space = false;
                cursor += combinator;
                last_end = cursor;
                continue;
            }
            // A whitespace run is a descendant combinator only when a compound follows it.
            if (pending_space and compound_start != null) {
                compound_start = null;
                first_colon = null;
            }
            pending_space = false;
            if (compound_start == null) compound_start = cursor;
            if (byte == ':' and first_colon == null) first_colon = cursor;
        }

        if (first == null) first = cursor;
        switch (byte) {
            '\\' => cursor = @min(cursor + 2, end),
            '"', '\'' => cursor = try stringEnd(source, cursor, end),
            '(', '[' => {
                nesting += 1;
                cursor += 1;
            },
            ')', ']' => {
                if (nesting == 0) return ScanError.Unmodellable;
                nesting -= 1;
                cursor += 1;
            },
            else => cursor += 1,
        }
        last_end = cursor;
    }

    if (nesting != 0) return ScanError.Unmodellable;
    const selector_start = first orelse return ScanError.Unmodellable;
    return .{
        .start = selector_start,
        .end = last_end,
        .insert = first_colon orelse last_end,
    };
}

const Stop = struct {
    index: u32,
    kind: enum { brace, semi, close, eof },
};

/// Finds the byte that terminates the statement starting at `start`: a top-level
/// `{`, `;`, or `}`, else the end of the enclosing range.
fn statementEnd(source: []const u8, start: u32, end: u32) ScanError!Stop {
    var cursor = start;
    var nesting: u32 = 0;
    while (cursor < end) {
        const byte = source[cursor];
        switch (byte) {
            '\\' => {
                cursor = @min(cursor + 2, end);
                continue;
            },
            '/' => if (cursor + 1 < end and source[cursor + 1] == '*') {
                cursor = try commentEnd(source, cursor, end);
                continue;
            },
            '"', '\'' => {
                cursor = try stringEnd(source, cursor, end);
                continue;
            },
            '(', '[' => {
                nesting += 1;
                cursor += 1;
                continue;
            },
            ')', ']' => {
                if (nesting == 0) return ScanError.Unmodellable;
                nesting -= 1;
                cursor += 1;
                continue;
            },
            else => {},
        }
        if (nesting == 0) switch (byte) {
            '{' => return .{ .index = cursor, .kind = .brace },
            ';' => return .{ .index = cursor, .kind = .semi },
            '}' => return .{ .index = cursor, .kind = .close },
            else => {},
        };
        cursor += 1;
    }
    if (nesting != 0) return ScanError.Unmodellable;
    return .{ .index = end, .kind = .eof };
}

/// Returns the offset of the top-level `,` at or after `start`, else `end`.
fn selectorEnd(source: []const u8, start: u32, end: u32) ScanError!u32 {
    var cursor = start;
    var nesting: u32 = 0;
    while (cursor < end) {
        const byte = source[cursor];
        switch (byte) {
            '\\' => cursor = @min(cursor + 2, end),
            '/' => {
                if (cursor + 1 < end and source[cursor + 1] == '*') {
                    cursor = try commentEnd(source, cursor, end);
                } else cursor += 1;
            },
            '"', '\'' => cursor = try stringEnd(source, cursor, end),
            '(', '[' => {
                nesting += 1;
                cursor += 1;
            },
            ')', ']' => {
                if (nesting == 0) return ScanError.Unmodellable;
                nesting -= 1;
                cursor += 1;
            },
            ',' => {
                if (nesting == 0) return cursor;
                cursor += 1;
            },
            else => cursor += 1,
        }
    }
    if (nesting != 0) return ScanError.Unmodellable;
    return end;
}

/// `open` points at `{`. Returns the offset just past the matching `}`.
fn blockEnd(source: []const u8, open: u32, end: u32) ScanError!u32 {
    var cursor = open;
    var depth: u32 = 0;
    while (cursor < end) {
        const byte = source[cursor];
        switch (byte) {
            '\\' => {
                cursor = @min(cursor + 2, end);
                continue;
            },
            '/' => if (cursor + 1 < end and source[cursor + 1] == '*') {
                cursor = try commentEnd(source, cursor, end);
                continue;
            },
            '"', '\'' => {
                cursor = try stringEnd(source, cursor, end);
                continue;
            },
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if (depth == 0) return cursor + 1;
            },
            else => {},
        }
        cursor += 1;
    }
    return ScanError.Unmodellable;
}

const Name = struct { start: u32, end: u32 };

/// `start` points at `@`. Returns the identifier that follows it.
fn atruleName(source: []const u8, start: u32, limit: u32) Name {
    var cursor = start + 1;
    while (cursor < limit) {
        const byte = source[cursor];
        if (byte == '\\') {
            cursor = @min(cursor + 2, limit);
            continue;
        }
        if (byte == '-' or byte == '_' or byte >= 0x80 or std.ascii.isAlphanumeric(byte)) {
            cursor += 1;
            continue;
        }
        break;
    }
    return .{ .start = @min(start + 1, limit), .end = cursor };
}

fn isCustomProperty(source: []const u8, start: u32, limit: u32) bool {
    return start + 1 < limit and source[start] == '-' and source[start + 1] == '-';
}

fn isSpace(byte: u8) bool {
    return byte == ' ' or byte == '\t' or byte == '\n' or byte == '\r' or byte == 0x0C;
}

/// Advances past whitespace and comments; returns the next significant offset.
fn skipTrivia(source: []const u8, start: u32, end: u32) ScanError!u32 {
    var cursor = start;
    while (cursor < end) {
        const byte = source[cursor];
        if (isSpace(byte)) {
            cursor += 1;
            continue;
        }
        if (byte == '/' and cursor + 1 < end and source[cursor + 1] == '*') {
            cursor = try commentEnd(source, cursor, end);
            continue;
        }
        break;
    }
    return cursor;
}

/// `start` points at `/*`. Returns the offset just past the closing `*/`.
fn commentEnd(source: []const u8, start: u32, end: u32) ScanError!u32 {
    var cursor = start + 2;
    while (cursor + 1 < end) : (cursor += 1) {
        if (source[cursor] == '*' and source[cursor + 1] == '/') return cursor + 2;
    }
    return ScanError.Unmodellable;
}

/// `start` points at a quote. Returns the offset just past the matching quote.
fn stringEnd(source: []const u8, start: u32, end: u32) ScanError!u32 {
    const quote = source[start];
    var cursor = start + 1;
    while (cursor < end) : (cursor += 1) {
        const byte = source[cursor];
        if (byte == '\\') {
            cursor += 1;
            continue;
        }
        if (byte == quote) return cursor + 1;
    }
    return ScanError.Unmodellable;
}
