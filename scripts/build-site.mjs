/**
 * Builds web/<char>.json (per-normal, per-hit-state follow-up options) and
 * downloads the move stills from the Supercombo wiki into web/assets/<char>/.
 *
 *   node scripts/build-site.mjs            # every character already built
 *   node scripts/build-site.mjs Ryu Akuma  # specific characters
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
const WIKI_API = "https://wiki.supercombo.gg/api.php";
const UA = "sf6-remake normals-followups (personal, non-commercial)";

const raw = JSON.parse(await readFile(path.join(root, "data/raw/SF6FrameData.json"), "utf8"));

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

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

/** Cancel-target names, collapsed to one entry per move family. */
function familyNames(moves) {
  const seen = new Map();
  for (const m of moves) {
    const name = m.moveName ?? "";
    // "LP Gou Hadoken" / "OD Gou Hadoken" / "Aerial Tatsumaki" -> "Gou Hadoken".
    let family = name.replace(/\s*\(.*\)$/, "").trim();
    let prev;
    do {
      prev = family;
      family = family.replace(/^(OD |Aerial |Air |Denjin Charge |[LMH][PK] )/, "").trim();
    } while (family !== prev);
    if (!family || family.includes(">")) continue;
    if (!seen.has(family)) seen.set(family, family);
  }
  return [...seen.values()];
}

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

/** Supercombo file names: numpad input, lowercased, air moves prefixed "j". */
function imageKey(numCmd) {
  let cmd = numCmd;
  if (/\(air\)/i.test(cmd)) cmd = "j" + cmd.replace(/\s*\(air\)/i, "");
  cmd = cmd.replace(/^9\s*>\s*/, "j").replace(/^8/, "j");
  return cmd
    .toLowerCase()
    .replace(/\s*>\s*/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

async function wikiImages(charName) {
  // Wiki page names use underscores and keep the dots of "A.K.I." / "C.Viper".
  const prefix = `SF6_${charName.replace(/\s+/g, "_")}`;
  const url = `${WIKI_API}?action=query&list=allimages&aiprefix=${encodeURIComponent(prefix)}&ailimit=500&format=json`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const json = await res.json();
  const map = new Map();
  for (const img of json.query?.allimages ?? []) map.set(img.name, img.url);
  return { map, prefix };
}

function pickImage(map, prefix, key) {
  for (const c of [`${prefix}_${key}.png`, `${prefix}_${key}_1.png`]) {
    if (map.has(c)) return map.get(c);
  }
  // Target combos and throws use looser names ("hp_hk", "5mp_lk_hk", "lplk").
  for (const [name, url] of map) {
    if (name.includes("hitbox") || name.includes("_preview")) continue;
    const stem = name.replace(`${prefix}_`, "").replace(/\.png$/, "");
    if (stem === key || stem.endsWith(`_${key}`) || key.endsWith(stem)) return url;
  }
  return null;
}

async function download(url, dest) {
  if (existsSync(dest)) return true;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return false;
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function buildCharacter(charName) {
  const entry = raw[charName];
  if (!entry) throw new Error(`no frame data for "${charName}"`);
  const id = slug(charName);
  const assetDir = path.join(OUT_DIR, "assets", id);
  await mkdir(assetDir, { recursive: true });

  const all = Object.values(entry.moves.normal);
  const normals = all.filter((m) => m.moveType === "normal");
  const specials = all.filter((m) => m.moveType === "special" && m.dmg);
  const supers = all.filter((m) => m.moveType === "super");
  const targetCombos = normals.filter((m) => m.numCmd.includes(">"));

  // A grounded normal can only cancel into grounded specials, and vice versa;
  // follow-ups ("214LP > 6P") are reached from the special, not from a normal.
  const isAir = (m) => /\(air\)/i.test(m.numCmd);
  const isFollowUp = (m) => m.numCmd.includes(">");
  const groundSpecials = familyNames(specials.filter((m) => !isAir(m) && !isFollowUp(m)));
  const airSpecials = familyNames(specials.filter((m) => isAir(m) && !isFollowUp(m)));
  const cleanSupers = (list) => familyNames(list).filter((n) => !/Critical Art/i.test(n));
  const groundSupers = cleanSupers(
    supers.filter((m) => !isAir(m) && !isFollowUp(m) && !/\(CA\)/i.test(m.numCmd)),
  );
  const airSupers = cleanSupers(supers.filter((m) => isAir(m) && !isFollowUp(m)));

  /** Grounded, non-follow-up normals — the pool for link checks. */
  const linkPool = normals
    .filter((m) => !/^[89]/.test(m.numCmd) && !m.numCmd.includes(">") && int(m.startup) !== undefined)
    .map((m) => ({
      name: m.moveName,
      input: m.numCmd,
      startup: int(m.startup),
      dmg: int(m.dmg) ?? 0,
    }))
    .sort((a, b) => a.startup - b.startup);

  function cancelTargets(move) {
    const out = [];
    const air = /^[89]/.test(move.numCmd) || /\(air\)/i.test(move.numCmd);
    const specialNames = air ? airSpecials : groundSpecials;
    const superNames = air ? airSupers : groundSupers;
    for (const tag of move.xx ?? []) {
      if (tag === "ch") {
        const chains = linkPool.filter((m) => m.startup <= 5 && /^[25][LM][PK]$/.test(m.input));
        out.push({ label: "Chain", into: chains.map((c) => c.input) });
      } else if (tag === "sp") {
        out.push({ label: "Special cancel", into: specialNames });
      } else if (tag === "tc") {
        const follow = targetCombos
          .filter((t) => t.numCmd.startsWith(`${move.numCmd} >`))
          .map((t) => `${t.numCmd.split(">").pop().trim()} (${t.moveName})`);
        if (follow.length) out.push({ label: "Target combo", into: follow });
      } else if (tag === "su" || /^su\d?$/.test(tag)) {
        const lvl = tag.match(/\d/)?.[0];
        out.push({ label: lvl ? `Super cancel (SA${lvl}+)` : "Super cancel", into: superNames });
      }
    }
    return out;
  }

  function links(adv, selfInput) {
    if (adv === undefined) return [];
    return linkPool
      .filter((m) => m.startup <= adv && m.input !== selfInput)
      .map((m) => ({ ...m, slack: adv - m.startup }));
  }

  function buildStates(m) {
    return STATES.map((st) => {
      const rawVal = st.key === "ch" ? m.onHit : m[st.src];
      let adv, derived = false;
      const plain = isPlain(rawVal);
      if (st.key === "ch") {
        // CH = normal hit + 2 frames of extra hitstun.
        if (plain) {
          adv = int(rawVal) + 2;
          derived = true;
        }
      } else if (plain) {
        adv = int(rawVal);
      }
      const reaction = reactionOf(typeof rawVal === "string" ? rawVal : undefined);
      return {
        state: st.key,
        label: st.label,
        advantage: adv ?? null,
        derived,
        raw: rawVal === null || rawVal === undefined ? null : String(rawVal),
        reaction: reaction ?? null,
        oki: !plain && reaction ? int(rawVal) ?? null : null,
        links: st.key === "block" ? [] : links(adv, m.numCmd),
        punish: st.key === "block" ? punishNote(adv) : null,
      };
    });
  }

  const { map, prefix } = await wikiImages(charName);
  const moves = [];
  let withArt = 0;

  for (const m of normals) {
    const key = imageKey(m.numCmd);
    const moveId = key || slug(m.moveName);
    const art = pickImage(map, prefix, key);
    const hitboxUrl = map.get(`${prefix}_${key}_hitbox.png`) ?? null;

    let image = null;
    let hitbox = null;
    if (art && (await download(art, path.join(assetDir, `${moveId}.png`)))) {
      image = `assets/${id}/${moveId}.png`;
      withArt++;
    }
    if (hitboxUrl && (await download(hitboxUrl, path.join(assetDir, `${moveId}-hitbox.png`)))) {
      hitbox = `assets/${id}/${moveId}-hitbox.png`;
    }

    moves.push({
      id: moveId,
      name: m.moveName,
      input: m.numCmd,
      startup: int(m.startup) ?? null,
      active: int(m.active) ?? null,
      recovery: int(m.recovery) ?? null,
      damage: m.dmg ?? null,
      level: m.atkLvl ?? null,
      airborne: /^[89]/.test(m.numCmd) || /\(air\)/i.test(m.numCmd),
      hitConfirmWindow: int(m.hcWinSpCa) ?? null,
      cancels: cancelTargets(m),
      cancelTags: m.xx ?? [],
      notes: m.extraInfo ?? [],
      image,
      hitbox,
      states: buildStates(m),
    });
  }

  await writeFile(
    path.join(OUT_DIR, `${id}.json`),
    JSON.stringify(
      {
        character: charName,
        id,
        health: entry.stats?.health ?? null,
        fastestNormal: entry.stats?.fastestNormal ?? null,
        specials: groundSpecials,
        supers: groundSupers,
        source: "FAT (D4RKONION/FrameDataAssistantTool) SF6FrameData.json",
        images: "wiki.supercombo.gg (CC BY-SA)",
        moves,
      },
      null,
      2,
    ),
  );
  console.log(`${charName}: ${moves.length} normals, ${withArt} with art -> web/${id}.json`);
  return { id, name: charName };
}

const requested = process.argv.slice(2);
const names = requested.length
  ? requested.map((r) => Object.keys(raw).find((k) => slug(k) === slug(r)) ?? r)
  : ["Ryu", "Akuma"];

const built = [];
for (const name of names) built.push(await buildCharacter(name));

// The page reads this to populate its character switcher.
const indexPath = path.join(OUT_DIR, "characters.json");
const existing = existsSync(indexPath) ? JSON.parse(await readFile(indexPath, "utf8")) : [];
const merged = [...existing.filter((c) => !built.some((b) => b.id === c.id)), ...built].sort((a, b) =>
  a.name.localeCompare(b.name),
);
await writeFile(indexPath, JSON.stringify(merged, null, 2));
console.log(`characters.json: ${merged.map((c) => c.name).join(", ")}`);
