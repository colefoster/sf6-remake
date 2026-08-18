/**
 * Downloads MMDK's committed fighter dumps into data/raw/mmdk/<Char>/.
 *
 *   node scripts/fetch-mmdk.mjs            # Ryu Akuma
 *   node scripts/fetch-mmdk.mjs Ken Cammy
 *
 * MMDK (alphazolam/MMDK) is a REFramework moveset-modding kit for SF6. It ships
 * per-fighter JSON dumps of the game's own CharacterAsset data — including the
 * collision rect tables and every action's per-frame collision keys. That is the
 * only public machine-readable source of SF6 box geometry; see
 * docs/adr/0003-hitbox-geometry-deferred.md.
 *
 * The dumps are big (Ryu's moves_dict alone is 8.6 MB) and are raw upstream
 * data, so they stay gitignored. `extract-geometry.mjs` turns them into the
 * small committed artifact.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "data/raw/mmdk");
const REPO = "alphazolam/MMDK";
const DUMP_DIR = "MMDK/reframework/data/MMDK/PlayerData";
/**
 * Only the files we actually parse. `tgroups` is the cancel lists and is tiny
 * (16 KB); `triggers` (845 KB) and `commands` (445 KB) hold the input side —
 * buffer lengths, meter costs, motion inputs — and stay unfetched until
 * something needs them. See docs/adr/0008.
 */
const FILES = ["rects", "moves_dict", "char_info", "Names", "HIT_DT", "tgroups"];

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function api(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "sf6-remake geometry (personal, non-commercial)" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

/** Pin every fetch to one commit so a re-run reproduces the same dump. */
async function headSha() {
  const json = await (await api(`https://api.github.com/repos/${REPO}/commits?per_page=1`)).json();
  return json[0].sha;
}

/** MMDK's folder names ("E Honda", "AKI") differ from FAT's ("E.Honda", "A.K.I."). */
async function dumpDirs(sha) {
  const json = await (
    await api(`https://api.github.com/repos/${REPO}/contents/${DUMP_DIR}?ref=${sha}`)
  ).json();
  return new Map(json.filter((e) => e.type === "dir").map((e) => [norm(e.name), e.name]));
}

async function fetchCharacter(name, dirs, sha) {
  const dir = dirs.get(norm(name));
  if (!dir) throw new Error(`MMDK has no dump for "${name}" (has: ${[...dirs.values()].join(", ")})`);
  const destDir = path.join(OUT, dir);
  await mkdir(destDir, { recursive: true });

  for (const file of FILES) {
    const dest = path.join(destDir, `${file}.json`);
    if (existsSync(dest)) continue;
    const url =
      `https://raw.githubusercontent.com/${REPO}/${sha}/${DUMP_DIR}/` +
      `${encodeURIComponent(dir)}/${encodeURIComponent(`${dir} ${file}.json`)}`;
    const res = await api(url);
    const body = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, body);
    console.log(`  ${dir}/${file}.json  ${(body.length / 1024).toFixed(0)} KB`);
  }
  return dir;
}

const names = process.argv.slice(2).filter((a) => a !== "--refresh");
const wanted = names.length ? names : ["Ryu", "Akuma"];

// Stay on the commit the existing dumps came from, so adding a character later
// can't silently mix two upstream revisions under one recorded sha.
const stampPath = path.join(OUT, "source.json");
const prev = existsSync(stampPath) ? JSON.parse(await readFile(stampPath, "utf8")) : {};
const sha = process.argv.includes("--refresh") || !prev.commit ? await headSha() : prev.commit;
const dirs = await dumpDirs(sha);
console.log(`MMDK @ ${sha.slice(0, 8)}`);

const fetched = [];
for (const name of wanted) fetched.push(await fetchCharacter(name, dirs, sha));

// Provenance: the extractor copies this into its output so a stale dump is visible.
await writeFile(
  stampPath,
  JSON.stringify(
    { repo: REPO, commit: sha, characters: [...new Set([...(prev.characters ?? []), ...fetched])].sort() },
    null,
    2,
  ),
);
console.log(`data/raw/mmdk: ${fetched.join(", ")}`);
