/**
 * Builds web/ryu.json (per-normal, per-hit-state follow-up options) and
 * downloads the move stills from the Supercombo wiki into web/assets/.
 *
 * Counter-hit advantage is NOT in the source data: SF6 gives +2 hitstun on a
 * counter hit and +4 on a punish counter, and the data's onPC == onHit + 4
 * everywhere it is a plain number — so CH is derived as onHit + 2 and marked
 * `derived` so the page can footnote it.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(root, "web");
const ASSET_DIR = path.join(OUT_DIR, "assets");
const WIKI_API = "https://wiki.supercombo.gg/api.php";
const UA = "sf6-remake ryu-followups (personal, non-commercial)";

const raw = JSON.parse(await readFile(path.join(root, "data/raw/SF6FrameData.json"), "utf8"));
const moves = raw["Ryu"].moves.normal;
const stats = raw["Ryu"].stats;

/** First signed integer in a FAT value, or undefined. */
const int = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const m = v.match(/-?\d+/);
  return m ? Number.parseInt(m[0], 10) : undefined;
};
/** A value like "8~13" or "KD +40" isn't a plain frame advantage. */
const isPlain = (v) => typeof v === "number" || (typeof v === "string" && /^-?\d+$/.test(v.trim()));
const reactionOf = (v) => {
  if (typeof v !== "string") return undefined;
  if (/HKD/i.test(v)) return "hard knockdown";
  if (/\bKD\b/i.test(v)) return "knockdown";
  if (/Crumple/i.test(v)) return "crumple";
  if (/Tumble|Wall Bounce/i.test(v)) return "wall bounce";
  return undefined;
};

const all = Object.values(moves);
const byName = (n) => all.find((m) => m.moveName === n);

const normals = all.filter((m) => m.moveType === "normal");
const specials = all.filter((m) => m.moveType === "special" && m.dmg);
const supers = all.filter((m) => m.moveType === "super");

/** Grounded normals that can start a combo — the pool for link checks. */
const linkPool = normals
  .filter((m) => !/^8/.test(m.numCmd) && !m.numCmd.includes(">") && int(m.startup) !== undefined)
  .map((m) => ({
    name: m.moveName,
    input: m.numCmd,
    startup: int(m.startup),
    dmg: int(m.dmg) ?? 0,
    cancels: m.xx ?? [],
  }))
  .sort((a, b) => a.startup - b.startup);

const SUPER_BY_LEVEL = {
  su1: "Shinku Hadoken",
  su2: "Shin Hashogeki",
  su3: "Shin Shoryuken",
};

/** What a cancel tag buys you, as concrete move names. */
function cancelTargets(tags) {
  const out = [];
  for (const tag of tags ?? []) {
    if (tag === "ch") {
      out.push({ kind: "chain", label: "Chain", into: ["Stand LP", "Crouch LP", "Crouch LK"] });
    } else if (tag === "sp") {
      out.push({
        kind: "special",
        label: "Special cancel",
        into: ["LP/MP/HP Hadoken", "LP/MP/HP Shoryuken", "LK/MK/HK Tatsumaki", "Hashogeki", "High Blade Kick"],
      });
    } else if (tag === "su" || tag === "su1") {
      out.push({ kind: "super", label: "Super cancel", into: ["SA1 Shinku Hadoken", "SA2 Shin Hashogeki", "SA3 Shin Shoryuken"] });
    } else if (SUPER_BY_LEVEL[tag]) {
      out.push({ kind: "super", label: `Super cancel (${tag.toUpperCase()}+)`, into: [SUPER_BY_LEVEL[tag]] });
    }
  }
  return out;
}

/** Everything that links from `adv` frames of advantage. */
function links(adv, selfInput) {
  if (adv === undefined) return [];
  return linkPool
    .filter((m) => m.startup <= adv && m.input !== selfInput)
    .map((m) => ({ ...m, slack: adv - m.startup }));
}

/** What the defender gets to do when they block this. */
function punishNote(adv) {
  if (adv === undefined) return null;
  const window = -adv;
  if (window <= 0) return { window: 0, text: `You are +${adv} — your turn continues.` };
  if (window < 4) return { window, text: `Nothing punishes (${window}f window), but you lose your turn.` };
  if (window < 6) return { window, text: `Jab-punishable — a 4f button gets a Punish Counter.` };
  if (window < 9) return { window, text: `Medium-punishable (${window}f) — real damage.` };
  return { window, text: `Heavily punishable (${window}f) — full Punish Counter combo / super.` };
}

const STATES = [
  { key: "block", label: "On block", src: "onBlock" },
  { key: "hit", label: "On hit", src: "onHit" },
  { key: "ch", label: "Counter hit", src: null },
  { key: "pc", label: "Punish counter", src: "onPC" },
];

function buildStates(m) {
  const out = [];
  for (const st of STATES) {
    const rawVal = st.key === "ch" ? m.onHit : m[st.src];
    let adv, note, derived = false, plain;

    if (st.key === "ch") {
      // CH = normal hit + 2 frames of extra hitstun.
      if (isPlain(m.onHit)) {
        adv = int(m.onHit) + 2;
        derived = true;
        plain = true;
      } else {
        plain = false;
      }
    } else {
      plain = isPlain(rawVal);
      adv = plain ? int(rawVal) : undefined;
    }

    const reaction = reactionOf(typeof rawVal === "string" ? rawVal : undefined);
    const oki = !plain && reaction ? int(rawVal) : undefined;

    out.push({
      state: st.key,
      label: st.label,
      advantage: adv,
      derived,
      raw: rawVal === null || rawVal === undefined ? null : String(rawVal),
      reaction: reaction ?? null,
      oki: oki ?? null,
      links: st.key === "block" ? [] : links(adv, m.numCmd),
      punish: st.key === "block" ? punishNote(adv) : null,
    });
  }
  return out;
}

/** Supercombo file names are the numpad input, lowercased and stripped. */
function imageKey(numCmd) {
  // The wiki files jumping normals as "j" + button (jmk), not numpad (8MK).
  const cmd = numCmd.replace(/^8/, "j");
  return cmd
    .toLowerCase()
    .replace(/\s*>\s*/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

async function wikiImages() {
  const url = `${WIKI_API}?action=query&list=allimages&aiprefix=SF6_Ryu&ailimit=500&format=json`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const json = await res.json();
  const map = new Map();
  for (const img of json.query.allimages) map.set(img.name, img.url);
  return map;
}

function pickImage(map, numCmd) {
  const key = imageKey(numCmd);
  const candidates = [`SF6_Ryu_${key}.png`, `SF6_Ryu_${key}_1.png`];
  for (const c of candidates) if (map.has(c)) return { name: c, url: map.get(c) };
  // Target combos and throws use looser names ("hp_hk", "5mp_lk_hk", "lplk").
  for (const [name, url] of map) {
    if (name.includes("hitbox") || name.includes("_preview")) continue;
    const stem = name.replace(/^SF6_Ryu_/, "").replace(/\.png$/, "");
    if (stem === key || stem.endsWith(`_${key}`) || key.endsWith(stem)) return { name, url };
  }
  return null;
}

await mkdir(ASSET_DIR, { recursive: true });
const images = await wikiImages();

const out = [];
for (const m of normals) {
  const id = imageKey(m.numCmd) || m.moveName.toLowerCase().replace(/\W+/g, "-");
  const pick = pickImage(images, m.numCmd);
  const hitboxPick = images.has(`SF6_Ryu_${imageKey(m.numCmd)}_hitbox.png`)
    ? { name: `SF6_Ryu_${imageKey(m.numCmd)}_hitbox.png`, url: images.get(`SF6_Ryu_${imageKey(m.numCmd)}_hitbox.png`) }
    : null;

  for (const [suffix, p] of [["", pick], ["-hitbox", hitboxPick]]) {
    if (!p) continue;
    const dest = path.join(ASSET_DIR, `${id}${suffix}.png`);
    if (existsSync(dest)) continue;
    const res = await fetch(p.url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      console.warn(`  ! ${p.name} -> HTTP ${res.status}`);
      continue;
    }
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`  downloaded ${id}${suffix}.png`);
  }

  out.push({
    id,
    name: m.moveName,
    input: m.numCmd,
    startup: int(m.startup) ?? null,
    active: int(m.active) ?? null,
    recovery: int(m.recovery) ?? null,
    total: int(m.total) ?? null,
    damage: m.dmg ?? null,
    level: m.atkLvl ?? null,
    airborne: /^8/.test(m.numCmd),
    hitConfirmWindow: int(m.hcWinSpCa) ?? null,
    cancels: cancelTargets(m.xx),
    cancelTags: m.xx ?? [],
    notes: m.extraInfo ?? [],
    image: pick ? `assets/${id}.png` : null,
    hitbox: hitboxPick ? `assets/${id}-hitbox.png` : null,
    states: buildStates(m),
  });
}

await writeFile(
  path.join(OUT_DIR, "ryu.json"),
  JSON.stringify(
    {
      character: "Ryu",
      health: stats.health,
      fastestNormal: stats.fastestNormal,
      source: "FAT (D4RKONION/FrameDataAssistantTool) SF6FrameData.json",
      images: "wiki.supercombo.gg (CC BY-SA)",
      moves: out,
    },
    null,
    2,
  ),
);
console.log(`\nwrote web/ryu.json — ${out.length} normals`);
