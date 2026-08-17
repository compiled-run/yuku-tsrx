import binding from "./binding.js";
import { decode } from "./decode.js";
import { decode as decodeAnalyzer } from "./decode-analyzer.js";
import { encode } from "./encode.js";
import { walk } from "./walk.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sourceText(source) {
  return typeof source === "string" ? source : decoder.decode(source);
}

function inferLang(filename) {
  const lower = filename.split(/[?#]/, 1)[0].toLowerCase();
  if (lower.endsWith(".tsrx") || lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".d.ts")) return "dts";
  if (lower.endsWith(".ts")) return "ts";
  return "js";
}

export function parseWire(source, options = {}) {
  const bytes = typeof source === "string" ? encoder.encode(source) : source;
  return binding.parse(bytes, options);
}

export function parse(source, options = {}) {
  return decode(parseWire(source, options), sourceText(source));
}

export function analyze(source, options = {}) {
  const text = sourceText(source);
  const bytes = typeof source === "string" ? encoder.encode(source) : source;
  return decodeAnalyzer(binding.analyze(bytes, options), text);
}

function normalizeGenerateOptions(options) {
  const { minify, sourceMaps, ...next } = options ?? {};
  if (typeof next.comments === "boolean") next.comments = next.comments ? "all" : "none";
  const modes = minify === true ? { whitespace: true, syntax: true, quotes: true } : minify || {};
  next.minify = !!modes.syntax;
  if (modes.whitespace) next.format = "compact";
  if (modes.quotes) next.quotes = "shortest";
  next.sourceMap ??= sourceMaps;
  return next;
}

export function generate(program, options) {
  if (!program || program.type !== "Program") {
    throw new TypeError("Expected a Program node from yuku-tsrx");
  }
  return binding.generate(encode(program), normalizeGenerateOptions(options));
}

export function parseModule(source, filename, options = {}) {
  const { collect = false, loose = false, errors, comments, ...parseOptions } = options;
  const result = parse(source, {
    ...parseOptions,
    lang: parseOptions.lang ?? inferLang(filename),
    sourceType: "module",
    loose,
    // A module boundary owes its caller the scope-dependent early errors, not
    // just the grammar ones. Without them an undeclared export slips through,
    // and a bundler that reads a parse throw as "this chunk still has live
    // exports" will strip a body while keeping its exports.
    semanticErrors: parseOptions.semanticErrors ?? true,
    attachComments: parseOptions.attachComments ?? comments !== undefined,
  });
  if ((collect || loose) && comments) comments.push(...result.comments);
  // Only `error` severity makes a module unusable. The native boundary lowers
  // the early errors a mid-edit file still recovers from -- redeclarations --
  // to `warning`, so they stay visible on `parse()` without failing the module
  // here. See src/dialect/diagnostics.zig for how that set was derived.
  const fatal = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (fatal.length > 0) {
    if (collect || loose) {
      if (errors) errors.push(...fatal);
      return result.program;
    }
    const diagnostic = fatal[0];
    throw new SyntaxError(`${diagnostic.message} (${diagnostic.start}:${diagnostic.end})`);
  }
  return result.program;
}

export function isEventAttribute(attribute) {
  return (
    attribute.startsWith("on") &&
    attribute.length > 2 &&
    attribute[2] === attribute[2].toUpperCase()
  );
}

export function normalizeEventName(attribute) {
  let name = attribute.slice(2);
  const lower = name.toLowerCase();
  if (name.endsWith("Capture") && lower !== "gotpointercapture" && lower !== "lostpointercapture") {
    name = name.slice(0, -7);
  }
  return name.toLowerCase();
}

export { decode, decodeAnalyzer, encode, walk };
