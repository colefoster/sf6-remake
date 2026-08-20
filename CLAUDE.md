# sf6-remake

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Refreshing the dump

`data/raw/mmdk/` is a dump of the **live game** (Aug-2026, 24 fighters) as of
ADR-0045; the old third-party snapshot lives in `data/raw/mmdk-2024/` and is what
`fetch-mmdk.mjs` downloads — never point it at `mmdk/`. Skew between the two is
measured: **+0.6 points**, and six sevenths of every residual survives the
re-pin. It runs both ways — FAT lags the game on 49 rows. Run
`scripts/skew-audit.mjs` before attributing a residual to a mechanic; see
`docs/agents/refresh-the-dump.md`. Six fighters plus Yasmine cannot be dumped at
all: MMDK's roster is a hardcoded table that stops at Terry.

### Domain docs

Single-context (`CONTEXT.md` + `docs/adr/` at repo root). See `docs/agents/domain.md`.
