import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";

import {
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_SCHEMA_VERSION_PATTERN,
  TelemetryVersionError,
  assertTelemetryVersionCompatible,
  echoHeartbeat,
  isHeartbeatEchoOf,
  isTelemetryVersionCompatible,
  safetyFlagsAllowMotion,
} from "./telemetry";

const SCHEMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../ohho.telemetry.v1",
);

const SCHEMA_FILES = [
  "defs.json",
  "heartbeat.json",
  "heartbeat_echo.json",
  "safety_state.json",
  "telemetry.json",
] as const;

const KINDS = [
  ["telemetry", "https://ohho-robotics.com/schemas/ohho.telemetry.v1/telemetry.json"],
  ["safety_state", "https://ohho-robotics.com/schemas/ohho.telemetry.v1/safety_state.json"],
  ["heartbeat", "https://ohho-robotics.com/schemas/ohho.telemetry.v1/heartbeat.json"],
  ["heartbeat_echo", "https://ohho-robotics.com/schemas/ohho.telemetry.v1/heartbeat_echo.json"],
] as const;

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function vectorFiles(kind: string, bucket: "valid" | "invalid"): string[] {
  const dir = path.join(SCHEMA_DIR, "vectors", kind, bucket);
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
  validator.addKeyword({
    keyword: "x-ohho-estop-source",
    schemaType: "boolean",
  });
  for (const file of SCHEMA_FILES) {
    validator.addSchema(readJson(path.join(SCHEMA_DIR, file)));
  }
  return validator;
}

const validator = ajv();

describe("ohho.telemetry.v1 golden vectors", () => {
  for (const [kind, id] of KINDS) {
    const validate = validator.getSchema(id);
    if (!validate) {
      throw new Error(`schema not loaded: ${id}`);
    }

    describe(kind, () => {
      for (const file of vectorFiles(kind, "valid")) {
        it(`accepts ${path.basename(file)}`, () => {
          const ok = validate(readJson(file));
          expect(validate.errors).toBeNull();
          expect(ok).toBe(true);
        });
      }

      for (const file of vectorFiles(kind, "invalid")) {
        it(`rejects ${path.basename(file)}`, () => {
          expect(validate(readJson(file))).toBe(false);
        });
      }
    });
  }
});

describe("ohho.telemetry.v1 contract", () => {
  it("requires the same safety fields on telemetry and safety state", () => {
    const safety = readJson(path.join(SCHEMA_DIR, "safety_state.json")) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    const telemetry = readJson(path.join(SCHEMA_DIR, "telemetry.json")) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(safety.required).toEqual([
      "v",
      "t",
      "robot_id",
      "kind",
      "mode",
      "estop",
      "deadman",
      "link",
    ]);
    expect(telemetry.required).toEqual(safety.required);
    for (const key of safety.required) {
      expect(telemetry.properties[key]).toEqual(safety.properties[key]);
    }
  });

  it("keeps heartbeat fields identical on the echo", () => {
    const heartbeat = readJson(path.join(SCHEMA_DIR, "heartbeat.json")) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    const echo = readJson(path.join(SCHEMA_DIR, "heartbeat_echo.json")) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(heartbeat.required).toEqual(["v", "seq", "t_client"]);
    expect(echo.required).toEqual(["v", "seq", "t_client", "t"]);
    for (const key of heartbeat.required) {
      expect(echo.properties[key]).toEqual(heartbeat.properties[key]);
    }
  });

  it("pins 1.0.x and rejects a newer minor in the schema pattern", () => {
    const manifest = readJson(path.join(SCHEMA_DIR, "manifest.json")) as {
      id: string;
      version: string;
      versionPattern: string;
    };
    const defs = readJson(path.join(SCHEMA_DIR, "defs.json")) as {
      $defs: { SchemaVersion: { pattern: string } };
    };
    expect(manifest.id).toBe("ohho.telemetry.v1");
    expect(TELEMETRY_SCHEMA_VERSION).toBe(manifest.version);
    expect(TELEMETRY_SCHEMA_VERSION_PATTERN).toBe(manifest.versionPattern);
    expect(defs.$defs.SchemaVersion.pattern).toBe(manifest.versionPattern);
    const pattern = new RegExp(manifest.versionPattern);
    expect(pattern.test("1.0.0")).toBe(true);
    expect(pattern.test("1.0.2")).toBe(true);
    expect(pattern.test("1.1.0")).toBe(false);
    expect(pattern.test("2.0.0")).toBe(false);
  });
});

describe("telemetry version negotiation", () => {
  it("treats minor as additive and major as breaking", () => {
    expect(isTelemetryVersionCompatible("1.0.0")).toBe(true);
    expect(isTelemetryVersionCompatible("1.0.4")).toBe(true);
    expect(isTelemetryVersionCompatible("1.0.0", "1.2.0")).toBe(true);
    expect(isTelemetryVersionCompatible("1.2.0", "1.0.0")).toBe(false);
    expect(isTelemetryVersionCompatible("2.0.0")).toBe(false);
    expect(isTelemetryVersionCompatible("1.0.0", "2.0.0")).toBe(false);
    expect(isTelemetryVersionCompatible("1.0")).toBe(false);
    expect(isTelemetryVersionCompatible("01.0.0")).toBe(false);
    expect(() => assertTelemetryVersionCompatible("1.1.0")).toThrow(TelemetryVersionError);
    assertTelemetryVersionCompatible(TELEMETRY_SCHEMA_VERSION);
  });
});

describe("safety flags and heartbeat echo", () => {
  it("does not treat a missing or inconsistent sample as a motion permit", () => {
    const load = (name: string) =>
      readJson(path.join(SCHEMA_DIR, "vectors/telemetry/valid", name)) as {
        deadman: boolean;
        estop: { active: boolean; latched: boolean; source: "none" };
        mode: { base: "idle"; arm: "not_present" };
        joints?: unknown;
        imu?: unknown;
      };

    const minimal = load("minimal.json");
    expect(minimal.joints).toBeUndefined();
    expect(minimal.imu).toBeUndefined();
    expect(minimal.mode.arm).toBe("not_present");
    expect(safetyFlagsAllowMotion(minimal)).toBe(false);
    expect(safetyFlagsAllowMotion(load("full.json"))).toBe(true);
    expect(safetyFlagsAllowMotion(load("estop_active.json"))).toBe(false);
    expect(safetyFlagsAllowMotion(load("estop_latched.json"))).toBe(false);
    expect(safetyFlagsAllowMotion(load("arm_fault.json"))).toBe(false);
    expect(safetyFlagsAllowMotion(load("link_down.json"))).toBe(false);
    expect(safetyFlagsAllowMotion(undefined)).toBe(false);
    expect(
      safetyFlagsAllowMotion({
        deadman: true,
        estop: { active: false, latched: false, source: "hardware" },
        mode: { base: "teleop", arm: "not_present" },
      }),
    ).toBe(false);
  });

  it("echoes seq and t_client unchanged", () => {
    const heartbeat = readJson(
      path.join(SCHEMA_DIR, "vectors/heartbeat/valid/typical.json"),
    ) as { v: string; seq: number; t_client: number };
    const echo = echoHeartbeat(heartbeat, 1735689601.5);
    expect(echo.seq).toBe(heartbeat.seq);
    expect(echo.t_client).toBe(heartbeat.t_client);
    expect(echo.v).toBe(heartbeat.v);
    expect(echo.t).toBe(1735689601.5);
    expect(isHeartbeatEchoOf(echo, heartbeat)).toBe(true);
    expect(() => echoHeartbeat(heartbeat, -1)).toThrow(RangeError);
    expect(() => echoHeartbeat(heartbeat, Number.NaN)).toThrow(RangeError);
  });
});
