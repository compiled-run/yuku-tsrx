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
import { stat } from 'node:fs/promises'
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
