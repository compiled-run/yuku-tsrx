//! Boundary classification for the semantic checker's early errors.
//!
//! yuku's checker reports every early error at `.@"error"` severity, so the
//! split between "this module can never be instantiated" and "this file is
//! mid-edit but still usable" has to be made on the way out, here.
//!
//! The reference is `@tsrx/core`, whose acorn fork raises the redeclaration
//! family through `raiseRecoverable` -- collected into the caller's `errors`
//! array, never thrown -- and every other early error through `raise`, which
//! throws even under `collect`/`loose`. Both halves are load bearing for the
//! toolchain that consumes us:
//!
//!   * Fatal. `markless`'s bundler leans on the throw. Its
//!     `preload-cleanup` guard reads a parse throw as proof that a chunk still
//!     has live exports; a parser that quietly accepts
//!     `import{t as e}from"./c.js";export{a as n,i as t};` -- a module that
//!     exports bindings it never declares, an ES2015 16.2.1.5.1 early error --
//!     lets the guard drop a body while keeping its exports, and V8 then
//!     refuses to instantiate the chunk.
//!
//!   * Recoverable. `markless`'s compiler re-reports redeclarations itself,
//!     as recoverable `usage` diagnostics, so that a half-typed editor buffer
//!     still produces virtual code. Surfacing them here as well would both
//!     double-report them and mark them fatal, which closes the editor flows.
//!
//! The recoverable set is deliberately one message family. yuku carries no
//! diagnostic codes, so there is nothing but the message to key on; keep the
//! list at the smallest thing that reproduces the reference behaviour, and
//! prefer a real severity the moment the checker starts reporting one.

const std = @import("std");
const yuku = @import("yuku");
const semantic = @import("semantic.zig");

/// Runs semantic analysis over `tree` and lowers the severity of the early
/// errors the toolchain boundary treats as recoverable.
///
/// Only the diagnostics analysis appended are reclassified; whatever the
/// parser itself reported keeps the severity the parser gave it. Analysis
/// failure is not fatal -- a partially checked tree still classifies the
/// diagnostics it did produce, which matches the recovery contract the
/// editor path parses under.
pub fn analyzeWithBoundarySeverity(tree: anytype) void {
    const parsed = tree.tree.diagnostics.items.len;
    _ = semantic.analyze(tree) catch {};
    lowerRecoverable(tree.tree.diagnostics.items[parsed..]);
}

/// Lowers `.@"error"` diagnostics in the recoverable set to `.warning`.
pub fn lowerRecoverable(diagnostics: []yuku.ast.Diagnostic) void {
    for (diagnostics) |*diagnostic| {
        if (diagnostic.severity != .@"error") continue;
        if (isRecoverable(diagnostic.message)) diagnostic.severity = .warning;
    }
}

/// True for the early errors a consumer recovers from rather than rejecting
/// the module over. See the module comment for why the set is this small.
pub fn isRecoverable(message: []const u8) bool {
    return isRedeclaration(message);
}

/// `Checker.reportRedeclaration` -- every duplicate binding form (`let`/`const`
/// collisions, duplicate function declarations, duplicate imports, clashing
/// strict-mode parameters) funnels into this one message. Acorn's
/// `raiseRecoverable` covers the same forms.
fn isRedeclaration(message: []const u8) bool {
    const prefix = "Identifier '";
    const suffix = "' has already been declared";
    return message.len > prefix.len + suffix.len and
        std.mem.startsWith(u8, message, prefix) and
        std.mem.endsWith(u8, message, suffix);
}
