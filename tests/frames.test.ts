import { describe, it, expect } from "vitest";
import { totalFrames, stunFrom, advantage, maxMeatyDepth, signOf } from "../src/engine/frames.js";
import type { Move } from "../src/domain/types.js";

/** Ryu 5MP, real FAT numbers — used to calibrate the stun identity. */
const ryu5mp: Move = {
  id: "5mp",
  name: "Stand MP",
  input: "5MP",
  category: "normal",
  startup: 6,
  active: 4,
  recovery: 11,
  onBlock: -1,
  onHit: 7,
};

describe("totalFrames", () => {
  it("does not count the first active frame twice", () => {
    // 6 + 4 + 11 is 21, but startup already counts frame 6, so 5MP occupies 20.
    // Both outside sources agree: FAT publishes total 20 and the game stores
    // MarginFrame 20. The old assertion here was 21 — see ADR-0010.
    expect(totalFrames(ryu5mp)).toBe(20);
  });
});

describe("stunFrom (fallback derivation)", () => {
  // Both numbers are the game's own, out of MMDK's hit-data table for action
  // ATK_5MP — not derived, so they keep the identity honest.
  it("matches the game's blockstun for Ryu 5MP (18)", () => {
    expect(stunFrom(ryu5mp, "block")).toBe(18);
  });
  it("matches the game's hitstun for Ryu 5MP (22)", () => {
    expect(stunFrom(ryu5mp, "hit")).toBe(22);
  });
  it("is undefined when advantage is missing", () => {
    const { onBlock: _omit, ...noBlock } = ryu5mp;
    expect(stunFrom(noBlock, "block")).toBeUndefined();
  });
});

describe("advantage with meaty depth", () => {
  it("returns listed advantage at depth 0", () => {
    expect(advantage(ryu5mp, "block", 0)).toBe(-1);
    expect(advantage(ryu5mp, "hit", 0)).toBe(7);
  });
  it("adds one frame of advantage per frame of meaty depth", () => {
    expect(advantage(ryu5mp, "block", 1)).toBe(0);
    expect(advantage(ryu5mp, "block", 2)).toBe(1);
  });
  it("clamps meaty depth to the active window (active-1)", () => {
    // active 4 -> max depth 3 -> best block advantage -1 + 3 = 2
    expect(advantage(ryu5mp, "block", 99)).toBe(2);
    expect(maxMeatyDepth(ryu5mp)).toBe(3);
  });
  it("never goes below depth 0", () => {
    expect(advantage(ryu5mp, "block", -5)).toBe(-1);
  });
});

describe("signOf", () => {
  it("classifies plus / minus / neutral", () => {
    expect(signOf(3)).toBe("plus");
    expect(signOf(-3)).toBe("minus");
    expect(signOf(0)).toBe("neutral");
  });
});
