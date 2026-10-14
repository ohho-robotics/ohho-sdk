import { describe, it, expect } from "vitest";

import { defaultRobotConfig, PINNED_PROTOCOL_VERSION } from "@ohho/schemas";

import {
  assertEngineProtocolFromPayload,
  connectTransport,
  protocolVersionFromPayload,
} from "./protocol-connect";

describe("protocol at connect", () => {
  it("connects simulated transport after protocol check", async () => {
    const { status } = await connectTransport(defaultRobotConfig(), { protocol: "simulated" });
    expect(status.state).toBe("connected");
    expect(status.protocol).toBe("simulated");
  });

  it("rejects incompatible engine protocol before opening transport", async () => {
    await expect(
      connectTransport(
        defaultRobotConfig(),
        { protocol: "simulated" },
        { engineProtocolVersion: "0.0.0" },
      ),
    ).rejects.toThrow(/Unsupported OhhO protocol/);
  });

  it("parses sim-serve payloads", () => {
    expect(protocolVersionFromPayload({ protocolVersion: PINNED_PROTOCOL_VERSION })).toBe(
      PINNED_PROTOCOL_VERSION,
    );
    assertEngineProtocolFromPayload({ protocolVersion: PINNED_PROTOCOL_VERSION });
    expect(() => assertEngineProtocolFromPayload({ protocolVersion: "99.0.0" })).toThrow();
  });
});
