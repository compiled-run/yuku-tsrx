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
  const lower = filename.toLowerCase();
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

export function parseModule(source, filename, options = {}) {
  const result = parse(source, {
    ...options,
    lang: options.lang ?? inferLang(filename),
    sourceType: "module",
  });
  if (result.diagnostics.length > 0) {
    const diagnostic = result.diagnostics[0];
    throw new SyntaxError(`${diagnostic.message} (${diagnostic.start}:${diagnostic.end})`);
  }
  return result.program;
}

export { decode, decodeAnalyzer, encode, walk };
