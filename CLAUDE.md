# sf6-remake

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Refreshing the dump

The geometry is extracted from a **pinned, year-old, third-party snapshot** of the
game's data, graded against current frame data. Version skew is an unquantified
confound in every `sf6 verify` percentage. See `docs/agents/refresh-the-dump.md`
before attributing a residual to a mechanic.

### Domain docs

Single-context (`CONTEXT.md` + `docs/adr/` at repo root). See `docs/agents/domain.md`.
