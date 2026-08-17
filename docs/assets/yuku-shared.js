// Pieces the playground and the guide-page explorers both need.
//
// Nothing here calls the engine. It is escaping, offset arithmetic, and the
// approximate tokeniser that colours a string the engine just produced, so that
// docs/assets/yuku-playground.js and docs/assets/yuku-explorers.js cannot drift
// apart on any of the three.

export const escapeHtml = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

// Codegen errors carry byte offsets straight out of the wasm payload. The AST
// decoder already maps its own spans to UTF-16 indices, so this is only needed
// for the generate lane.
export function byteToCharIndex(text, byteOffset) {
  let bytes = 0
  let index = 0
  for (const ch of text) {
    if (bytes >= byteOffset) return index
    const cp = ch.codePointAt(0)
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
    index += ch.length
  }
  return index
}

// Instant approximate tokens with the same span shape and palette shiki uses,
// so an edited line keeps its colours without shipping a highlighter bundle.
const QUICK_COLORS = {
  c: ['#6A737D', '#8B949E'],
  s: ['#032F62', '#9ECBFF'],
  d: ['#D73A49', '#F97583'],
  k: ['#D73A49', '#F97583'],
  n: ['#005CC5', '#79B8FF'],
  t: ['#22863A', '#85E89D'],
  f: ['#6F42C1', '#B392F0'],
  y: ['#005CC5', '#79B8FF'],
}
const QUICK_KINDS = ['c', 's', 'd', 'k', 'n', 't', 'f', 'y']
const QUICK_RE =
  /(\/\/.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(@\{|@[a-z]+)|(\b(?:export|import|from|function|return|const|let|var|type|interface|new|await|async|if|else|for|of|in|switch|case|default|try|catch)\b)|(\b\d+(?:\.\d+)?\b)|(<\/?[A-Za-z][\w.-]*|\/?>)|([a-z_$][\w$]*(?=\s*\())|([A-Z][\w$]*)/g

export const quickTokens = (line, inlineColor = true) => {
  let out = ''
  let last = 0
  for (const match of line.matchAll(QUICK_RE)) {
    out += escapeHtml(line.slice(last, match.index))
    const groupIndex = match.slice(1).findIndex((group) => group !== undefined)
    const [light, dark] = QUICK_COLORS[QUICK_KINDS[groupIndex]]
    // The playground's two panels are always dark, so the dark value is also
    // painted outright there: neither has a `.shiki` ancestor to resolve the
    // custom property against. A guide page follows the reader's theme, so it
    // asks for the properties alone and the stylesheet picks the stop.
    out += inlineColor
      ? `<span style="--shiki-light:${light};--shiki-dark:${dark};color:${dark}">${escapeHtml(match[0])}</span>`
      : `<span style="--shiki-light:${light};--shiki-dark:${dark}">${escapeHtml(match[0])}</span>`
    last = match.index + match[0].length
  }
  return out + escapeHtml(line.slice(last))
}

export const quickCode = (text, { inlineColor = true } = {}) =>
  text
    .split('\n')
    .map((line) => `<span class="line">${quickTokens(line, inlineColor)}</span>`)
    .join('\n')

export const formatMs = (ms) => (ms < 10 ? ms.toFixed(2) : Math.round(ms).toString())

export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

export function flagNames(flags, table) {
  if (!table) return ''
  const names = []
  for (const [name, bit] of Object.entries(table)) {
    // The table also carries composite masks (Variable, Import, ValueSpace);
    // only the single-bit entries describe one property of a symbol.
    if ((bit & (bit - 1)) !== 0) continue
    if ((flags & bit) !== 0) names.push(name)
  }
  return names.join(' ')
}
