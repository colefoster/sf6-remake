# sf6-remake

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Refreshing the dump

The geometry is extracted from a **pinned, year-old, third-party snapshot** of the
game's data, graded against current frame data. Version skew is now measured:
**+0.5 points overall, +1.7 at worst on a headline check**, and six sevenths of
every residual survives a live dump (ADR-0043). It runs both ways — FAT lags the
game on 49 rows. Run `scripts/skew-audit.mjs` before attributing a residual to a
mechanic; see `docs/agents/refresh-the-dump.md`.

### Domain docs

Single-context (`CONTEXT.md` + `docs/adr/` at repo root). See `docs/agents/domain.md`.
