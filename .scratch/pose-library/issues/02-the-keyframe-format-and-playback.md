# 02 — The keyframe format and playback

Status: ready-for-human
Blocked by: 01

Implement the format and the resolver in the spec: `data/poses/<char>/<move>.json`,
anchors resolved against the action's own frame data, seven normalised points,
joints re-solved by the existing `jointOf`.

Ship **one** hand-written move — Ryu 2MK — to prove the loop end to end. It does
not have to look good; it has to prove that an authored key lands on the frame
the anchor names, that `contact` is exact, and that the figure scales by stature.

**Constraints**

- Additive only. `poseOf` and today's derived figure are untouched; this is a
  second path into the same `Pose`.
- Every limb comes out `derived: false`. Add a test pinning that an authored pose
  can never report derived geometry.
- `npm run pose:audit` and `npm run pose:motion` must be unchanged — they grade
  the derived figure and must not start seeing this one.
- Any `src/game/render.ts` change needs `node scripts/build-play.mjs`.

**Deliverable:** the resolver, `data/poses/ryu/2MK.json`, tests, and an ADR.
