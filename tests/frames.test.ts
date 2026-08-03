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
  it("sums startup + active + recovery", () => {
    expect(totalFrames(ryu5mp)).toBe(21);
  });
});

describe("stunFrom (fallback derivation)", () => {
  it("matches FAT's real blockstun for Ryu 5MP (14)", () => {
    expect(stunFrom(ryu5mp, "block")).toBe(14);
  });
  it("matches FAT's real hitstun for Ryu 5MP (22)", () => {
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
