import { describe, it, expect } from "vitest";

import {
  PINNED_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  ProtocolVersionError,
  assertProtocolCompatible,
  isProtocolCompatible,
} from "./protocol";

describe("protocol version", () => {
  it("pins a supported semver", () => {
    expect(PINNED_PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(PINNED_PROTOCOL_VERSION);
  });

  it("accepts the pinned version and rejects unknown versions", () => {
    expect(isProtocolCompatible(PINNED_PROTOCOL_VERSION)).toBe(true);
    expect(isProtocolCompatible("0.0.1")).toBe(false);
    expect(() => assertProtocolCompatible("9.9.9")).toThrow(ProtocolVersionError);
  });
});
