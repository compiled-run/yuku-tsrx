#!/usr/bin/env node
// Proves the interactive surfaces in a real browser, because "the wasm parses
// in Node" says nothing about whether the page can load it, and a tab that
// renders nothing looks exactly like a tab that renders something until you
// open one.
//
//   node docs/verify-playground.mjs                serves docs/dist locally
//   node docs/verify-playground.mjs --url <origin> runs against a deployment
//
// It fails on any console error or uncaught page error, so a silently broken
// import cannot pass.

import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import config from './site.config.mjs'

const docsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(docsDir, '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const basePath = `/${config.base.split('/').filter(Boolean).join('/')}`.replace(/\/$/, '')

const urlFlag = process.argv.indexOf('--url')
const externalOrigin = urlFlag === -1 ? null : process.argv[urlFlag + 1]
if (urlFlag !== -1 && !externalOrigin) throw new Error('--url needs an origin')

const failures = []
const notes = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
  return condition
}

async function startServer() {
  const child = spawn(process.execPath, [path.join(docsDir, 'serve.mjs'), '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: repoRoot,
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const origin = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(
      () => reject(new Error(`docs/serve.mjs did not start: ${stderr || buffer}`)),
      15_000,
    )
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(buffer)
      if (match) {
        clearTimeout(timer)
        resolve(`http://127.0.0.1:${match[1]}`)
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`docs/serve.mjs exited with ${code}: ${stderr}`))
    })
  })
  return { origin, stop: () => child.kill() }
}

// Every page in the run shares one console-error sink: a stray error on the
// third page is as disqualifying as one on the first.
function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`${label}: console error: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    failures.push(`${label}: page error: ${error.message}`)
  })
  page.on('requestfailed', (request) => {
    failures.push(`${label}: request failed: ${request.url()} (${request.failure()?.errorText})`)
  })
}

const statusText = (page) =>
  page.evaluate(() => document.getElementById('demo-status')?.textContent ?? '')

const waitForParse = (page) =>
  page.waitForFunction(
    () => {
      const text = document.getElementById('demo-status')?.textContent ?? ''
      return !text.includes('loading') && / ms · /.test(text)
    },
    null,
    { timeout: 30_000 },
  )

const TABS = [
  ['ast', 'pg-ast'],
  ['diagnostics', 'pg-diagnostics'],
  ['generated', 'pg-generated'],
  ['semantic', 'pg-semantic'],
]

async function openTabs(page, label) {
  const seen = {}
  for (const [tab, target] of TABS) {
    await page.click(`#pg-tab-${tab}`)
    try {
      await page.waitForFunction(
        (id) => (document.getElementById(id)?.textContent ?? '').trim().length > 0,
        target,
        { timeout: 15_000 },
      )
    } catch {
      failures.push(`${label}: the ${tab} panel stayed empty`)
    }
    const selected = await page.getAttribute(`#pg-tab-${tab}`, 'aria-selected')
    check(selected === 'true', `${label}: ${tab} tab did not become the selected tab`)
    const hidden = await page.getAttribute(`#pg-panel-${tab}`, 'hidden')
    check(hidden === null, `${label}: ${tab} panel stayed hidden after its tab was clicked`)
    seen[tab] = await page.textContent(`#${target}`)
  }
  return seen
}

async function main() {
  const server = externalOrigin ? null : await startServer()
  const origin = externalOrigin ?? server.origin
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })

    // ---- home page: the hero panel is a live editor with the four tabs ----
    const home = await context.newPage()
    watch(home, 'home')
    const wasmResponses = []
    home.on('response', (response) => {
      if (response.url().endsWith('.wasm')) {
        wasmResponses.push({
          status: response.status(),
          type: response.headers()['content-type'] ?? '',
        })
      }
    })
    await home.goto(`${origin}${basePath}/`, { waitUntil: 'load' })
    await waitForParse(home)
    const homeStatus = await statusText(home)
    check(homeStatus.includes('nodes'), `home: status has no node count: ${homeStatus}`)
    check(
      homeStatus.includes('runs in your browser'),
      `home: status does not say where it ran: ${homeStatus}`,
    )
    notes.push(`home status: ${homeStatus}`)
    check(wasmResponses.length > 0, 'home: the page never requested the wasm module')
    for (const response of wasmResponses) {
      check(response.status === 200, `home: wasm responded ${response.status}`)
      check(
        response.type.includes('application/wasm'),
        `home: wasm served as ${response.type || 'no content-type'}`,
      )
    }

    const homeTabs = await openTabs(home, 'home')
    check(
      homeTabs.ast.includes('JSXCodeBlock'),
      'home: the AST tab does not mention JSXCodeBlock, so it is not the TSRX AST',
    )
    check(
      homeTabs.diagnostics.includes('0 diagnostics'),
      `home: the hero snippet reported diagnostics: ${homeTabs.diagnostics.slice(0, 120)}`,
    )
    check(homeTabs.generated.includes('Cart'), 'home: the generated code tab does not mention Cart')
    check(
      /\d+ symbols/.test(homeTabs.semantic),
      `home: the semantic tab has no symbol count: ${homeTabs.semantic.slice(0, 120)}`,
    )

    // Typing has to move the status line: that is the whole claim of the panel.
    await home.click('#demo-input')
    await home.keyboard.press('Meta+ArrowDown')
    await home.keyboard.type('\nconst verified = 1;')
    await home.waitForFunction(
      (previous) => {
        const text = document.getElementById('demo-status')?.textContent ?? ''
        return text !== previous && / ms · /.test(text)
      },
      homeStatus,
      { timeout: 15_000 },
    )
    const editedStatus = await statusText(home)
    check(editedStatus.includes('nodes'), `home: edited status has no node count: ${editedStatus}`)
    notes.push(`home status after typing: ${editedStatus}`)

    // ---- /playground: fixtures, and real diagnostics on the invalid one ----
    const playground = await context.newPage()
    watch(playground, 'playground')
    await playground.goto(`${origin}${basePath}/playground`, { waitUntil: 'load' })
    await waitForParse(playground)
    notes.push(`playground status: ${await statusText(playground)}`)
    await openTabs(playground, 'playground')

    await playground.click('#pg-scenario-control-flow-switch-invalid')
    await playground.click('#pg-tab-diagnostics')
    try {
      await playground.waitForFunction(
        () => (document.getElementById('pg-diagnostics')?.textContent ?? '').includes('error'),
        null,
        { timeout: 15_000 },
      )
    } catch {
      failures.push('playground: the invalid switch fixture produced no error diagnostic')
    }
    const invalidStatus = await statusText(playground)
    notes.push(`invalid fixture status: ${invalidStatus}`)
    const fixtureSource = await playground.inputValue('#demo-input')
    check(
      fixtureSource.includes('@switch'),
      'playground: the fixture button did not load the committed fixture text',
    )

    // ---- a doc fence, handed to the playground by its own button ----
    const guide = await context.newPage()
    watch(guide, 'guide')
    await guide.goto(`${origin}${basePath}/guide/tsrx-syntax`, { waitUntil: 'load' })
    const button = guide.locator('.try-button').first()
    const fence = await button.getAttribute('data-code')
    check(Boolean(fence), 'guide: the first try button carries no source')
    await button.click({ force: true })
    await guide.waitForFunction(() => location.hash.startsWith('#code='), null, { timeout: 15_000 })
    check(
      new URL(guide.url()).pathname.endsWith('/playground'),
      `guide: the try button landed on ${guide.url()}`,
    )
    await waitForParse(guide)
    const loaded = await guide.inputValue('#demo-input')
    check(
      loaded.trim() === (fence ?? '').trim(),
      'guide: the playground did not load the fence the button carried',
    )
    notes.push(`try button loaded ${loaded.split('\n').length} lines into the playground`)

    // ---- T023: the four home benchmark cards ----
    const cards = await home.$$eval('.gate-card', (nodes) =>
      nodes.map((node) => node.textContent.replace(/\s+/g, ' ').trim()),
    )
    check(cards.length === 4, `home: ${cards.length} benchmark cards, expected 4`)
    check(
      /\d\.\d\d[x×]/.test(cards[0] ?? ''),
      `home: the first card carries no two-decimal multiple: ${cards[0]}`,
    )
    notes.push(`home cards: ${cards.join(' | ')}`)

    // ---- T023: the engine-backed guide figures ----
    const figureStatus = (page, selector) =>
      page.evaluate(
        (marker) =>
          document.querySelector(`${marker} [data-ex-status]`)?.textContent?.trim() ?? '',
        selector,
      )
    const waitForFigure = (page, selector, pattern) =>
      page.waitForFunction(
        ([marker, source]) =>
          new RegExp(source).test(
            document.querySelector(`${marker} [data-ex-status]`)?.textContent ?? '',
          ),
        [selector, pattern.source],
        { timeout: 30_000 },
      )

    const parserPage = await context.newPage()
    watch(parserPage, 'guide/parser')
    await parserPage.goto(`${origin}${basePath}/guide/parser`, { waitUntil: 'load' })
    check(
      (await parserPage.locator('[data-ast-explorer]').count()) === 1,
      'guide/parser: the AST explorer figure is not on the page',
    )
    await parserPage.locator('[data-ast-explorer]').scrollIntoViewIfNeeded()
    await waitForFigure(parserPage, '[data-ast-explorer]', /nodes/)
    notes.push(`ast explorer: ${await figureStatus(parserPage, '[data-ast-explorer]')}`)
    await parserPage.locator('[data-ast-explorer] .ex-tree button').nth(2).hover()
    const hitCount = await parserPage.locator('[data-ast-explorer] .ex-seg.ex-hit').count()
    check(hitCount > 0, 'guide/parser: hovering an AST row highlighted no source')
    await parserPage.locator('[data-ast-explorer] .ex-seg').nth(6).hover()
    const pressed = await parserPage.locator('[data-ast-explorer] .ex-tree [aria-pressed="true"]').count()
    check(
      pressed === 1,
      `guide/parser: hovering the source lit ${pressed} tree rows, expected exactly one`,
    )

    const analyzerPage = await context.newPage()
    watch(analyzerPage, 'guide/analyzer')
    await analyzerPage.goto(`${origin}${basePath}/guide/analyzer`, { waitUntil: 'load' })
    check(
      (await analyzerPage.locator('[data-symbol-explorer]').count()) === 1,
      'guide/analyzer: the symbol explorer figure is not on the page',
    )
    await analyzerPage.locator('[data-symbol-explorer]').scrollIntoViewIfNeeded()
    await waitForFigure(analyzerPage, '[data-symbol-explorer]', /symbols/)
    notes.push(`symbol explorer: ${await figureStatus(analyzerPage, '[data-symbol-explorer]')}`)
    const symbolRow = await analyzerPage.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-symbol-explorer] tr[data-ex-symbol]')]
      const wanted = rows.find((row) => row.querySelector('td')?.textContent?.trim() === 'item')
      return Number((wanted ?? rows[0])?.dataset.exSymbol ?? -1)
    })
    check(symbolRow >= 0, 'guide/analyzer: the symbol table has no rows')
    await analyzerPage.locator(`[data-symbol-explorer] tr[data-ex-symbol="${symbolRow}"]`).click()
    const declCount = await analyzerPage.locator('[data-symbol-explorer] .ex-decl').count()
    const refCount = await analyzerPage.locator('[data-symbol-explorer] .ex-ref').count()
    check(declCount >= 1, 'guide/analyzer: the selected symbol lit no declaration')
    check(refCount >= 1, 'guide/analyzer: the selected symbol lit no reference')
    const scopeRows = await analyzerPage.locator('[data-symbol-explorer] [data-ex-scope]').count()
    check(scopeRows >= 3, `guide/analyzer: the scope tree has ${scopeRows} rows, expected 3 or more`)
    notes.push(`symbol click lit ${declCount} declaration and ${refCount} reference segments`)

    const codegenPage = await context.newPage()
    watch(codegenPage, 'guide/codegen')
    await codegenPage.goto(`${origin}${basePath}/guide/codegen`, { waitUntil: 'load' })
    check(
      (await codegenPage.locator('[data-codegen-walkthrough]').count()) === 1,
      'guide/codegen: the codegen walkthrough figure is not on the page',
    )
    await codegenPage.locator('[data-codegen-walkthrough]').scrollIntoViewIfNeeded()
    await waitForFigure(codegenPage, '[data-codegen-walkthrough]', /generated in/)
    const generated = codegenPage.locator('[data-codegen-walkthrough] [data-ex-generated]')
    const prettyOutput = await generated.textContent()
    check(
      prettyOutput.includes('\n  ') && prettyOutput.includes('total === 0'),
      'guide/codegen: the default output is not indented, so pretty is not the default',
    )
    await codegenPage.click('[data-codegen-walkthrough] [data-ex-value="compact"]')
    await codegenPage.waitForFunction(
      (previous) =>
        (document.querySelector('[data-codegen-walkthrough] [data-ex-generated]')?.textContent ??
          '') !== previous,
      prettyOutput,
      { timeout: 15_000 },
    )
    const compactOutput = await generated.textContent()
    // Not "no newline is left anywhere": the text children of a JSX element are
    // significant, so compact output keeps the markup's own line breaks. What
    // compact drops is the discretionary whitespace, which is what these two
    // assertions read.
    check(
      compactOutput.includes('total===0') && !compactOutput.includes('total === 0'),
      'guide/codegen: the compact output still spaces its operators',
    )
    check(
      compactOutput.length < prettyOutput.length,
      `guide/codegen: compact output is not shorter than pretty (${compactOutput.length} vs ${prettyOutput.length})`,
    )
    await codegenPage.click('[data-codegen-walkthrough] [data-ex-flag="strip"]')
    await codegenPage.waitForFunction(
      (previous) =>
        (document.querySelector('[data-codegen-walkthrough] [data-ex-generated]')?.textContent ??
          '') !== previous,
      compactOutput,
      { timeout: 15_000 },
    )
    const strippedOutput = await generated.textContent()
    check(
      strippedOutput !== compactOutput,
      'guide/codegen: strip did not change the generated source',
    )
    check(
      await codegenPage.locator('[data-codegen-walkthrough] [data-ex-value="shortest"]').isDisabled(),
      'guide/codegen: the shortest quotes chip is not disabled',
    )
    const call = await codegenPage.textContent('[data-codegen-walkthrough] .ex-call')
    check(
      call.includes('format: "compact"'),
      `guide/codegen: the equivalent call does not name the compact format: ${call}`,
    )
    notes.push(`codegen walkthrough: ${call.trim()}`)

    // ---- T024: the how-it-works step-through on the introduction ----
    const introPage = await context.newPage()
    watch(introPage, 'guide/introduction')
    await introPage.goto(`${origin}${basePath}/guide/introduction`, { waitUntil: 'load' })
    const hiwSteps = introPage.locator('[data-how-it-works] [data-hiw-step]')
    check(
      (await introPage.locator('[data-how-it-works]').count()) === 1,
      'guide/introduction: the how-it-works figure is not on the page',
    )
    const stepCount = await hiwSteps.count()
    check(stepCount === 5, `guide/introduction: ${stepCount} steps, expected 5`)
    await hiwSteps.nth(1).click()
    const step = await introPage.getAttribute('[data-how-it-works]', 'data-step')
    check(step === 'hooks', `guide/introduction: the second step selected "${step}", expected hooks`)
    // "Visible" as the browser computes it, not as the markup implies: the
    // whole point of the CSS is that one panel is displayed at a time and all
    // five are displayed when the figure never got a data-step.
    const visiblePanels = await introPage.$$eval('[data-hiw-panel]', (nodes) =>
      nodes.filter((node) => node.offsetParent !== null).map((node) => node.dataset.hiwPanel),
    )
    check(
      visiblePanels.length === 1 && visiblePanels[0] === 'hooks',
      `guide/introduction: visible panels are ${visiblePanels.join(', ') || 'none'}, expected only hooks`,
    )
    const hookChips = await introPage.locator('[data-hiw-panel="hooks"] code').count()
    check(
      hookChips === 20,
      `guide/introduction: the hooks panel shows ${hookChips} chips, expected the 20 in parser_extension.zig`,
    )
    notes.push(`how-it-works: ${stepCount} steps, ${hookChips} hook chips`)

    // ---- T024: the getting-started chooser and the recorded transcripts ----
    const startPage = await context.newPage()
    watch(startPage, 'guide/getting-started')
    await startPage.goto(`${origin}${basePath}/guide/getting-started`, { waitUntil: 'load' })
    // interactive.js is a dynamic import, so on a real network the chips exist
    // in the HTML before anything is listening to them. data-ready is set by
    // initChoosers and is the only honest signal that a click will land.
    await startPage.waitForSelector('[data-chooser][data-ready]', { timeout: 30_000 })
    const options = startPage.locator('[data-chooser] [data-chooser-option]')
    const optionCount = await options.count()
    check(optionCount === 3, `guide/getting-started: ${optionCount} chooser options, expected 3`)
    await options.nth(1).click()
    const shownPanels = await startPage.$$eval('[data-chooser-panel]', (nodes) =>
      nodes.filter((node) => !node.hidden).map((node) => node.dataset.chooserPanel),
    )
    check(
      shownPanels.length === 1 && shownPanels[0] === '1',
      `guide/getting-started: chooser shows panel(s) ${shownPanels.join(', ') || 'none'}, expected only 1`,
    )
    const terminals = startPage.locator('[data-terminal-demo]')
    const terminalCount = await terminals.count()
    check(terminalCount === 2, `guide/getting-started: ${terminalCount} terminal demos, expected 2`)

    // The recording plays a line at a time, so "it played" means every line is
    // visible again at the end and the button offers a replay.
    const buildTerminal = startPage.locator('[data-terminal-demo]').nth(1)
    await buildTerminal.scrollIntoViewIfNeeded()
    await buildTerminal.locator('[data-terminal-play]').click()
    await startPage.waitForFunction(
      () => {
        const terminal = document.querySelectorAll('[data-terminal-demo]')[1]
        if (!terminal || terminal.dataset.playing) return false
        return [...terminal.querySelectorAll('.gs-terminal-line')].every(
          (line) => !line.classList.contains('gs-terminal-line-hidden'),
        )
      },
      null,
      { timeout: 30_000 },
    )
    const played = await buildTerminal.locator('.gs-terminal-transcript').textContent()
    check(played.includes('zig build'), 'guide/getting-started: the transcript has no zig build line')
    check(played.includes('# exit 0'), 'guide/getting-started: the transcript has no exit status')

    // The text on screen is the committed JSON, not a retelling of it: every
    // output line of every entry has to be in the played transcript.
    const buildJson = JSON.parse(
      await readFile(path.join(docsDir, 'transcripts', 'getting-started-build.json'), 'utf8'),
    )
    for (const entry of buildJson.transcript) {
      check(
        played.includes(entry.command),
        `guide/getting-started: the played transcript is missing the command ${entry.command}`,
      )
      check(
        entry.exit_code === 0,
        `docs/transcripts: ${entry.command} is committed with exit ${entry.exit_code}`,
      )
      for (const line of entry.output.split('\n').filter(Boolean)) {
        check(
          played.includes(line),
          `guide/getting-started: the played transcript is missing the output line "${line}"`,
        )
      }
    }
    const caption = await buildTerminal.locator('figcaption').textContent()
    check(
      caption.trim() === buildJson.caption,
      `guide/getting-started: the caption is not the committed one: ${caption}`,
    )
    notes.push(`terminal demo: ${buildJson.transcript.length} commands, ${caption.trim()}`)

    // The router swaps the routed region in place, so the panel is torn down
    // and rebuilt without a page load. Both directions have to survive it.
    const spa = await context.newPage()
    watch(spa, 'spa')
    await spa.goto(`${origin}${basePath}/guide/introduction`, { waitUntil: 'load' })
    await spa.click('.top-nav a[href$="/playground"]')
    await spa.waitForFunction(() => Boolean(document.getElementById('demo-input')), null, {
      timeout: 15_000,
    })
    await waitForParse(spa)
    check(
      new URL(spa.url()).pathname.endsWith('/playground'),
      `spa: forward navigation landed on ${spa.url()}`,
    )
    await spa.click('.top-nav a[href$="/guide/introduction"]')
    await spa.waitForFunction(() => !document.getElementById('demo-input'), null, { timeout: 15_000 })
    await spa.click('.top-nav a[href$="/playground"]')
    await spa.waitForFunction(() => Boolean(document.getElementById('demo-input')), null, {
      timeout: 15_000,
    })
    await waitForParse(spa)
    notes.push(`spa round trip status: ${await statusText(spa)}`)
  } finally {
    await browser.close()
    server?.stop()
  }

  const wasm = await stat(
    path.join(repoRoot, 'docs', 'dist', ...basePath.split('/').filter(Boolean), 'assets', 'wasm', 'yuku-tsrx.wasm'),
  ).catch(() => null)
  if (wasm) notes.push(`wasm: ${(wasm.size / 1024).toFixed(0)} KiB in docs/dist`)
}

await main()

console.log('playground verification')
for (const note of notes) console.log(`  ${note}`)
if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log('\nok: hero editor, /playground, all four tabs, and the try button work with no console errors')
}
