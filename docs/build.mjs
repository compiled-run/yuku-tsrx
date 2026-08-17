// Static docs site generator: markdown in docs/ -> HTML in docs/dist/.
// Plain JavaScript, no framework. Run with: node docs/build.mjs
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marked } from 'marked'
import { getDocsHighlighter, highlightWith } from './highlight.mjs'
import config from './site.config.mjs'
import { heroCode } from './demo-sources.mjs'

const docsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(docsDir, '..')
const defaultOutDir = path.join(docsDir, 'dist')
const outDir = process.env.YUKU_TSRX_DOCS_OUT_DIR
  ? path.resolve(process.env.YUKU_TSRX_DOCS_OUT_DIR)
  : defaultOutDir
const base = config.base ?? '/'
const trimmedBase = base.replace(/\/$/, '')
// Site pages live under the base path inside the deploy root, so the domain
// root stays free for the landing page and deploy-wide files (vercel.json,
// robots.txt).
const siteDir = trimmedBase
  ? path.join(outDir, ...trimmedBase.split('/').filter(Boolean))
  : outDir

const withBase = (href) => {
  if (!href.startsWith('/')) return href
  if (href === '/') return trimmedBase || '/'
  return trimmedBase + href
}

const escapeHtml = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

function isSameOrAncestor(candidate, target) {
  const relative = path.relative(candidate, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function resolveThroughExistingAncestor(candidate) {
  let existing = candidate
  for (;;) {
    try {
      const canonical = await realpath(existing)
      return path.resolve(canonical, path.relative(existing, candidate))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const parent = path.dirname(existing)
      if (parent === existing) throw error
      existing = parent
    }
  }
}

async function validateOutputDirectory() {
  if (
    outDir === path.parse(outDir).root ||
    isSameOrAncestor(outDir, repoRoot) ||
    outDir === docsDir
  ) {
    throw new Error(`refusing destructive docs output directory: ${outDir}`)
  }
  let metadata = null
  try {
    metadata = await lstat(outDir)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (metadata?.isSymbolicLink()) throw new Error(`refusing symlink docs output directory: ${outDir}`)
  if (outDir === defaultOutDir) return

  const tempRoot = path.resolve(tmpdir())
  const relative = path.relative(tempRoot, outDir)
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !path.basename(outDir).startsWith('yuku-tsrx-')
  ) {
    throw new Error(`custom docs output must be a yuku-tsrx-* directory under ${tempRoot}`)
  }
  const canonicalTempRoot = await realpath(tempRoot)
  const canonicalOutDir = await resolveThroughExistingAncestor(outDir)
  const expectedCanonicalOutDir = path.resolve(canonicalTempRoot, relative)
  const canonicalRelative = path.relative(canonicalTempRoot, canonicalOutDir)
  if (
    canonicalOutDir !== expectedCanonicalOutDir ||
    canonicalRelative.startsWith('..') ||
    path.isAbsolute(canonicalRelative)
  ) {
    throw new Error(
      `custom docs output resolves outside the trusted temporary directory: ${outDir}`,
    )
  }
  if (metadata && !metadata.isDirectory()) throw new Error(`docs output is not a directory: ${outDir}`)
  if (metadata && (await readdir(outDir)).length > 0) {
    throw new Error(`refusing nonempty custom docs output directory: ${outDir}`)
  }
}

const namedEntities = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
}

// Headings are slugged from rendered inline HTML, so a heading that quotes a
// phrase arrives as `&quot;…&quot;`. Stripping punctuation without decoding first
// leaves the entity *name* in the id, which is how
// `What "a plain install" actually covers` became
// `what-quota-plain-installquot-actually-covers` and broke every link to it.
// Tags go first: decoding `&lt;` before that would manufacture one.
function decodeEntities(text) {
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return namedEntities[name.toLowerCase()] ?? match
  })
}

function slugify(text) {
  return decodeEntities(text.replace(/<[^>]*>/g, ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

function makeSlugger() {
  const seen = new Map()
  return (text) => {
    const slug = slugify(text) || 'section'
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    return count === 0 ? slug : `${slug}-${count}`
  }
}

function parseFrontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source)
  if (!match) return { data: {}, body: source }
  const data = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator > 0) {
      data[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
    }
  }
  return { data, body: source.slice(match[0].length) }
}

const highlighter = await getDocsHighlighter()
const highlightHtml = (code, lang) => highlightWith(highlighter, code, lang)

// Content hash of the shared chrome assets, appended as ?v= to their URLs so
// deployed pages never pair fresh HTML with a stale cached stylesheet.
const styleSource = await readFile(path.join(docsDir, 'assets', 'style.css'), 'utf8')
const assetVersion = createHash('sha256')
  .update(styleSource)
  .update(await readFile(path.join(docsDir, 'assets', 'app.js')))
  .digest('hex')
  .slice(0, 10)

// The three page shells this site renders. Each one gets its own stylesheet.
const CSS_SHELLS = ['doc', 'home', 'playground']

// docs/assets/style.css is authored as one file but most of it can only ever
// match one shell, so shipping all of it to every page made the home page carry
// the sidebar, the article typography and every doc component it never renders.
// Regions marked `#css-pages:` are kept only for the shells they name (see the
// header comment in the stylesheet); everything else is shared chrome. Lines
// keep their authored order in every bundle, so a shell's cascade is exactly the
// cascade of the source file with the other shells' rules deleted.
function splitStylesheet(source) {
  const bundles = new Map(CSS_SHELLS.map((shell) => [shell, []]))
  let shells = null
  let openedAt = 0
  const lines = source.split('\n')
  for (const [index, line] of lines.entries()) {
    const opening = /^[ \t]*\/\* #css-pages:([a-z ]+)\*\/[ \t]*$/.exec(line)
    if (opening) {
      if (shells) {
        throw new Error(
          `style.css:${index + 1}: #css-pages region opened inside the one opened on line ${openedAt}`,
        )
      }
      shells = opening[1].trim().split(/\s+/)
      openedAt = index + 1
      const unknown = shells.filter((shell) => shell !== 'none' && !CSS_SHELLS.includes(shell))
      if (unknown.length > 0) {
        throw new Error(
          `style.css:${index + 1}: unknown page shell ${unknown.join(', ')} (expected ${CSS_SHELLS.join(', ')} or none)`,
        )
      }
      continue
    }
    if (/^[ \t]*\/\* #css-pages-end \*\/[ \t]*$/.test(line)) {
      if (!shells) throw new Error(`style.css:${index + 1}: #css-pages-end closes nothing`)
      shells = null
      continue
    }
    for (const shell of CSS_SHELLS) {
      if (!shells || shells.includes(shell)) bundles.get(shell).push(line)
    }
  }
  if (shells) throw new Error(`style.css:${openedAt}: #css-pages region is never closed`)
  return bundles
}

const styleBundles = splitStylesheet(styleSource)

// Editor-style hover docs for TSRX constructs in code examples, mirroring the
// quick-info experience of the Markless VS Code extension.
const TSRX_DOCS = {
  '@{': [
    'Statement container',
    'A statement container that allows you to have statements and markup colocated.',
  ],
  '@if': ['Conditional', 'Renders when the condition is truthy.'],
  '@else': ['Fallback', 'Runs when @if fails; chain with @else if.'],
  '@for': ['Loop', 'Renders once per item. Supports index i and key expr.'],
  '@empty': ['Loop fallback', 'Renders when the loop has nothing to show.'],
  '@switch': ['Match', 'Picks the @case that matches a value.'],
  '@case': ['Branch', 'Written as @case value: { … }.'],
  '@default': ['Fallback', 'Renders when no @case matches.'],
  '@try': ['Async boundary', 'Awaited content, with loading and error branches.'],
  '@pending': ['Loading', 'Shown while @try content loads.'],
  '@catch': ['Error', 'Handles @try failures; (error, reset) supported.'],
}

function addTsrxHovers(html) {
  // Chained form first. The grammar scopes the trailing `if` as part of the
  // directive, so shiki emits two adjacent spans with identical styling; fuse
  // them so the hover target is the whole `@else if` rather than half of it.
  html = html.replace(
    /(<span style="([^"]*)">)([ \t]*)@else<\/span><span style="\2">([ \t]*if\b)/g,
    (match, open, style, whitespace, ifWord) =>
      `${open}${whitespace}<span class="tsrx-hover" tabindex="0" role="img" aria-label="@else if: Chained conditional. Tests another condition when the previous branch failed." data-doc-title="@else if · Chained conditional" data-doc="Tests another condition when the previous branch failed.">@else${ifWord}</span>`,
  )
  return html.replace(
    /(<span(?! class="tsrx-hover")[^>]*>)([ \t]*)(@(?:\{|if|else|for|empty|switch|case|default|try|pending|catch))(<\/span>)/g,
    (match, open, whitespace, token, close) => {
      const doc = TSRX_DOCS[token]
      if (!doc) return match
      return `${open}${whitespace}<span class="tsrx-hover" tabindex="0" role="img" aria-label="${escapeHtml(
        `${token}: ${doc[0]}. ${doc[1]}`,
      )}" data-doc-title="${escapeHtml(`${token} · ${doc[0]}`)}" data-doc="${escapeHtml(doc[1])}">${token}</span>${close}`
    },
  )
}

// Site-wide hover glossary: first prose occurrence of each technical term on
// a page gets an editor-style tooltip, so jargon is explained where it sits.
const GLOSSARY = {
  p95: ['p95', '95 of 100 runs were at least this fast. A worst-realistic-case number, not an average.'],
  throughput: ['throughput', 'How much source code is processed per second. Higher is better.'],
  'MiB/s': ['MiB/s', 'Mebibytes of source code processed per second.'],
  'fail-closed': ['fail-closed', 'Unsupported input produces a clear error instead of a silently wrong result.'],
}

function addGlossary(article) {
  const seen = new Set()
  const wrapText = (text) => {
    let out = text
    for (const [term, [title, doc]] of Object.entries(GLOSSARY)) {
      if (seen.has(term)) continue
      const pattern = new RegExp(`(^|[\\s(])(${term.replace('/', '\\/').replace('-', '\\-')})(?=[\\s.,;:)]|$)`)
      if (!pattern.test(out)) continue
      seen.add(term)
      out = out.replace(
        pattern,
        (m, pre, word) =>
          `${pre}<span class="tsrx-hover" tabindex="0" role="img" aria-label="${escapeHtml(`${title}: ${doc}`)}" data-doc-title="${escapeHtml(title)}" data-doc="${escapeHtml(doc)}">${word}</span>`,
      )
    }
    return out
  }
  return article.replace(/(<(?:p|li)>)([\s\S]*?)(<\/(?:p|li)>)/g, (match, open, body, close) => {
    const parts = body.split(/(<[^>]+>)/)
    for (let i = 0; i < parts.length; i += 2) parts[i] = wrapText(parts[i])
    return open + parts.join('') + close
  })
}

function createMarked(slugger, headings) {
  const marked = new Marked()
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens)
        const id = slugger(html)
        // Plain text, not inline HTML: the outline and the permalink label both
        // escape what they are given, so an undecoded `&quot;` would be escaped
        // a second time and read as `&quot;` on the page.
        const text = decodeEntities(html.replace(/<[^>]*>/g, ''))
        headings.push({ depth, id, text })
        const anchor =
          depth > 1
            ? `<a class="header-anchor" href="#${id}" aria-label="Permalink to “${escapeHtml(
                text,
              )}”">#</a>`
            : ''
        return `<h${depth} id="${id}">${html}${anchor}</h${depth}>\n`
      },
      code({ text, lang }) {
        const [language] = (lang || 'text').split(/\s+/)
        let body = highlightHtml(text, language)
        if (language === 'tsrx') body = addTsrxHovers(body)
        return `<div class="code-block" data-lang="${escapeHtml(language)}">${body}</div>\n`
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens)
        if (/^https?:\/\//.test(href)) {
          // `[Deno](https://deno.com "brand:deno")` renders the project's own
          // mark next to its name. The title is the only inline signal Markdown
          // gives an author, and an unknown brand degrades to a plain link.
          const brand = /^brand:([a-z][a-z-]*)$/.exec(title ?? '')?.[1]
          const mark = brand ? brandIconHtml(brand) : ''
          return `<a${mark ? ' class="brand-link"' : ''} href="${href}" target="_blank" rel="noreferrer">${mark}${text}<span class="visually-hidden"> (opens in new tab)</span></a>`
        }
        // A source link may name the file (`./yuku-dialect.md#…`) the way it
        // reads in an editor. The site serves routes, not files, so drop the
        // extension rather than shipping a link that lands on nothing.
        return `<a href="${withBase(href.replace(/\.md(?=$|#)/, ''))}">${text}</a>`
      },
    },
  })
  return marked
}

// Collect page text per heading section for the client-side search index.
function extractSections(marked, body, page) {
  const slugger = makeSlugger()
  const sections = []
  let current = { title: page.title, anchor: '', parts: [] }
  const flush = () => {
    const text = current.parts.join(' ').replace(/\s+/g, ' ').trim()
    if (text || current.anchor) sections.push({ ...current, text })
  }
  const plain = (raw) =>
    raw
      .replace(/```[^\n]*\n?/g, ' ')
      .replace(/[`*_#>|]/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, ' ')
  for (const token of marked.lexer(body)) {
    if (token.type === 'heading' && token.depth <= 3) {
      const id = slugger(token.text)
      if (token.depth === 1) {
        current.title = token.text
        continue
      }
      flush()
      current = { title: token.text, anchor: id, parts: [] }
    } else if (token.raw) {
      current.parts.push(plain(token.raw))
    }
  }
  flush()
  return sections.map((section, index) => ({
    id: `${page.link}#${index}`,
    page: page.title,
    group: page.group,
    title: section.title,
    href: withBase(page.link) + (section.anchor ? `#${section.anchor}` : ''),
    text: section.text.slice(0, 1200),
  }))
}

const githubIcon =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.28-.01-1.02-.02-2-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18a11 11 0 0 1 2.88-.39c.98 0 1.96.13 2.88.39 2.19-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14 0 1.54-.02 2.79-.02 3.17 0 .31.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>'
const navHtml = config.nav
  .map((item) =>
    item.link.startsWith('https://github.com')
      ? `<li><a class="nav-github" href="${item.link}" aria-label="${item.text} repository" title="${item.text}">${githubIcon}</a></li>`
      : `<li><a href="${withBase(item.link)}">${item.text}</a></li>`,
  )
  .join('')

function sidebarHtml(activeLink) {
  return config.sidebar
    .map(
      (group) => `
      <section class="sidebar-group">
        <h2 class="sidebar-group-title">${group.text}</h2>
        <ul>
          ${group.items
            .map(
              (item) =>
                `<li><a href="${withBase(item.link)}"${
                  item.link === activeLink ? ' aria-current="page"' : ''
                }>${item.text}${
                  item.tag ? `<span class="sidebar-tag">${escapeHtml(item.tag)}</span>` : ''
                }</a></li>`,
            )
            .join('\n')}
        </ul>
      </section>`,
    )
    .join('\n')
}

// Reading minutes per outline section, measured from the rendered article so
// that generated blocks (diagrams, demos, tables) count the same as prose.
// 200 words a minute is the low end of adult silent reading, which suits
// reference pages people read carefully rather than skim.
const WORDS_PER_MINUTE = 200

function annotateReadingTime(articleHtml, headings) {
  const marks = [...articleHtml.matchAll(/<h([23]) id="([^"]+)"/g)]
  const words = (html) =>
    html
      // Chart tick labels are not reading. A page of build-time SVG charts
      // counts thousands of axis numbers otherwise, and tells a reader it is a
      // twenty-minute page when the prose is three.
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z]+;|&#\d+;/gi, ' ')
      .split(/\s+/)
      .filter(Boolean).length
  const counted = new Map()
  for (const [index, mark] of marks.entries()) {
    const start = mark.index
    const end = index + 1 < marks.length ? marks[index + 1].index : articleHtml.length
    counted.set(mark[2], words(articleHtml.slice(start, end)))
  }
  // Everything above the first section belongs to the page, not to a heading,
  // so it lands on the total without giving the first item a misleading badge.
  const lead = marks.length > 0 ? words(articleHtml.slice(0, marks[0].index)) : words(articleHtml)
  for (const heading of headings) heading.words = counted.get(heading.id) ?? 0
  return lead
}

function readingMinutes(words) {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

function outlineHtml(headings, leadWords = 0) {
  const items = headings.filter((h) => h.depth === 2 || h.depth === 3)
  if (items.length === 0) return ''
  const total = readingMinutes(
    leadWords + items.reduce((sum, h) => sum + (h.words ?? 0), 0),
  )
  // Without JS the bar sits at zero and the readout names the whole page, which
  // is exactly true for a reader who has not scrolled.
  return `
    <nav class="outline" aria-labelledby="outline-title">
      <p class="outline-title" id="outline-title">On this page</p>
      <div class="outline-progress" data-total-minutes="${total}">
        <div class="outline-progress-track" aria-hidden="true"><div class="outline-progress-fill"></div></div>
        <p class="outline-remaining" aria-live="polite">${total} min read</p>
      </div>
      <ul>
        ${items
          .map(
            (h) =>
              `<li class="outline-depth-${h.depth}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`,
          )
          .join('\n')}
      </ul>
    </nav>`
}

function prevNextHtml(pageIndex, flat) {
  if (pageIndex < 0) return ''
  const prev = flat[pageIndex - 1]
  const next = flat[pageIndex + 1]
  if (!prev && !next) return ''
  const cell = (item, kind, label) =>
    item
      ? `<div class="pager-link ${kind}"><a href="${withBase(item.link)}"><span class="pager-label">${label}</span><span class="pager-title">${item.text}</span></a></div>`
      : '<div></div>'
  return `<nav class="pager" aria-label="Previous and next page">
    ${cell(prev, 'prev', 'Previous page')}
    ${cell(next, 'next', 'Next page')}
  </nav>`
}

const themeInit = `(() => {
  try {
    const stored = localStorage.getItem('yuku-tsrx-theme')
    const dark = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', dark)
  } catch {}
})()`

const favicon = withBase('/assets/logo.svg')
const socialImage = `${config.origin}${withBase('/assets/social-card.png')}`

function canonicalUrl(pathname) {
  if (pathname === '/') return `${config.origin}${trimmedBase || '/'}`
  return `${config.origin}${withBase(pathname)}`
}

const searchDialog = `
<dialog id="search-dialog" class="search-dialog" aria-label="Search documentation">
  <div class="search-panel">
    <form class="search-form" role="search" onsubmit="return false">
      <label class="visually-hidden" for="search-input">Search documentation</label>
      <input id="search-input" type="search" role="combobox" aria-expanded="false"
        aria-controls="search-results" aria-autocomplete="list" autocomplete="off"
        placeholder="Search docs" />
      <button type="button" class="search-close" id="search-close">Esc</button>
    </form>
    <ul id="search-results" class="search-results" role="listbox" aria-label="Search results"></ul>
    <p id="search-status" class="search-status" role="status"></p>
  </div>
</dialog>`

function headerHtml() {
  return `
<header class="navbar">
  <div class="navbar-inner">
    <button id="menu-toggle" class="menu-toggle" aria-label="Navigation menu" aria-expanded="false" aria-controls="sidebar">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </button>
    <a class="site-title" href="${withBase('/')}"><img class="site-logo" src="${withBase('/assets/logo.svg')}" alt="" width="26" height="26" />${config.title}</a>
    <div class="navbar-spacer"></div>
    <button id="search-button" class="search-button" aria-label="Search documentation">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <span class="search-button-text">Search</span>
      <kbd class="search-key" aria-hidden="true">⌘K</kbd>
    </button>
    <nav class="top-nav" aria-label="Main navigation"><ul>${navHtml}</ul></nav>
    <button id="theme-toggle" class="theme-toggle" aria-label="Toggle dark theme" aria-pressed="false">
      <svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      <svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
    </button>
  </div>
</header>`
}

function pageShell({ title, description, pathname, shell, bodyClass, header, main }) {
  if (!CSS_SHELLS.includes(shell)) {
    throw new Error(`pageShell: unknown shell ${shell} for ${pathname}`)
  }
  const fullTitle = title === config.title ? title : `${title} | ${config.title}`
  const summary = description || config.description
  const canonical = canonicalUrl(pathname)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(summary)}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escapeHtml(config.title)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:title" content="${escapeHtml(fullTitle)}" />
<meta property="og:description" content="${escapeHtml(summary)}" />
<meta property="og:image" content="${socialImage}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${escapeHtml(config.title)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(fullTitle)}" />
<meta name="twitter:description" content="${escapeHtml(summary)}" />
<meta name="twitter:image" content="${socialImage}" />
<meta name="twitter:image:alt" content="${escapeHtml(config.title)}" />
<meta name="color-scheme" content="light dark" />
<link rel="icon" href="${favicon}" />
<link rel="preload" href="${withBase('/assets/fonts/space-grotesk-latin.woff2')}" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="${withBase('/assets/fonts/inter-latin.woff2')}" as="font" type="font/woff2" crossorigin />
<script>${themeInit}</script>
<link rel="stylesheet" href="${withBase(`/assets/style-${shell}.css`)}?v=${assetVersion}" />
</head>
<body class="${bodyClass}">
<a class="skip-link" href="#main-content">Skip to content</a>
${header}
${main}
${searchDialog}
<div id="route-announcer" class="visually-hidden" aria-live="polite"></div>
<script type="module" src="${withBase('/assets/app.js')}?v=${assetVersion}"></script>
</body>
</html>
`
}

// ---------- disclosure (the detail a reader wants once, not on the way past) ----------
// `<!-- details:Summary -->` ... `<!-- /details -->` folds everything between
// the two behind a summary line. It is for the paragraph that is true, worth
// keeping, and not needed to take the next step: why a flag exists, what a
// warning means, what was measured. A `<details>` element rather than a
// scripted panel, so it still opens with JavaScript off and prints expanded.
const DISCLOSURE_PATTERN = /<!-- details:([\s\S]*?) -->([\s\S]*?)<!-- \/details -->/g

function disclosureHtml(article) {
  return article.replace(
    DISCLOSURE_PATTERN,
    (_match, summary, body) =>
      `<details class="disclosure"><summary>${escapeHtml(summary.trim())}</summary>\n${body.trim()}\n</details>\n`,
  )
}

// The Markdown twin keeps the words: an export has no disclosure to open, so a
// reader (or a model) reading the export gets the heading and the body inline.
function disclosureMarkdown(body) {
  return body.replace(
    DISCLOSURE_PATTERN,
    (_match, summary, inner) => `**${summary.trim()}**\n${inner.trim()}\n`,
  )
}

// Each project's own mark, as the single-path glyphs published by Simple Icons
// (CC0; the marks themselves stay their owners' trademarks and are used here to
// name the tool they belong to). They are inlined rather than fetched, so the
// strict CSP holds, and they fill with `currentColor` so a selected tab and a
// hovered brand link tint the mark along with the label.
const BRAND_ICONS = {
  npm: 'M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z',
  pnpm: 'M0 0v7.5h7.5V0zm8.25 0v7.5h7.498V0zm8.25 0v7.5H24V0zM2 2h3.5v3.5H2zm8.25 0h3.498v3.5H10.25zm8.25 0H22v3.5h-3.5zM8.25 8.25v7.5h7.498v-7.5zm8.25 0v7.5H24v-7.5zm2 2H22v3.5h-3.5zM0 16.5V24h7.5v-7.5zm8.25 0V24h7.498v-7.5zm8.25 0V24H24v-7.5z',
  yarn: 'M12 0C5.375 0 0 5.375 0 12s5.375 12 12 12 12-5.375 12-12S18.625 0 12 0zm.768 4.105c.183 0 .363.053.525.157.125.083.287.185.755 1.154.31-.088.468-.042.551-.019.204.056.366.19.463.375.477.917.542 2.553.334 3.605-.241 1.232-.755 2.029-1.131 2.576.324.329.778.899 1.117 1.825.278.774.31 1.478.273 2.015a5.51 5.51 0 0 0 .602-.329c.593-.366 1.487-.917 2.553-.931.714-.009 1.269.445 1.353 1.103a1.23 1.23 0 0 1-.945 1.362c-.649.158-.95.278-1.821.843-1.232.797-2.539 1.242-3.012 1.39a1.686 1.686 0 0 1-.704.343c-.737.181-3.266.315-3.466.315h-.046c-.783 0-1.214-.241-1.45-.491-.658.329-1.51.19-2.122-.134a1.078 1.078 0 0 1-.58-1.153 1.243 1.243 0 0 1-.153-.195c-.162-.25-.528-.936-.454-1.946.056-.723.556-1.367.88-1.71a5.522 5.522 0 0 1 .408-2.256c.306-.727.885-1.348 1.32-1.737-.32-.537-.644-1.367-.329-2.21.227-.602.412-.936.82-1.08h-.005c.199-.074.389-.153.486-.259a3.418 3.418 0 0 1 2.298-1.103c.037-.093.079-.185.125-.283.31-.658.639-1.029 1.024-1.168a.94.94 0 0 1 .328-.06zm.006.7c-.507.016-1.001 1.519-1.001 1.519s-1.27-.204-2.266.871c-.199.218-.468.334-.746.44-.079.028-.176.023-.417.672-.371.991.625 2.094.625 2.094s-1.186.839-1.626 1.881c-.486 1.144-.338 2.261-.338 2.261s-.843.732-.899 1.487c-.051.663.139 1.2.343 1.515.227.343.51.176.51.176s-.561.653-.037.931c.477.25 1.283.394 1.71-.037.31-.31.371-1.001.486-1.283.028-.065.12.111.209.199.097.093.264.195.264.195s-.755.324-.445 1.066c.102.246.468.403 1.066.398.222-.005 2.664-.139 3.313-.296.375-.088.505-.283.505-.283s1.566-.431 2.998-1.357c.917-.598 1.293-.76 2.034-.936.612-.148.57-1.098-.241-1.084-.839.009-1.575.44-2.196.825-1.163.718-1.742.672-1.742.672l-.018-.032c-.079-.13.371-1.293-.134-2.678-.547-1.515-1.413-1.881-1.344-1.997.297-.5 1.038-1.297 1.334-2.78.176-.899.13-2.377-.269-3.151-.074-.144-.732.241-.732.241s-.616-1.371-.788-1.483a.271.271 0 0 0-.157-.046z',
  bun: 'M12 22.596c6.628 0 12-4.338 12-9.688 0-3.318-2.057-6.248-5.219-7.986-1.286-.715-2.297-1.357-3.139-1.89C14.058 2.025 13.08 1.404 12 1.404c-1.097 0-2.334.785-3.966 1.821a49.92 49.92 0 0 1-2.816 1.697C2.057 6.66 0 9.59 0 12.908c0 5.35 5.372 9.687 12 9.687v.001ZM10.599 4.715c.334-.759.503-1.58.498-2.409 0-.145.202-.187.23-.029.658 2.783-.902 4.162-2.057 4.624-.124.048-.199-.121-.103-.209a5.763 5.763 0 0 0 1.432-1.977Zm2.058-.102a5.82 5.82 0 0 0-.782-2.306v-.016c-.069-.123.086-.263.185-.172 1.962 2.111 1.307 4.067.556 5.051-.082.103-.23-.003-.189-.126a5.85 5.85 0 0 0 .23-2.431Zm1.776-.561a5.727 5.727 0 0 0-1.612-1.806v-.014c-.112-.085-.024-.274.114-.218 2.595 1.087 2.774 3.18 2.459 4.407a.116.116 0 0 1-.049.071.11.11 0 0 1-.153-.026.122.122 0 0 1-.022-.083 5.891 5.891 0 0 0-.737-2.331Zm-5.087.561c-.617.546-1.282.76-2.063 1-.117 0-.195-.078-.156-.181 1.752-.909 2.376-1.649 2.999-2.778 0 0 .155-.118.188.085 0 .304-.349 1.329-.968 1.874Zm4.945 11.237a2.957 2.957 0 0 1-.937 1.553c-.346.346-.8.565-1.286.62a2.178 2.178 0 0 1-1.327-.62 2.955 2.955 0 0 1-.925-1.553.244.244 0 0 1 .064-.198.234.234 0 0 1 .193-.069h3.965a.226.226 0 0 1 .19.07c.05.053.073.125.063.197Zm-5.458-2.176a1.862 1.862 0 0 1-2.384-.245 1.98 1.98 0 0 1-.233-2.447c.207-.319.503-.566.848-.713a1.84 1.84 0 0 1 1.092-.11c.366.075.703.261.967.531a1.98 1.98 0 0 1 .408 2.114 1.931 1.931 0 0 1-.698.869v.001Zm8.495.005a1.86 1.86 0 0 1-2.381-.253 1.964 1.964 0 0 1-.547-1.366c0-.384.11-.76.32-1.079.207-.319.503-.567.849-.713a1.844 1.844 0 0 1 1.093-.108c.367.076.704.262.968.534a1.98 1.98 0 0 1 .4 2.117 1.932 1.932 0 0 1-.702.868Z',
  deno: 'M1.105 18.02A11.9 11.9 0 0 1 0 12.985q0-.698.078-1.376a12 12 0 0 1 .231-1.34A12 12 0 0 1 4.025 4.02a12 12 0 0 1 5.46-2.771 12 12 0 0 1 3.428-.23c1.452.112 2.825.477 4.077 1.05a12 12 0 0 1 2.78 1.774 12.02 12.02 0 0 1 4.053 7.078A12 12 0 0 1 24 12.985q0 .454-.036.914a12 12 0 0 1-.728 3.305 12 12 0 0 1-2.38 3.875c-1.33 1.357-3.02 1.962-4.43 1.936a4.4 4.4 0 0 1-2.724-1.024c-.99-.853-1.391-1.83-1.53-2.919a5 5 0 0 1 .128-1.518c.105-.38.37-1.116.76-1.437-.455-.197-1.04-.624-1.226-.829-.045-.05-.04-.13 0-.183a.155.155 0 0 1 .177-.053c.392.134.869.267 1.372.35.66.111 1.484.25 2.317.292 2.03.1 4.153-.813 4.812-2.627s.403-3.609-1.96-4.685-3.454-2.356-5.363-3.128c-1.247-.505-2.636-.205-4.06.582-3.838 2.121-7.277 8.822-5.69 15.032a.191.191 0 0 1-.315.19 12 12 0 0 1-1.25-1.634 12 12 0 0 1-.769-1.404M11.57 6.087c.649-.051 1.214.501 1.31 1.236.13.979-.228 1.99-1.41 2.013-1.01.02-1.315-.997-1.248-1.614.066-.616.574-1.575 1.35-1.635',
  typescript:
    'M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z',
  react:
    'M14.23 12.004a2.236 2.236 0 0 1-2.235 2.236 2.236 2.236 0 0 1-2.236-2.236 2.236 2.236 0 0 1 2.235-2.236 2.236 2.236 0 0 1 2.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278zm-.005 1.09v.006c.225 0 .406.044.558.127.666.382.955 1.835.73 3.704-.054.46-.142.945-.25 1.44-.96-.236-2.006-.417-3.107-.534-.66-.905-1.345-1.727-2.035-2.447 1.592-1.48 3.087-2.292 4.105-2.295zm-9.77.02c1.012 0 2.514.808 4.11 2.28-.686.72-1.37 1.537-2.02 2.442-1.107.117-2.154.298-3.113.538-.112-.49-.195-.964-.254-1.42-.23-1.868.054-3.32.714-3.707.19-.09.4-.127.563-.132zm4.882 3.05c.455.468.91.992 1.36 1.564-.44-.02-.89-.034-1.345-.034-.46 0-.915.01-1.36.034.44-.572.895-1.096 1.345-1.565zM12 8.1c.74 0 1.477.034 2.202.093.406.582.802 1.203 1.183 1.86.372.64.71 1.29 1.018 1.946-.308.655-.646 1.31-1.013 1.95-.38.66-.773 1.288-1.18 1.87-.728.063-1.466.098-2.21.098-.74 0-1.477-.035-2.202-.093-.406-.582-.802-1.204-1.183-1.86-.372-.64-.71-1.29-1.018-1.946.303-.657.646-1.313 1.013-1.954.38-.66.773-1.286 1.18-1.868.728-.064 1.466-.098 2.21-.098zm-3.635.254c-.24.377-.48.763-.704 1.16-.225.39-.435.782-.635 1.174-.265-.656-.49-1.31-.676-1.947.64-.15 1.315-.283 2.015-.386zm7.26 0c.695.103 1.365.23 2.006.387-.18.632-.405 1.282-.66 1.933-.2-.39-.41-.783-.64-1.174-.225-.392-.465-.774-.705-1.146zm3.063.675c.484.15.944.317 1.375.498 1.732.74 2.852 1.708 2.852 2.476-.005.768-1.125 1.74-2.857 2.475-.42.18-.88.342-1.355.493-.28-.958-.646-1.956-1.1-2.98.45-1.017.81-2.01 1.085-2.964zm-13.395.004c.278.96.645 1.957 1.1 2.98-.45 1.017-.812 2.01-1.086 2.964-.484-.15-.944-.318-1.37-.5-1.732-.737-2.852-1.706-2.852-2.474 0-.768 1.12-1.742 2.852-2.476.42-.18.88-.342 1.356-.494zm11.678 4.28c.265.657.49 1.312.676 1.948-.64.157-1.316.29-2.016.39.24-.375.48-.762.705-1.158.225-.39.435-.788.636-1.18zm-9.945.02c.2.392.41.783.64 1.175.23.39.465.772.705 1.143-.695-.102-1.365-.23-2.006-.386.18-.63.406-1.282.66-1.933zM17.92 16.32c.112.493.2.968.254 1.423.23 1.868-.054 3.32-.714 3.708-.147.09-.338.128-.563.128-1.012 0-2.514-.807-4.11-2.28.686-.72 1.37-1.536 2.02-2.44 1.107-.118 2.154-.3 3.113-.54zm-11.83.01c.96.234 2.006.415 3.107.532.66.905 1.345 1.727 2.035 2.446-1.595 1.483-3.092 2.295-4.11 2.295-.22-.005-.406-.05-.553-.132-.666-.38-.955-1.834-.73-3.703.054-.46.142-.944.25-1.438zm4.56.64c.44.02.89.034 1.345.034.46 0 .915-.01 1.36-.034-.44.572-.895 1.095-1.345 1.565-.455-.47-.91-.993-1.36-1.565z',
}

// A brand whose mark is not one flat path in the set above: TSRX ships a
// wordmark on a gradient, and this project's own logo is strokes on a gradient.
// Both are referenced as files rather than inlined, because two inlined SVGs
// carrying a `<linearGradient id>` collide the moment they share a page.
const BRAND_IMAGES = {
  tsrx: 'brands/tsrx.svg',
  'yuku-tsrx': 'logo.svg',
}

function brandIconHtml(name) {
  const image = BRAND_IMAGES[name]
  if (image) {
    return `<img src="${withBase(`/assets/${image}`)}" alt="" width="16" height="16" loading="lazy">`
  }
  const path = BRAND_ICONS[name]
  if (!path) return ''
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`
}

// Package-manager tab groups repeat the same brand marks several times per
// page, and the two round marks are ~2 KiB of path data each. After a page is
// assembled, every repeated inline mark collapses to a `<use>` of one shared
// `<symbol>` appended before `</body>`, which keeps the uncompressed payload
// (what the wasm-mode perf budget measures) flat no matter how many tab groups
// a page carries. Single-occurrence marks stay inline: a symbol block would
// cost more bytes than it saves.
const BRAND_ICON_BY_PATH = new Map(Object.entries(BRAND_ICONS).map(([name, d]) => [d, name]))

function dedupeBrandIcons(html) {
  const counts = new Map()
  const pattern =
    /<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="([^"]+)"\/><\/svg>/g
  for (const [, d] of html.matchAll(pattern)) {
    const name = BRAND_ICON_BY_PATH.get(d)
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const shared = new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name))
  if (shared.size === 0) return html
  const deduped = html.replace(pattern, (match, d) => {
    const name = BRAND_ICON_BY_PATH.get(d)
    if (!name || !shared.has(name)) return match
    return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#brand-icon-${name}"/></svg>`
  })
  const symbols = [...shared]
    .map((name) => `<symbol id="brand-icon-${name}" viewBox="0 0 24 24"><path d="${BRAND_ICONS[name]}"/></symbol>`)
    .join('')
  return deduped.replace('</body>', `<svg hidden aria-hidden="true">${symbols}</svg></body>`)
}

function pageMenuHtml(link) {
  const mdHref = withBase(`${link}.md`)
  const absoluteMd = `${config.origin}${mdHref}`
  const prompt = encodeURIComponent(
    `Read ${absoluteMd} so I can ask questions about this ${config.title} documentation page.`,
  )
  return `<div class="page-menu" data-page-menu>
      <button type="button" class="copy-md-button page-menu-main" data-md-href="${mdHref}">Copy page</button>
      <button type="button" class="page-menu-toggle" aria-haspopup="menu" aria-expanded="false" aria-label="More ways to use this page">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <ul class="page-menu-list" role="menu" hidden>
        <li role="none"><button type="button" role="menuitem" class="copy-md-button" data-md-href="${mdHref}">Copy page as Markdown</button></li>
        <li role="none"><a role="menuitem" href="${mdHref}" target="_blank" rel="noreferrer">View as plain Markdown</a></li>
        <li role="none"><a role="menuitem" href="https://chatgpt.com/?hints=search&q=${prompt}" target="_blank" rel="noreferrer">Open in ChatGPT</a></li>
        <li role="none"><a role="menuitem" href="https://claude.ai/new?q=${prompt}" target="_blank" rel="noreferrer">Open in Claude</a></li>
      </ul>
    </div>`
}

function renderDocPage({ page, article, headings, pageIndex, flat, leadWords = 0 }) {
  const main = `
<div class="layout">
  <div id="sidebar-backdrop" class="sidebar-backdrop" hidden></div>
  <aside id="sidebar" class="sidebar" aria-label="Sidebar">
    <nav aria-label="Docs navigation">
      ${sidebarHtml(page.link)}
    </nav>
  </aside>
  <main id="main-content" class="content">
    <div class="doc-toolbar">${pageMenuHtml(page.link)}</div>
    <article class="doc">
      ${article}
    </article>
    ${prevNextHtml(pageIndex, flat)}
  </main>
  <aside class="aside" aria-label="Page outline">${outlineHtml(headings, leadWords)}</aside>
</div>`
  return pageShell({
    title: page.title,
    description: page.description,
    pathname: page.link,
    shell: 'doc',
    bodyClass: 'doc-page',
    header: headerHtml(),
    main,
  })
}


// Headline numbers come from the committed benchmark report, read here at build
// time, so a card on the home page can never disagree with the file in the
// repository. It is one measurement on one machine, and the caption says so.
const baseline = JSON.parse(
  await readFile(path.join(repoRoot, 'benchmarks', 'm6-baseline.json'), 'utf8'),
)

function benchNumber(value) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function homeBenchCards() {
  const yuku = baseline.statistics.yuku.ns_per_parse.median
  const core = baseline.statistics.core.ns_per_parse.median
  const cards = [
    {
      value: `${benchNumber(yuku)} ns`,
      label: 'yuku-tsrx median ns per parse',
    },
    {
      value: `${benchNumber(core)} ns`,
      label: '@tsrx/core median ns per parse',
    },
    {
      value: baseline.ratios.ns_per_parse.toFixed(4),
      label: 'ratio, yuku-tsrx over @tsrx/core',
    },
  ]
  return `<div class="gate-grid" role="group" aria-label="Median parse time from the committed benchmark report">${cards
    .map(
      (card) => `
  <div class="bench-row gate-card" role="img" aria-label="${escapeHtml(`${card.label}: ${card.value}`)}">
    <span class="gate-value">${escapeHtml(card.value)}</span>
    <span class="gate-label">${escapeHtml(card.label)}</span>
  </div>`,
    )
    .join('')}</div>`
}

async function renderHomePage({ description }) {
  const hero = config.hero
  const main = `
<main id="main-content" class="home">
  <section class="hero">
    <img class="hero-logo" src="${withBase('/assets/logo.svg')}" alt="" width="64" height="64" />
    <h1 class="hero-name">${hero.name}</h1>
    <p class="hero-text">${hero.text}</p>
    <p class="hero-tagline">${hero.tagline}</p>
    <div class="hero-actions">
      ${hero.actions
        .map(
          (action) =>
            `<a class="action action-${action.theme}" href="${withBase(action.link)}">${action.text}</a>`,
        )
        .join('\n')}
    </div>
  </section>
  <section class="band" aria-label="TSRX example">
    <div class="code-panel" id="hero-demo">
      <div class="code-panel-bar">
        <span class="code-panel-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="code-panel-file">src/Cart.tsrx</span>
      </div>
      <div class="code-panel-editor" id="demo-editor">
        ${addTsrxHovers(highlightHtml(heroCode, 'tsrx'))}
      </div>
      <div class="code-panel-status">
        <span id="demo-status">a TSRX component, highlighted with the TSRX grammar</span>
      </div>
    </div>
  </section>
  <section class="home-bench" aria-label="Measured parse time">
    <h2>Measured, not claimed</h2>
    <p>These three numbers are read out of <code>benchmarks/m6-baseline.json</code> when this page is built, so they cannot drift from the committed report.</p>
    ${homeBenchCards()}
    <p class="home-bench-caption">One measurement on one machine. Your hardware will differ.</p>
    <p class="home-bench-link"><a href="${withBase('/reference/benchmarks')}">See the report and its caveats</a></p>
  </section>
  <section class="features" aria-label="Feature highlights">
    <ul class="features-grid">
      ${config.features
        .map(
          (feature) => `
      <li class="feature">
        <span class="feature-icon">${feature.icon}</span>
        <h2 class="feature-title">${feature.title}</h2>
        <p class="feature-details">${feature.details}</p>
      </li>`,
        )
        .join('\n')}
    </ul>
  </section>
  <section class="home-upstream" aria-label="Relationship to Yuku">
    <h2>Built on the Yuku seam in PR #164</h2>
    <p>yuku-tsrx is a dialect adapter that plugs into the extension points Yuku exposes. It is an independent project and nothing here is a fork of Yuku.</p>
    <p class="home-upstream-link"><a href="${withBase('/architecture/upstreaming-to-yuku')}">Read how the seam is used</a></p>
  </section>
  <footer class="home-footer">
    <p class="footer-links"><a href="${config.repository}" target="_blank" rel="noreferrer">GitHub<span class="visually-hidden"> (opens in new tab)</span></a></p>
    <p class="footer-badge">${escapeHtml(config.footer.copyright)}</p>
    <p class="footer-disclaimer">${config.footer.disclaimer}</p>
  </footer>
</main>`
  return pageShell({
    title: config.title,
    description,
    pathname: '/',
    shell: 'home',
    bodyClass: 'home-page',
    header: headerHtml(),
    main,
  })
}

async function build() {
  await validateOutputDirectory()
  await rm(outDir, { recursive: true, force: true })
  await mkdir(siteDir, { recursive: true })

  const flat = config.sidebar.flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.text })),
  )
  const pages = [...flat]
  const searchDocs = []

  const markdownPages = []
  for (const [pageIndex, item] of pages.entries()) {
    const sourcePath = path.join(docsDir, `${item.link.replace(/^\//, '')}.md`)
    const source = await readFile(sourcePath, 'utf8')
    const { data, body } = parseFrontmatter(source)
    let exportedBody = body
    const page = {
      link: item.link,
      group: item.group,
      title: data.title || item.text,
      description: data.description || '',
    }
    const headings = []
    const marked = createMarked(makeSlugger(), headings)
    let article = marked.parse(body)
    article = article
      .replaceAll('<table>', '<div class="table-wrap"><table>')
      .replaceAll('</table>', '</table></div>')
      // A markdown table that opens its header row with a blank cell is a
      // cross-tab: the first column carries row labels, so it has no column
      // name to print. Marked still emits `<th></th>` for it, and a header
      // cell with no accessible text is a header that announces nothing, which
      // axe flags as empty-table-header. The corner cell of a cross-tab is a
      // plain `td` in the HTML spec's own example, so emit that instead.
      .replace(/<th([^>]*)>\s*<\/th>/g, '<td$1></td>')
    if (article.includes('<!-- details:')) {
      article = disclosureHtml(article)
      exportedBody = disclosureMarkdown(exportedBody)
    }
    article = addGlossary(article)
    searchDocs.push(...extractSections(new Marked(), exportedBody, page))
    const leadWords = annotateReadingTime(article, headings)
    const html = renderDocPage({
      page,
      article,
      headings,
      leadWords,
      pageIndex,
      flat,
    })
    const outPath = path.join(siteDir, `${item.link.replace(/^\//, '')}.html`)
    await mkdir(path.dirname(outPath), { recursive: true })
    await writeFile(outPath, dedupeBrandIcons(html))
    // Raw markdown twin for the copy-as-Markdown button and llms-full.txt.
    await writeFile(outPath.replace(/\.html$/, '.md'), exportedBody)
    markdownPages.push({ ...page, body: exportedBody })
  }

  // llms.txt index and llms-full.txt corpus (https://llmstxt.org).
  const llmsIndex = [
    `# ${config.title}`,
    '',
    `> ${config.description}`,
    '',
    ...config.sidebar.map((group) =>
      [
        `## ${group.text}`,
        '',
        ...group.items.map((item) => {
          const page = markdownPages.find((candidate) => candidate.link === item.link)
          return `- [${item.text}](${withBase(`${item.link}.md`)})${page?.description ? `: ${page.description}` : ''}`
        }),
        '',
      ].join('\n'),
    ),
  ].join('\n')
  await writeFile(path.join(siteDir, 'llms.txt'), llmsIndex)
  await writeFile(
    path.join(siteDir, 'llms-full.txt'),
    markdownPages
      .map((page) => `<!-- ${page.group} / ${page.title} (${page.link}) -->\n\n${page.body}`)
      .join('\n\n---\n\n'),
  )

  const home = parseFrontmatter(await readFile(path.join(docsDir, 'index.md'), 'utf8'))
  await writeFile(
    path.join(siteDir, 'index.html'),
    dedupeBrandIcons(await renderHomePage({ description: home.data.description })),
  )

  await cp(path.join(docsDir, 'assets'), path.join(siteDir, 'assets'), { recursive: true })
  // Ship one stylesheet per page shell, without comments (the source keeps
  // them). Every byte here is on the critical path of the page that links it,
  // so a page gets the rules it can match and nothing else.
  //
  // The unsplit stylesheet still ships, at the path it has always had, and it is
  // deliberately not linked by anything this build emits. It is here for the
  // documents that were served BEFORE the split, which link
  // `/assets/style.css`.
  await writeFile(
    path.join(siteDir, 'assets', 'style.css'),
    styleSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n'),
  )
  for (const [shell, lines] of styleBundles) {
    await writeFile(
      path.join(siteDir, 'assets', `style-${shell}.css`),
      lines
        .join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\n{3,}/g, '\n\n'),
    )
  }
  await cp(
    path.join(repoRoot, 'node_modules', 'minisearch', 'dist', 'es'),
    path.join(siteDir, 'assets', 'minisearch'),
    { recursive: true },
  )
  await writeFile(path.join(siteDir, 'search-index.json'), JSON.stringify(searchDocs))
  // Site navigation links are extensionless (/guide/introduction); Vercel needs
  // cleanUrls to resolve them to the .html files. The deploy root itself is not
  // part of the site, so it redirects into the base path.
  await writeFile(
    path.join(outDir, 'vercel.json'),
    `${JSON.stringify({
      cleanUrls: true,
      trailingSlash: false,
      redirects: trimmedBase
        ? [{ source: '/', destination: trimmedBase, permanent: false }]
        : [],
      rewrites: [],
      headers: [],
    })}\n`,
  )

  const publicPaths = ['/', ...pages.map(({ link }) => link)]
  await writeFile(
    path.join(outDir, 'robots.txt'),
    `User-agent: *\nAllow: ${base}\nSitemap: ${canonicalUrl('/sitemap.xml')}\n`,
  )
  await writeFile(
    path.join(siteDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicPaths
      .map((pathname) => `  <url><loc>${canonicalUrl(pathname)}</loc></url>`)
      .join('\n')}\n</urlset>\n`,
  )

  console.log(`built ${publicPaths.length} pages, ${searchDocs.length} search sections -> ${outDir}`)
}

await build()
