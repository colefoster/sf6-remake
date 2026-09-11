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
