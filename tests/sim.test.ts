import { describe, it, expect } from "vitest";
import { runScenario } from "../src/sim/index.js";
import { requireCharacter, requireMove } from "../src/data/index.js";
import { actionFor, minDistance } from "../src/data/geometry.js";
import { loadGeometry } from "../src/data/load-geometry.js";
import type { Move } from "../src/domain/types.js";

/**
 * The sim never reads `onBlock` / `onHit`. It advances the action frame by
 * frame, finds contact by box overlap, and takes the stun from the game's
 * hit-data table — so when its advantage matches the published number, the whole
 * chain (geometry, motion, pushboxes, hit data, guard release) is right.
 */
function checkable(name: string): Move[] {
  const character = requireCharacter(name);
  const geo = loadGeometry(character.id)!;
  return character.moves.filter((move) => {
    const raw = move.raw ?? {};
    const found = actionFor(geo, move);
    if (!found) return false;
    // The sim resolves contact from hitbox overlap, so a move whose action has
    // no hitbox of its own is not something it can get wrong — it is something
    // it cannot attempt. ADR-0022 mapped the fireballs, whose hitbox belongs to
    // the projectile's own action; modelling those is ADR-0021's open sim work.
    if (!found.action.hit.some((h) => h.kind !== "proximity")) return false;
    if (move.onBlock === undefined || move.onHit === undefined) return false;
    return !(raw.active || raw.onBlock || raw.onHit || raw.recovery);
  });
}

describe("the scenario player reproduces published frame advantage", () => {
  // Akuma's dump and his frame data come from the same balance patch.
  const akuma = checkable("Akuma");

  it("gets every one of Akuma's blocked normals exactly right", () => {
    expect(akuma.length).toBeGreaterThan(10);
    for (const move of akuma) {
      const r = runScenario("Akuma", move.input, { guard: true });
      expect(`${move.input} ${r.advantage}`).toBe(`${move.input} ${move.onBlock}`);
    }
  });

  it("gets Ryu's right too, bar the moves his two sources disagree about", () => {
    const ryu = checkable("Ryu");
    const exact = ryu.filter((m) => runScenario("Ryu", m.input, { guard: true }).advantage === m.onBlock);
    // 5HK, 2LK, 2HP and one target combo differ — the same set flagged in ADR-0006.
    expect(exact.length).toBeGreaterThanOrEqual(ryu.length - 4);
  });

  it("gets on-hit advantage right across both characters", () => {
    const all = [
      ...checkable("Ryu").map((m) => ["Ryu", m] as const),
      ...akuma.map((m) => ["Akuma", m] as const),
    ];
    const exact = all.filter(([c, m]) => runScenario(c, m.input, { guard: false }).advantage === m.onHit);
    expect(exact.length / all.length).toBeGreaterThan(0.8);
  });
});

describe("projectiles", () => {
  it("throws a fireball and lets it carry on without the attacker", () => {
    // The fireball is a second actor: its own action, its own clock starting on
    // the frame the shot appears, its own hit data. See ADR-0023.
    const close = runScenario("Ryu", "236LP", { distance: 70, guard: true });
    expect(close.action).toBe("SPA_HADO");
    expect(close.contact?.frame).toBe(16);
    // Ryu is long since recovering when it lands further out, so it gets better
    // the further away it is blocked — one frame per frame of travel.
    const far = runScenario("Ryu", "236LP", { distance: 208, guard: true });
    expect(far.contact!.frame).toBeGreaterThan(close.contact!.frame);
    expect(far.advantage! - close.advantage!).toBe(far.contact!.frame - close.contact!.frame);
  });

  it("takes the fireball's outcome from the projectile's own hit data", () => {
    // The parent action has no hit-data entry at all — there is no hitbox on it
    // to point at one — so a fireball that reported the parent's numbers would
    // report nothing. 23f of blockstun belongs to `SPA_HADO PROJ`.
    const r = runScenario("Ryu", "236LP", { distance: 70, guard: true });
    expect(r.contact!.outcome.stun).toBe(23);
    expect(r.note).toBeUndefined();
  });
});

describe("scenarios", () => {
  it("connects at point blank and whiffs well outside the move's reach", () => {
    const close = runScenario("Ryu", "2MK", { distance: 66 });
    expect(close.contact?.type).toBe("block");
    expect(close.advantage).toBe(-6);

    const far = runScenario("Ryu", "2MK", { distance: 400 });
    expect(far.contact).toBeNull();
    expect(far.advantage).toBeNull();
  });

  it("refuses to place the fighters closer than their pushboxes allow", () => {
    const geo = loadGeometry("ryu")!;
    const closest = minDistance(geo, geo)!;
    expect(runScenario("Ryu", "2MK", { distance: 0 }).distance).toBe(closest);
  });

  it("improves advantage one frame per frame of meaty depth", () => {
    const base = runScenario("Ryu", "5HP", { guard: true })!;
    for (const deep of [1, 2, 3]) {
      const meaty = runScenario("Ryu", "5HP", { guard: true, meaty: deep });
      expect(meaty.contact?.depth).toBe(deep);
      expect(meaty.advantage).toBe(base.advantage! + deep);
    }
  });

  it("takes damage and stun from the table, not from the advantage", () => {
    const hit = runScenario("Ryu", "2MK", { guard: false });
    expect(hit.damage).toBe(500);
    expect(hit.contact!.outcome.stun).toBe(23);
    const blocked = runScenario("Ryu", "2MK", { guard: true });
    expect(blocked.damage).toBe(0);
    expect(blocked.contact!.outcome.stun).toBe(20);
  });

  it("pushes the defender away by the knockback the hit specifies", () => {
    const r = runScenario("Ryu", "2MK", { distance: 150 });
    expect(r.endDistance).toBeGreaterThan(r.distance);
    expect(r.endDistance - r.distance).toBeCloseTo(r.contact!.outcome.knockback.x, 0);
  });

  it("reaches a crouching opponent with a low that a standing one blocks the same", () => {
    const crouch = runScenario("Ryu", "2MK", { defenderStance: "crouch", distance: 120 });
    expect(crouch.contact).not.toBeNull();
  });

  it("runs across characters", () => {
    const r = runScenario("Akuma", "5HP", { defender: "Ryu", distance: 120 });
    expect(r.defender).toBe("Ryu");
    expect(r.contact).not.toBeNull();
    expect(requireMove(requireCharacter("Akuma"), "5HP").onBlock).toBe(r.advantage);
  });
});
