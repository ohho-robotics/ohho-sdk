/*
 * Connect-time protocol checks — pairs with ohho-os `protocolVersion` / sim-serve.
 */

import type { RobotConfig } from "@ohho/schemas";
import {
  PINNED_PROTOCOL_VERSION,
  assertProtocolCompatible,
} from "@ohho/schemas";

import { createTransport } from "./factory";
import type { ConnectionConfig, RobotTransport, TransportStatus } from "./types";

export interface ConnectOptions {
  /** When the engine advertises a version (e.g. sim-serve WebSocket `protocolVersion`). */
  engineProtocolVersion?: string;
}

/**
 * Create a transport and connect after verifying protocol compatibility.
 *
 * Always checks the SDK pin; when `engineProtocolVersion` is supplied, checks that too.
 */
export async function connectTransport(
  robot: RobotConfig,
  cfg: ConnectionConfig,
  options: ConnectOptions = {},
): Promise<{ transport: RobotTransport; status: TransportStatus }> {
  assertProtocolCompatible(PINNED_PROTOCOL_VERSION);
  if (options.engineProtocolVersion !== undefined) {
    assertProtocolCompatible(options.engineProtocolVersion);
  }

  const transport = createTransport(robot, cfg);
  const status = await transport.connect();
  return { transport, status };
}

/** Parse and validate `protocolVersion` from a sim-serve (or similar) JSON payload. */
export function protocolVersionFromPayload(payload: Record<string, unknown>): string | undefined {
  const raw = payload.protocolVersion;
  return typeof raw === "string" ? raw : undefined;
}

export function assertEngineProtocolFromPayload(payload: Record<string, unknown>): void {
  const version = protocolVersionFromPayload(payload);
  if (version !== undefined) {
    assertProtocolCompatible(version);
  }
}
