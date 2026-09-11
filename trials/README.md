# Classic BnB trials — initial live test

Installed on colepc in `Street Fighter 6/reframework/data/TrainingComboTrials_data/CustomCombos/Ryu/` using SF6 Tools v3.0.1 trial + manager components and D2D. Existing REFramework loader and MMDK were preserved. Install archive is `/tmp/sf6-bnb-install.zip` on the Mac and `C:\Users\cole\sf6-bnb-install.zip` on colepc. Installer backs up any colliding files under a timestamped `sf6-bnb-backup-*` directory in the Windows user profile.

These are **candidates awaiting live validation**, not a finished roster pack. Hit counts and IDs were checked against the local August dump and upstream command catalog; timing values are estimates for timeout/feedback, not recorded measurements. No demo inputs included.

1. Boot SF6 fresh (the newly added D2D DLL loads at startup).
2. Enter Training as Ryu, Classic, full HP, close to a standing dummy.
3. Press Insert for REFramework; select Custom Combo Trials in the Training Script Manager (keyboard 0 cycles modes).
4. Select `BnB_01_Light_confirm` in the P1 combo dropdown. Start with the UI play button or keyboard 2.
5. Perform crouching LK, crouching LP, standing LP cancelled into heavy Shoryuken.

Other candidates: standing MP → crouching MP → heavy Shoryuken; punish-counter standing HK → crouching HP → heavy Shoryuken. The trial sets the punish-counter condition for the latter. Start close; recording exact positions and timings comes after the first successful live runs.

Source: [SuperCombo Ryu combos](https://wiki.supercombo.gg/w/Street_Fighter_6/Ryu/Combos). Technical research: [trial format](../docs/research/sf6-bnb-trials.md).

## Local UI polish

`polish-ui.py INPUT_GAME_ROOT OUTPUT_GAME_ROOT` produces five presentation-only
patched Lua files from the installed v3.0.1 sources. It rejects changed upstream
anchors before writing output. The trial toolbar is capped at 1180 pixels at
1080p (scales with height), uses the existing readable Capcom font, formats
filenames only for display, and reserves stronger color for the practice action.
Flat step highlights replace textured banners; input icons remain. A versioned
visual preset applies once, preserving later user layout edits. No validation,
input bindings, action IDs, game hooks, or animation logic is changed.

The five patched files passed Lua 5.4 parsing before deployment. The installer
checks original SHA-256 hashes before copying and verifies patched hashes after.
Original files are backed up under `C:\Users\cole\sf6-ui-backup-*`, preserving
their relative paths. Copy those files back to the SF6 root to undo code changes;
the one-time visual preset remains editable in the overlay settings.

Activate in REFramework: **ScriptRunner → Reset scripts** (or restart SF6).
Native rendering and controller interaction still need confirmation on colepc;
syntax and installation checks are not a visual verification.
