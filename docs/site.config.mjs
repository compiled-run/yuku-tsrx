// Site configuration for the static docs generator (docs/build.mjs).
export default {
  title: 'yuku-tsrx',
  description:
    'A parser, analyzer, and code generator for .tsrx, written in Zig as a compile-time dialect on the Yuku toolchain. Not a fork.',
  origin: 'https://yuku-tsrx-docs.vercel.app',
  // Root-absolute base path the site is served under, with trailing slash.
  base: '/yuku-tsrx/',
  repository: 'https://github.com/compiled-run/yuku-tsrx',
  nav: [
    { text: 'Guide', link: '/guide/introduction' },
    { text: 'Architecture', link: '/architecture/yuku-dialect' },
    { text: 'Reference', link: '/reference/api' },
    { text: 'GitHub', link: 'https://github.com/compiled-run/yuku-tsrx' },
  ],
  sidebar: [
    {
      text: 'Guide',
      items: [
        { text: 'Introduction', link: '/guide/introduction' },
        { text: 'Getting Started', link: '/guide/getting-started' },
        { text: 'TSRX Syntax Support', link: '/guide/tsrx-syntax' },
        { text: 'Parser', link: '/guide/parser' },
        { text: 'Analyzer', link: '/guide/analyzer' },
        { text: 'Code Generator', link: '/guide/codegen' },
      ],
    },
    {
      text: 'Architecture',
      items: [
        { text: 'Zig/Yuku Dialect Core', link: '/architecture/yuku-dialect' },
        { text: 'Upstreaming to Yuku', link: '/architecture/upstreaming-to-yuku' },
      ],
    },
    {
      text: 'Reference',
      items: [
        { text: 'API', link: '/reference/api' },
        { text: 'Benchmarks', link: '/reference/benchmarks' },
        { text: 'Platform Support', link: '/reference/platform-support' },
        { text: 'Limitations', link: '/reference/limitations' },
      ],
    },
  ],
  hero: {
    name: 'yuku-tsrx',
    text: 'A Zig parser, analyzer, and code generator for .tsrx',
    tagline:
      'Built as a compile-time dialect on Yuku, with a JavaScript API on top of a native addon.',
    actions: [
      { theme: 'brand', text: 'Get Started', link: '/guide/getting-started' },
      { theme: 'alt', text: 'What is yuku-tsrx?', link: '/guide/introduction' },
    ],
  },
  features: [
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8.5v7a2 2 0 0 1-1 1.73l-6 3.5a2 2 0 0 1-2 0l-6-3.5A2 2 0 0 1 5 15.5v-7a2 2 0 0 1 1-1.73l6-3.5a2 2 0 0 1 2 0l6 3.5a2 2 0 0 1 1 1.73Z"/><path d="m5.3 7.3 7.7 4.5 7.7-4.5M13 21.5V11.8"/></svg>',
      title: 'A dialect on Yuku',
      details:
        'TSRX rules are compiled into Yuku through its extension points. Yuku does the JavaScript and TypeScript work.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3.5H7a2 2 0 0 0-2 2V10a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4.5a2 2 0 0 0 2 2h1"/><path d="M16 20.5h1a2 2 0 0 0 2-2V14a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5.5a2 2 0 0 0-2-2h-1"/></svg>',
      title: 'A real parser you can call',
      details:
        '<code>parse</code> and <code>parseModule</code> return a TSRX AST from an ESM JavaScript API over a native addon.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.5" fill="currentColor"/></svg>',
      title: 'An analyzer with a semantic view',
      details:
        '<code>analyze</code> adds a <code>SemanticView</code> over references, scopes, and symbols alongside the parse result.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 20V8m0 0L3.5 11.5M7 8l3.5 3.5M17 4v12m0 0 3.5-3.5M17 16l-3.5-3.5"/></svg>',
      title: 'A code generator',
      details:
        '<code>generate</code> turns a program back into source, with options for stripping, minifying, quotes, and comments.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z"/></svg>',
      title: 'TSRX node names, not a lowering',
      details:
        'The AST carries <code>JSXCodeBlock</code>, <code>TSRXExpression</code>, <code>JSXStyleElement</code> and the rest by name.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 4 7v5.5c0 4.4 3.2 7.6 8 8.9 4.8-1.3 8-4.5 8-8.9V7Z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>',
      title: 'No fork',
      details:
        'A Yuku built without a dialect compiles to exactly what it did before. Nothing upstream is copied or patched.',
    },
  ],
  footer: {
    disclaimer: 'An independent project, not affiliated with the Yuku team.',
    // No license has been chosen for this repository, so the footer states none.
    // Leave empty until a LICENSE file exists; build.mjs omits the badge when empty.
    copyright: '',
  },
}
