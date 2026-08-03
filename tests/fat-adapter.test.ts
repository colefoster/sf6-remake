import { describe, it, expect } from "vitest";
import { firstInt, toCharacter } from "../src/data/fat-adapter.js";

describe("firstInt — parsing FAT's messy strings", () => {
  it("passes through plain numbers", () => {
    expect(firstInt(6)).toBe(6);
    expect(firstInt(-12)).toBe(-12);
  });
  it("takes the first integer from parenthesised recovery", () => {
    expect(firstInt("11(13)")).toBe(11);
    expect(firstInt("23(29)")).toBe(23);
  });
  it("takes the first integer from additive recovery", () => {
    expect(firstInt("21+12")).toBe(21);
  });
  it("keeps the sign of negative multi-value advantage", () => {
    expect(firstInt("-13(-28)(-43)")).toBe(-13);
  });
  it("extracts the frame number from knockdown strings", () => {
    expect(firstInt("KD +40")).toBe(40);
    expect(firstInt("Crumple +104")).toBe(104);
  });
  it("returns undefined for null / non-numeric", () => {
    expect(firstInt(null)).toBeUndefined();
    expect(firstInt(undefined)).toBeUndefined();
    expect(firstInt("KD (notes)")).toBeUndefined();
  });
});

describe("toCharacter — a minimal FAT entry", () => {
  const fat = {
    moves: {
      normal: {
        "Crouch MK": {
          moveName: "Crouch MK",
          numCmd: "2MK",
          startup: 8,
          active: 3,
          recovery: 19,
          onHit: 1,
          onBlock: -6,
          dmg: 500,
          xx: ["sp", "su"],
          moveType: "normal",
        },
        Sweep: {
          moveName: "Crouch HK",
          numCmd: "2HK",
          startup: 9,
          active: 3,
          recovery: "23(29)",
          onHit: "KD +40",
          onBlock: -12,
          dmg: 900,
          moveType: "normal",
        },
      },
    },
  };

  it("parses a normal into clean integer fields", () => {
    const c = toCharacter("Ryu", fat);
    const mk = c.moves.find((m) => m.input === "2MK")!;
    expect(mk.startup).toBe(8);
    expect(mk.onBlock).toBe(-6);
    expect(mk.onHit).toBe(1);
    expect(mk.cancelTags).toEqual(["sp", "su"]);
  });

  it("detects a knockdown reaction and keeps the oki frames as onHit", () => {
    const c = toCharacter("Ryu", fat);
    const sweep = c.moves.find((m) => m.input === "2HK")!;
    expect(sweep.onHit).toBe(40);
    expect(sweep.hitReaction).toBe("knockdown");
    expect(sweep.raw?.recovery).toBe("23(29)");
  });
});
