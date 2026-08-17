# T003 cutover (waiting on owner)

Before (compiled.run on oxc-tsrx-docs, 2026-08-17 23:19Z): see T003-before.txt (oxc and guessless 200, yuku-tsrx 404).

The PM session is not permitted to run the domain reassignment. Owner runs:

    vercel domains add compiled.run compiled-run-website --force --scope jack-shelton

Then the PM verifies the same route table on compiled.run, crossOriginIsolated on /oxc-tsrx/playground, and records after.

## After (owner ran the command; verified 2026-08-17 23:45Z)

See T003-after.txt: every path 200 including /yuku-tsrx*, landing links all three projects, COOP/COEP on /oxc-tsrx/playground only. vercel domains inspect: compiled.run is on project compiled-run-website. Headless Chrome on compiled.run: /oxc-tsrx/playground crossOriginIsolated true, 0 console errors; /yuku-tsrx/playground "parsed in 16 ms · 92 nodes · 0 diagnostics", 0 console errors.
