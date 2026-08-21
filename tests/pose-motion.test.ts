/**
 * The temporal audit's own regression lock.
 *
 * `scripts/pose-motion.ts` is a grading tool, so the thing worth testing is that
 * the grade does not move: the counts below are the ones ADR-0064 recorded, and
 * a category that grows is either a regression in `poseOf` or a change in the
 * predicate. Either way it wants explaining before it is re-baselined.
 */
import { describe, expect, it } from "vitest";
import { familyOf, motionAudit } from "../scripts/pose-motion.js";

describe("the action families the counts are split by", () => {
  it("reads the family off the name", () => {
    expect(familyOf("ATK_5LP")).toBe("ATK");
    expect(familyOf("SPA_HADOKEN_L")).toBe("SPA");
    expect(familyOf("SAA1_BREAKIN_DRK")).toBe("SPA");
    expect(familyOf("BAS_FORWARD_Loop")).toBe("BAS");
    expect(familyOf("0010_DMG_HL_ST")).toBe("reaction");
    expect(familyOf("5010_GRD_STD_Loop")).toBe("reaction");
    expect(familyOf("Hyakkan_FALL")).toBe("other");
  });
});

describe("the figure walked over time", () => {
  const report = motionAudit();

  it("walks the same frames the single-frame audit does", () => {
    const frames = Object.values(report.byFamily).reduce((a, b) => a + b.frames, 0);
    expect(frames).toBe(456993);
  });

  it("holds the residuals ADR-0064 named", () => {
    expect(report.counts).toEqual({
      "stance-snap": 497,
      "limb-jerk": 379,
      "stand-snap": 170,
      "plant-slide": 165,
      "limb-teleport": 137,
      "fade-snap": 51,
    });
  });

  it("has no gait that cannot tell forwards from backwards", () => {
    // The fault of 5abdb75: `phase` came off the signed `origin.x` through
    // `Math.cos`, which is even, so all 362 gaited actions traced one cycle
    // whichever way they travelled. Reverting it flags every one of them.
    expect(report.counts["gait-blind"]).toBeUndefined();
    expect(report.gaited).toBe(362);
  });

  it("charges the honest snap onto a hitbox to nobody", () => {
    // 1,679 of the 2,412 actions that carry a hitbox have no outboard hurtbox
    // before their first active frame, so the pop to the box is the game's and
    // not a defect. It is excluded by rule, and the size of what is excluded is
    // why the rule has to be stated.
    expect(report.excluded).toEqual({ snapIn: 3351, snapOut: 3364 });
  });

  it("finds the defects where the attacks are", () => {
    const total = Object.values(report.counts).reduce((a, b) => a + b, 0);
    const attacks = report.byFamily["ATK"]!.flagged + report.byFamily["SPA"]!.flagged;
    expect(attacks / total).toBeGreaterThan(0.85);
    expect(report.byFamily["reaction"]!.flagged).toBeLessThan(10);
  });
});
