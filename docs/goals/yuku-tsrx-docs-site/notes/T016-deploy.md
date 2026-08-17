# T016 deploy: interactive surfaces live

- Deployment: dpl_DdAXWkix1MvW4KvfkzEYiD9yqAkW, production, project yuku-tsrx-docs (scope jack-shelton)
- URL: https://yuku-tsrx-docs.vercel.app/yuku-tsrx and /yuku-tsrx/playground
- Build: pnpm run docs:wasm; pnpm run docs:build (14 pages, 1246 KiB of wasm)
- Proof: /yuku-tsrx/playground 200; /yuku-tsrx/assets/wasm/yuku-tsrx.wasm 200 with content-type application/wasm (1,275,960 bytes); no Cross-Origin headers on the home page
- node docs/verify-playground.mjs --url https://yuku-tsrx-docs.vercel.app: ok (hero editor, /playground, all four tabs, try button, SPA round trip, 0 console errors)
- Screenshots (local build, same content): T016-playground-diagnostics.png (Invalid switch fixture, Diagnostics tab, 2 real errors with underlines), T016-home-generated.png (hero editor with Generated code tab)
