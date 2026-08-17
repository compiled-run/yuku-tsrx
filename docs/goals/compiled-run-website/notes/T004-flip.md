# T004: retire the oxc-tsrx PR and point yuku-tsrx at compiled.run

- oxc-tsrx PR #24 closed as superseded with a comment pointing at compiled-run/website (no merge; nothing changes in oxc-tsrx).
- yuku-tsrx docs/site.config.mjs origin -> https://compiled.run; README.md docs links -> https://compiled.run/yuku-tsrx; docs/README.md updated.
- Rebuilt and redeployed yuku-tsrx-docs (dpl_FC3kCGZunzFaej8cx2j89bzMSpaw); canonical on compiled.run/yuku-tsrx is https://compiled.run/yuku-tsrx.
- node docs/verify-playground.mjs --url https://compiled.run: ok, 0 console errors.
