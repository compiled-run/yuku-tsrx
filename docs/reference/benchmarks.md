---
title: Benchmarks
description: One parse-time measurement of yuku-tsrx against @tsrx/core, with its provenance and its caveats.
---

# Benchmarks

There is one benchmark. It compares yuku-tsrx against
[`@tsrx/core`](https://www.npmjs.com/package/@tsrx/core), the pure-JavaScript
parser Markless uses today, on the same corpus, on one machine, on one day.

Every number on this page is read out of
[`benchmarks/m6-baseline.json`](https://github.com/compiled-run/yuku-tsrx/blob/main/benchmarks/m6-baseline.json).
That file is committed, so you can check any of them.

## The numbers

| Measure | yuku-tsrx | `@tsrx/core` | Ratio |
| --- | --- | --- | --- |
| Median ns per parse | 29,666.2 | 103,075.4 | 0.2878 |
| p95 ns per parse | 30,307.0 | 106,420.8 | |
| Median parses per second | 33,708 | 9,702 | |
| Median peak resident memory | 264,740,864 bytes | 309,960,704 bytes | 0.8541 |

Read as a sentence: median 29.7 microseconds per parse for yuku-tsrx against
103.1 for `@tsrx/core`, a ratio of 0.288, and peak resident memory 0.85 times
`@tsrx/core`'s.

The report's `valid` field is `true`, which is the harness's own statement that
the run met its noise conditions.

## What was measured

| | |
| --- | --- |
| Corpus | 224 files, 214,751 bytes total |
| Iterations | 25 per sample |
| Samples | 20, after 5 warmups |
| Isolation | one fresh child process per scenario, variant, and sample; serial seeded order; no forced garbage collection |
| Conditioning | one untimed pass over the corpus before the timed parse loop |
| Timed region | the parse loop only |
| Peak memory | whole-child maximum resident set size |
| Parse options | `collect: false`, `loose: false` |

Run order alternates between the two parsers across samples, so neither one
consistently goes first.

## Provenance

| | |
| --- | --- |
| Node | v24.15.0 |
| pnpm | 10.33.2 |
| Zig | 0.16.0 |
| Platform | darwin arm64 |
| CPU | Apple M5 Pro, 18 logical cores |
| Memory | 51,539,607,552 bytes |
| Locale | C |

The report also records the commit of every repository involved, the SHA-256 of
the corpus and its manifest, the SHA-256 of each file in the npm package, and
the SHA-256 of the native addon, so a rerun can be checked against exactly the
inputs this one used.

## What this is not

One benchmark, on one corpus, on one machine, on one day. Treat it as one
measurement, not a general claim.

- It measures parse time and peak resident memory. Nothing else.
- The corpus is one project's files, not a representative sample of TSRX in
  general. A corpus with different shape, longer files, deeper markup, more
  TypeScript types, would give a different ratio.
- It ran on an Apple M5 Pro. Your hardware will differ, and the two parsers do
  not have to differ by the same factor on it.
- Nothing here was rerun to get a better number, and nothing here is a release
  gate. There is no continuous performance suite in this repository.

The result that mattered more than the ratio was the drop-in check that ran
alongside it: on 2026-08-17, against the head of PR #164, Markless's node test
suite (229 files, 1832 tests) passed with yuku-tsrx swapped in for `@tsrx/core`
and no test edits, and its typescript-plugin completion matrix was 47/47. A
parser that is fast and wrong is not useful.
