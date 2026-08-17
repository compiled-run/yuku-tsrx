# T003 cutover (waiting on owner)

Before (compiled.run on oxc-tsrx-docs, 2026-08-17 23:19Z): see T003-before.txt (oxc and guessless 200, yuku-tsrx 404).

The PM session is not permitted to run the domain reassignment. Owner runs:

    vercel domains add compiled.run compiled-run-website --force --scope jack-shelton

Then the PM verifies the same route table on compiled.run, crossOriginIsolated on /oxc-tsrx/playground, and records after.
