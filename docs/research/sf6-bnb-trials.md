# SF6 Tools trial format research

Inspected upstream commit `84ce6fde631ae93d4a4059d95a5865dd790be8cb`. `git diff v3.0.1 HEAD` shows no differences in the main trial Lua script or `func/ComboTrials` directory. Read-only source inspection; no game execution.

## Conclusions

- **Action IDs are already available**, with 31 character command catalogs under `reframework/data/TrainingComboTrials_data/command_display`. Each maps action IDs to Classic commands, routes, provenance, and sometimes Modern commands. These are move dictionaries, not prebuilt combo trials.
- **Exact IDs are not mandatory for the core step matcher**: it accepts exact ID OR normalized motion/actual input; `motion_aliases` allows additional strings. Therefore offline wiki-to-trial generation is feasible for straightforward routes, pending game verification. It is incorrect to claim missing IDs or recording every route are mandatory blockers.
- **Demonstrations are separate**: require `raw_inputs`, or a frame-by-frame `timeline`, or a referenced replay record with timeline. A list of move notation does not automatically generate a demonstration.

## Concrete IDs

Ryu standing LP has actions 600, 601, 602; crouching LP has 622, 623, 624. All three entries in each group share the same Classic command, illustrating why selecting one ID alone is brittle. Ryu crouching MP is 627; heavy Shoryuken is 934; light Tatsumaki is 1000.

[Standing LP variants](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/data/TrainingComboTrials_data/command_display/Ryu.json#L423-L647), [crouching LP/MP](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/data/TrainingComboTrials_data/command_display/Ryu.json#L911-L1088), [heavy DP](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/data/TrainingComboTrials_data/command_display/Ryu.json#L3943), [light Tatsu](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/data/TrainingComboTrials_data/command_display/Ryu.json#L4219).

## Match rules and notation caveats

[ActionMatcher.lua lines 9–50](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/autorun/func/ComboTrials/ActionMatcher.lua#L9-L50) uppercases, removes whitespace/plus/leading follow-up `>`, normalizes throw/Drive Rush strings, and strips whiff/blocked suffixes. HP stays distinct from MP/LP. `5LP` is NOT automatically equivalent to the catalog's `LP`; map wiki notation explicitly. `236P` is not automatically equivalent to strength-specific `236LP`. An exact ID match bypasses a differing motion string, so do not invent dummy real IDs; omitting ID is safer than knowingly supplying a wrong one. Shared notation can intentionally accept multiple action variants, but could conflate context-dependent variants; verify held moves, stance followups, and charge levels separately.

## File shape and hit-count semantics

Files are JSON arrays of steps under `reframework/data/TrainingComboTrials_data/CustomCombos/<Character>/...json`. The loader directly assigns the decoded array; there is no formal required-field validator. First step also carries optional metadata/scene/resource/position/recording information. [Loader lines 55–75](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/autorun/func/ComboTrials_Files.lua#L55-L75), [save path and array serialization lines 6223–6240](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/autorun/TrainingComboTrials_v1.0.lua#L6223-L6240).

Practical offline step fields: `motion`, preferably correct `id`, `expected_combo`, `delay_from_prev`. Recording additionally writes HP, hold/charge fields, flags, facing, counter type and victim pose. Minimal shape below is **schema illustration only**, not a claimed tested combo or measured timing:

```json
[
  {"id":622,"motion":"2+LP","expected_combo":1,"delay_from_prev":0},
  {"id":623,"motion":"2+LP","expected_combo":2,"delay_from_prev":12}
]
```

`expected_combo` is the **cumulative combo counter after that step**, not move number or move damage. For three moves hitting 1, 1, 3 times, expect 1, 2, 5, subject to actual runtime hit behavior. At the next move start, validation checks the previous step count, with tolerance for the current hit arriving on the same frame, projectile steps, resets and knockdown. Zero has deliberate setup/reset meaning: do not set every count to zero to avoid doing the work. Final completion checks observed count >= last expected count. [Validator lines 14–52](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/autorun/func/ComboTrials/Validator.lua#L14-L52), [completion/drop checks lines 4855–4914](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/autorun/TrainingComboTrials_v1.0.lua#L4855-L4914).

`delay_from_prev` is action-to-action frame delay, used for early/late guidance and timeout at delay + 60 frames. A nonzero frame difference does not by itself reject an otherwise successful ordinary hit combo; actual combo/HP/hold checks decide. Omitting timing defaults to zero and causes misleading feedback / a 60-frame timeout: ordinary short routes might work but are not polished reliable trials. [Timing feedback and validation lines 5519–5565](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/autorun/TrainingComboTrials_v1.0.lua#L5519-L5565), [timeout lines 4916–4949](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/autorun/TrainingComboTrials_v1.0.lua#L4916-L4949).

## Demo format

Raw input recording is attached to step 1 on save. Legacy timeline strings resemble `3f: 2 + LP` and encode one direction plus pressed buttons held for the specified frames; this is not the same as motion notation `236LP`. Directions become masks, LP=16, MP=32, HP=64, LK=128, MK=256, HK=512. A synthetic demo is technically possible, but requires correct input durations, link/cancel waits, charge duration, facing and initial scene; extracting wiki sequences alone cannot provide those. [Raw capture lines 6151–6156](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/autorun/TrainingComboTrials_v1.0.lua#L6151-L6156), [timeline parser and demo selection lines 6340–6434](https://github.com/Wael3rd/SF6_Tools/blob/84ce6fde631ae93d4a4059d95a5865dd790be8cb/reframework/autorun/TrainingComboTrials_v1.0.lua#L6340-L6434).

## Remaining work / minimal in-game evidence

1. Offline: curate wiki routes, map notation against upstream character catalogs, set correct cumulative hits and starting resource/counter/corner conditions. Mark timing and hit counts whose source is incomplete.
2. In game: one representative successful recording first validates current patch/mod compatibility and exported metadata. Then one successful run of each selected route verifies it actually combos and captures measured delays, cumulative hits, positions/resources and demo inputs in one pass. No need to reverse-engineer all move IDs first.
3. Test wrong strength, dropped links and required counter/corner/resource conditions for the relevant route types; notation fallback's permissiveness is not proof that a trial enforces every constraint.
4. Unresolved without game access: current patch correctness of each route, live action variants, scene/resource initialization coverage for special characters, actual hitstop-adjusted delays and reliable demos. Static source evidence supports generation; it does not prove a generated pack works.

## SuperCombo freshness and existing local data (2026-09-11)

The live browser page and latest-revision diff for [Ryu/Combos](https://wiki.supercombo.gg/index.php?title=Street_Fighter_6/Ryu/Combos&diff=) both identify the latest direct revision as **2025-06-08 06:17**. This is specific to that page, not evidence the wiki or game stopped receiving updates. [Ryu/Data](https://wiki.supercombo.gg/w/Street_Fighter_6/Ryu/Data) instead reports **2026-09-09 08:27**. [Ken/Combos](https://wiki.supercombo.gg/w/Street_Fighter_6/Ken/Combos) reports **2024-12-09 02:29**. Combo guide and frame-data freshness must be tracked separately. A recent page edit alone does not verify every combo against a patch.

The web fetch tool received 403/Anubis errors; normal in-app browser navigation successfully displayed the pages, including the Ryu latest-revision diff. No challenge was manually solved.

This repository already has [24 fighters' live dumps](../../data/raw/mmdk/source.json), collected 2026-08-19 from the 2026-08-03 game build on colepc. [ADR-0045](../adr/0045-the-dump-is-the-live-game-now.md) documents provenance and differences against the older upstream snapshot. [Ryu Names.json](../../data/raw/mmdk/Ryu/Names.json) corroborates normal-action variants 600–602 and 622–624 and heavy Shoryuken startup action 934. These are a useful independent source for action/command/cancel/hit data, but do not establish September patch compatibility. The newer fighters missing from these local dumps have upstream command-display profiles, so local dump coverage is not the same as trial-authoring coverage.

## Proposed pack scope

Classic controls; roughly five routes per character: light confirm, meterless midscreen, low starter into Drive Rush (where appropriate), blocked-reversal punish, simple corner route. Favor common conditions and consistent execution; annotate resource/stance/spacing requirements. Keep super extensions optional. Store source revision and verification status per route. First generate a small representative set and check live validation before expanding to the roster; demonstration playback is a separate deliverable until timed inputs exist.
