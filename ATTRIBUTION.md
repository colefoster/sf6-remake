# Attribution and licensing

This project is **unofficial**. It is not affiliated with, endorsed by, or sponsored by
Capcom Co., Ltd. *Street Fighter* and all character and move names are trademarks of Capcom.
Nothing here is offered commercially.

## Why this repository is GPL-3.0

`data/raw/SF6FrameData.json` is vendored verbatim from **[D4RKONION/FAT](https://github.com/D4RKONION/FAT)**,
the community Frame Assistant Tool, which is licensed **GNU General Public License v3.0**.
Because that data ships inside this repository, this repository is GPL-3.0 as a whole. It is
not MIT, and it cannot be relicensed while the data stays vendored.

If you want a permissively licensed fork, remove `data/raw/SF6FrameData.json` from the tree
*and from history*, and fetch it at build time instead.

## Third-party sources

| Source | Used for | Licence / terms |
|---|---|---|
| [D4RKONION/FAT](https://github.com/D4RKONION/FAT) | `data/raw/SF6FrameData.json` — frame data for all 30 characters | GPL-3.0 |
| [MMDK](https://github.com/WistfulHopes/MMDK) | Tooling used to produce `data/geometry/` from Capcom's `CharacterAsset` data | See upstream |
| [Supercombo Wiki](https://wiki.supercombo.gg/) | Move stills and hitbox images downloaded by `scripts/build-site.mjs` | Wiki terms; images are **not** committed to this repository |

## `data/geometry/` is not redistributed

These files are derived from dumps of Capcom's own in-game `CharacterAsset` data, extracted
with MMDK. That is a step further than published frame data, which is closer to fact than to
creative work — so it is not committed to this repository and not in its history.

Generate it locally with `npm run geometry`, which fetches the MMDK dumps and extracts the
per-frame geometry. `data/raw/mmdk/`, `data/raw/mmdk-2024/` and `data/geometry/`
are all gitignored.

## Frame data and facts

Frame values are measurements of observable game behaviour. Character names, move names, and
associated marks are Capcom's. This repository treats the numbers as reference material for
players, in the same posture as every other community frame-data tool.
