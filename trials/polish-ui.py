"""Apply the local presentation patch to an SF6 Tools v3.0.1 staging directory.

Usage: python3 trials/polish-ui.py INPUT_GAME_ROOT OUTPUT_GAME_ROOT
Does not install files or change trial validation, recordings, or game hooks.
"""
import pathlib
import sys

source, output = map(pathlib.Path, sys.argv[1:])
changes = {}


def edit(relative, old, new, count=1):
    text = changes.get(relative)
    if text is None:
        text = (source / relative).read_text()
    if text.count(old) != count:
        raise ValueError(f"Upstream changed: {relative}: expected {count} occurrences of {old!r}")
    changes[relative] = text.replace(old, new)


ui = 'reframework/autorun/func/ComboTrials_UI.lua'
shared = 'reframework/autorun/func/Training_SharedUI.lua'
d2d = 'reframework/autorun/func/ComboTrials_D2D.lua'
main = 'reframework/autorun/TrainingComboTrials_v1.0.lua'
manager = 'reframework/autorun/Training_ScriptManager.lua'

# Keep raw filenames and selection indices intact; improve display labels only.
edit(ui, 'local function combo_openable(', '''local function readable_trial_name(value)
    return (tostring(value or "Select a combo"):gsub("%.json$", ""):gsub("_", " "))
end

local function combo_openable(''')
edit(ui, 'local preview = (items and items[current_idx]) or "---"',
     'local preview = readable_trial_name((items and items[current_idx]) or "Select a combo")')
edit(ui, 'local item_label = items[i]', 'local item_label = readable_trial_name(items[i])')
for old, new in [('STOP & SAVE', 'Save recording'), ('CANCEL', 'Cancel'),
                 ('RECORD P1', 'Record P1'), ('RECORD P2', 'Record P2'),
                 ('RESTART DEMO', 'Replay demo'), ('QUIT DEMO', 'Close demo'),
                 ('RESET', 'Retry'), ('RECORD', 'Record'), ('STOP TRIAL', 'Stop'),
                 ('DEMO', 'Demo'), ('START TRIAL', 'Start'),
                 ('START TRIAL P1', 'Start P1'), ('STOP TRIAL P1', 'Stop P1'),
                 ('START TRIAL P2', 'Start P2'), ('STOP TRIAL P2', 'Stop P2'),
                 ('ANY POSITION', 'Free position'), ('EXACT POSITION', 'Reset position'),
                 ('MIRROR POSITION', 'Swap sides'), ('NO RESET', 'No reset')]:
    # Only the English dictionary value, never actions or input bindings.
    edit(ui, '= "' + old + '"', '= "' + new + '"')

edit(ui, 'local function P1_COLORS()     return get_sc("c1") end', '''local QUIET_BUTTON = { text = 0xFF655D6E, base = 0xFF372E3D, hover = 0xFF504357, active = 0xFF665770, border = 0xFFF7F3F8 }
local PRACTICE_BUTTON = { text = 0xFFD8AFAF, base = 0xFF70523E, hover = 0xFF916C52, active = 0xFFAA8164, border = 0xFFFFFFFF }
local function P1_COLORS()     return QUIET_BUTTON end''')
edit(ui, 'local function TRIAL_COLORS()  return get_sc("c2") end', 'local function TRIAL_COLORS()  return PRACTICE_BUTTON end')
edit(ui, 'local function SWITCH_COLORS() return get_sc("c4") end', 'local function SWITCH_COLORS() return QUIET_BUTTON end')
edit(ui, 'local target_w = sw * d2d_cfg.bar_width_pct',
     'local target_w = math.min(sw * d2d_cfg.bar_width_pct, 1180 * (sh / 1080.0))')
edit(ui, 'local pad_x = sw * 0.01', 'local pad_x = 16 * (sh / 1080.0)')
edit(ui, 'local sp = 4 * (sh / 1080.0)', 'local sp = 8 * (sh / 1080.0)')
edit(ui, 'imgui.push_style_color(2, 0xFC800024)', 'imgui.push_style_color(2, 0xFC251D29)')
edit(ui, 'imgui.push_style_color(5, 0xFFEF51EF)', 'imgui.push_style_color(5, 0xFF655D6E)')
edit(ui, 'line1 = "!!! SUCCESS !!!"; col1 = 0xFF00FF00', 'line1 = "Combo complete"; col1 = 0xFFACDFC0')
edit(ui, 'string.format("[ ACTION %d / %d ]", current, total_steps)', 'string.format("Step %d of %d", current, total_steps)')
edit(ui, 'col1 = 0xFF00FFFF -- Yellow by default', 'col1 = 0xFFF7F3F8 -- Neutral progress; color is reserved for outcomes.')

for target in [ui, shared]:
    edit(target, 'i18n.font("SF6_college.ttf")', 'i18n.font("capcom_goji-udkakugoc80pro-db.ttf")')
edit(shared, 'local BAR_BG     = 0xFC800024', 'local BAR_BG     = 0xFC251D29')
edit(shared, 'local BAR_BORDER = 0xFFEF51EF', 'local BAR_BORDER = 0xFF655D6E')

# Opaque, restrained fills keep white control labels readable over the game.
old = '''    return {
        text   = abgr,
        base   = (0xFF << 24) | rgb,
        hover  = (0xFF << 24) | rgb,
        active = (0xFF << 24) | rgb,
        border = 0xFFFFFFFF,
    }'''
new = '''    local function fill(amount)
        local r = math.floor((rgb & 255) * amount + 24)
        local g = math.floor(((rgb >> 8) & 255) * amount + 20)
        local b = math.floor(((rgb >> 16) & 255) * amount + 29)
        return 0xFF000000 | (b << 16) | (g << 8) | r
    end
    return {
        text = abgr, base = fill(0.24), hover = fill(0.36),
        active = fill(0.44), border = 0xFFF7F3F8,
    }'''
edit(manager, old, new)

# Use the renderer's existing flat-color fallback, preserving arrow/button icons.
for name in ['done', 'active', 'fail', 'success']:
    edit(d2d, f'assets.imgs["{name}_bar"] = d2d.Image.new("{name}-bar.png")',
         f'assets.imgs["{name}_bar"] = nil -- Quiet practice skin uses the flat-color fallback.')
edit(d2d, 'R.fill_rect(final_rect_x, sy, cartouche_w, 3, li_c)', 'R.fill_rect(final_rect_x, sy, cartouche_w, 1, li_c)')
edit(d2d, 'R.fill_rect(final_rect_x, sy + active_bg_h - 3, cartouche_w, 3, li_c)',
     'R.fill_rect(final_rect_x, sy + active_bg_h - 1, cartouche_w, 1, li_c)')
edit(d2d, 'bg_c = 0x80004400; li_c = 0xFF00FF00', 'bg_c = 0xED20382C; li_c = 0xFF8ECDA8')

# Apply the visual preset once on reload; later user layout edits remain saved.
edit(main, '\nload_d2d_config()\n', '''
load_d2d_config()
if d2d_cfg.cole_ui_revision ~= 1 then
    d2d_cfg.cole_ui_revision = 1
    d2d_cfg.font_size = 0.020
    d2d_cfg.icon_size = 0.027
    d2d_cfg.spacing_y = 0.044
    d2d_cfg.cartouche_width = 0.20
    d2d_cfg.cartouche_height = 0.90
    d2d_cfg.arrow_size = 0.040
    d2d_cfg.trial_visible_steps = 8
    d2d_cfg.show_live_single_p2 = false
    d2d_cfg.colors.bg_active = 0xED342A3D
    d2d_cfg.colors.bg_active_line = 0xFFB7A3CF
    d2d_cfg.colors.bg_success = 0xED20382C
    d2d_cfg.colors.bg_success_line = 0xFF8ECDA8
    d2d_cfg.colors.bg_fail = 0xED482A30
    d2d_cfg.colors.bg_fail_line = 0xFFE9A0AA
    d2d_cfg.colors.text_normal = 0xFFF7F3F8
    d2d_cfg.colors.text_dark = 0xFFD0C7D8
    save_d2d_config()
end
''')

for relative, text in changes.items():
    target = output / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)
print(f'Prepared {len(changes)} UI files under {output}')
