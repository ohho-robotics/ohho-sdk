import { describe, it, expect } from "vitest";

import { getSkill, MARKETPLACE_STATS } from "./market-skills";
import { buildVrManifest, VR_MANIFEST_VERSION } from "./vr-manifest";
import { defaultRobotConfig } from "./robot-config";

describe("@ohho/schemas", () => {
  it("resolves a known marketplace skill", () => {
    const skill = getSkill("pick-place-cup");
    expect(skill?.name).toBeTruthy();
    expect(MARKETPLACE_STATS.totalSkills).toBeGreaterThan(0);
  });

  it("builds a deterministic VR manifest with Pilot", () => {
    const m = buildVrManifest();
    expect(m.version).toBe(VR_MANIFEST_VERSION);
    expect(m.products.some((p) => p.slug === "pilot")).toBe(true);
  });

  it("exposes the OmniBot reference robot config", () => {
    const cfg = defaultRobotConfig();
    expect(cfg.robotId).toMatch(/omnibot/);
    expect(cfg.totalDof).toBeGreaterThan(0);
  });
});
