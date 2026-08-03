import { describe, it, expect } from "vitest";
import { adv, sequence, cancel, punish, gap } from "../src/engine/index.js";
import { loadRoster, findCharacter, findMove } from "../src/data/index.js";
import type { FastestPunish } from "../src/engine/interactions.js";

/**
 * These assert against the REAL vendored FAT data (data/raw/SF6FrameData.json).
 * If Capcom rebalances and the data is refreshed, some numbers may change —
 * that's expected; update the expectations to match the new patch.
 */

describe("roster loads", () => {
  it("has all 30 characters", () => {
    expect(loadRoster().length).toBe(30);
  });
  it("finds characters forgivingly", () => {
    expect(findCharacter("ryu")?.name).toBe("Ryu");
    expect(findCharacter("chun")?.name).toBe("Chun-Li");
    expect(findCharacter("honda")?.name).toBe("E.Honda");
  });
});

describe("real Ryu frame data", () => {
  it("2MK is -6 on block, +1 on hit", () => {
    expect(adv("ryu", "2mk", { guard: "block" })?.advantage).toBe(-6);
    expect(adv("ryu", "2mk", { guard: "hit" })?.advantage).toBe(1);
  });

  it("LP Hadoken is -5 on block", () => {
    expect(adv("ryu", "236lp", { guard: "block" })?.advantage).toBe(-5);
  });

  it("HP Shoryuken is -39 on block (very punishable)", () => {
    expect(adv("ryu", "623hp", { guard: "block" })?.advantage).toBe(-39);
  });

  it("finds a move by name fragment", () => {
    const ryu = findCharacter("ryu")!;
    expect(findMove(ryu, "hadoken")).toBeDefined();
    expect(findMove(ryu, "sweep") ?? findMove(ryu, "crouch hk")).toBeDefined();
  });
});

describe("flagship: 2MK xx Hadoken from block", () => {
  it("is a cancel, ends -5 (minus), and is a true blockstring", () => {
    const r = sequence("ryu", ["2mk", "236lp"], { guard: "block" });
    expect(r.steps[0]!.connection).toBe("cancel");
    expect(r.endingAdvantage).toBe(-5);
    expect(r.endingSign).toBe("minus");
    expect(r.trueBlockstring).toBe(true);
  });

  it("cancel command agrees it is legal and minus", () => {
    const r = cancel("ryu", "2mk", "236lp", { guard: "block" });
    expect(r.cancelable).toBe(true);
    expect(r.endingAdvantage).toBe(-5);
  });
});

describe("meaty changes the ending sign", () => {
  it("2MK meaty deep enough flips its own block advantage toward plus", () => {
    const flat = adv("ryu", "2mk", { guard: "block", meaty: 0 })!.advantage; // -6
    const deep = adv("ryu", "2mk", { guard: "block", meaty: 2 })!.advantage; // -4
    expect(deep).toBe(flat + 2);
  });
});

describe("punish: blocked HP Shoryuken", () => {
  it("gives Ryu a wide punish window and a fastest punish", () => {
    const r = punish("ryu", "623hp", "ryu") as FastestPunish;
    expect(r.window).toBe(39);
    expect(r.best).toBeDefined();
    expect(r.best!.startup).toBeLessThanOrEqual(39);
  });
});

describe("gap between two blocked normals", () => {
  it("computes a numeric gap for Ryu 5MP -> 2MK", () => {
    const r = gap("ryu", "5mp", "2mk");
    expect(r.applicable).toBe(true);
    // 2MK startup 8 − 5MP onBlock (−1) = 9
    expect(r.gap).toBe(9);
  });
});
