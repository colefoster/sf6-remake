# ADR 0002 — Frame data sourced from FAT, vendored and adapted

- Status: accepted
- Date: 2026-08-03

## Context

We need real, complete, machine-readable SF6 frame data for the whole roster.
Options surveyed: SuperCombo wiki (HTML), Ultimate Frame Data (HTML + GIFs),
fullmeter.com/fatonline (the "Frame Assistant Tool"), scattered GitHub repos.

## Decision

Use **[D4RKONION/FAT](https://github.com/D4RKONION/FAT)** —
`src/js/constants/framedata/SF6FrameData.json` — the JSON that powers the FAT
app. It is one consolidated file covering all 30 characters (current roster,
incl. Mai, Terry, Elena, Akuma, Ed) and is crowd-corrected by the FAT team, so
it is the most accurate machine-readable source available.

- **Vendor** the file at `data/raw/SF6FrameData.json` for reproducibility (no
  network at runtime, deterministic tests).
- **Adapt** it at load time (`src/data/fat-adapter.ts`) into our domain model
  rather than mirroring FAT's shape, so the engine depends on our vocabulary,
  not theirs.

## Consequences

- FAT stores many values as human strings (`"11(13)"`, `"21+12"`, `"KD +40"`,
  `"2(13)2"`). The adapter parses the leading integer for engine math and keeps
  the original on `move.raw` so nothing is silently lost. Multi-hit/conditional
  precision beyond the first value is deferred.
- FAT's `xx` cancel field is a set of **classes** (`sp`, `su`, `ch`, `tc`), not
  specific targets, so cancel legality is checked by class. Exact per-cancel
  advantage can be layered on via `move.comboAdvantage` overrides.
- Refreshing data = replace the vendored JSON. Some test expectations assert real
  numbers and may need updating when Capcom rebalances; that is intentional —
  the tests double as a patch-diff check.
