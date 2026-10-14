import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import {
  DESCRIPTOR_SCHEMA_VERSION,
  DESCRIPTOR_SCHEMA_VERSION_PATTERN,
  OMNIBOT_HARD_CAPS,
  hardCapsWithinOmniBotCeiling,
} from "./descriptor";

const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../ohho.descriptor.v1",
);

const SCHEMA_ID = "https://ohho-robotics.com/schemas/ohho.descriptor.v1/descriptor.json";

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function vectorFiles(bucket: "valid" | "invalid"): string[] {
  const dir = path.join(SCHEMA_DIR, "vectors", "descriptor", bucket);
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (names.length === 0) {
    throw new Error(`no ${bucket} vectors in ${dir}`);
  }
  return names.map((name) => path.join(dir, name));
}

function ajv() {
  const validator = new Ajv2020({ allErrors: true, strict: true });
  validator.addSchema(readJson(path.join(SCHEMA_DIR, "defs.json")));
  validator.addSchema(readJson(path.join(SCHEMA_DIR, "descriptor.json")));
  return validator;
}

const validate = ajv().getSchema(SCHEMA_ID);
if (!validate) {
  throw new Error(`schema not loaded: ${SCHEMA_ID}`);
}

describe("ohho.descriptor.v1 golden vectors", () => {
  for (const file of vectorFiles("valid")) {
    it(`accepts ${path.basename(file)}`, () => {
      const ok = validate(readJson(file));
      expect(validate.errors).toBeNull();
      expect(ok).toBe(true);
    });
  }

  for (const file of vectorFiles("invalid")) {
    it(`rejects ${path.basename(file)}`, () => {
      expect(validate(readJson(file))).toBe(false);
    });
  }
});

describe("ohho.descriptor.v1 OmniBot ceilings", () => {
  it("keeps hard-cap maximums at the OmniBot ceilings", () => {
    const defs = readJson(path.join(SCHEMA_DIR, "defs.json")) as {
      $defs: {
        HardSafetyCaps: { properties: Record<string, { maximum: number }> };
        DriveCaps: { properties: Record<string, { maximum: number }> };
        SchemaVersion: { pattern: string };
      };
    };
    const manifest = readJson(path.join(SCHEMA_DIR, "manifest.json")) as {
      id: string;
      version: string;
      versionPattern: string;
    };
    expect(manifest.id).toBe("ohho.descriptor.v1");
    expect(manifest.version).toBe("1.0.0");
    expect(DESCRIPTOR_SCHEMA_VERSION).toBe(manifest.version);
    expect(DESCRIPTOR_SCHEMA_VERSION_PATTERN).toBe(manifest.versionPattern);
    expect(defs.$defs.SchemaVersion.pattern).toBe(manifest.versionPattern);

    const hard = defs.$defs.HardSafetyCaps.properties;
    expect(hard.max_vx_mps.maximum).toBe(OMNIBOT_HARD_CAPS.max_vx_mps);
    expect(hard.max_vy_mps.maximum).toBe(OMNIBOT_HARD_CAPS.max_vy_mps);
    expect(hard.max_wz_rad_s.maximum).toBe(OMNIBOT_HARD_CAPS.max_wz_rad_s);
    expect(hard.max_accel_x_mps2.maximum).toBe(OMNIBOT_HARD_CAPS.max_accel_x_mps2);
    expect(hard.max_accel_y_mps2.maximum).toBe(OMNIBOT_HARD_CAPS.max_accel_y_mps2);
    expect(hard.max_accel_wz_rad_s2.maximum).toBe(OMNIBOT_HARD_CAPS.max_accel_wz_rad_s2);
    expect(hard.max_joint_step_rad.maximum).toBe(OMNIBOT_HARD_CAPS.max_joint_step_rad);

    const drive = defs.$defs.DriveCaps.properties;
    expect(drive.vx_mps.maximum).toBe(0.2);
    expect(drive.vy_mps.maximum).toBe(0.2);
    expect(drive.wz_rad_s.maximum).toBe(1);
  });

  it("publishes the OmniBot descriptor at those ceilings, not above them", () => {
    const doc = readJson(path.join(SCHEMA_DIR, "vectors/descriptor/valid/omnibot.json")) as {
      id: string;
      model: string;
      drive: { kind: string; holonomic: boolean; caps: { vx_mps: number; vy_mps: number; wz_rad_s: number } };
      arms: { joints: { name: string; min: number; max: number; home: number }[] }[];
      apriltags: unknown[];
      topics: { cmd: string; estop: string; state: string };
      telemetry: { schema_id: string; robot_id: string; kind: string; fields: string[] };
      safety: { hard: OmniBotHardCaps };
    };
    expect(doc.id).toBe("omnibot");
    expect(doc.model).toBe("OmniBot");
    expect(doc.drive.kind).toBe("mecanum");
    expect(doc.drive.holonomic).toBe(true);
    expect(doc.drive.caps.vx_mps).toBe(0.2);
    expect(doc.drive.caps.vy_mps).toBe(0.2);
    expect(doc.drive.caps.wz_rad_s).toBe(1);
    expect(doc.topics.cmd).toBe("/cmd_vel");
    expect(doc.topics.state).toBe("/odom");
    expect(doc.topics.estop).toBe("/emergency_stop");
    expect(doc.apriltags).toEqual([]);
    expect(doc.telemetry.schema_id).toBe("ohho.telemetry.v1");
    expect(doc.telemetry.robot_id).toBe("omnibot");
    expect(doc.telemetry.kind).toBe("real");
    expect(doc.telemetry.fields).toEqual(["base", "joints", "imu"]);
    expect(doc.arms[0].joints.map((joint) => joint.name)).toEqual([
      "arm_shoulder_pan",
      "arm_shoulder_lift",
      "arm_elbow_flex",
      "arm_wrist_flex",
      "arm_wrist_roll",
      "arm_gripper",
    ]);
    const grip = doc.arms[0].joints[5];
    expect(grip.min).toBe(-0.1);
    expect(grip.max).toBe(0.8);
    expect(grip.home).toBe(0);
    expect(hardCapsWithinOmniBotCeiling(doc.safety.hard)).toBe(true);
    expect(doc.safety.hard.max_vx_mps).toBe(0.2);
    expect(doc.safety.hard.max_joint_step_rad).toBe(0.15);
    expect(hardCapsWithinOmniBotCeiling(undefined)).toBe(false);
    expect(
      hardCapsWithinOmniBotCeiling({ ...doc.safety.hard, max_vx_mps: 0.21 }),
    ).toBe(false);
  });
});
