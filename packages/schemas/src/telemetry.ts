/**
 * ohho.telemetry.v1 helpers. Types and the wire schema live next to this file.
 *
 * Minor versions only add optional fields. Major versions break.
 * A consumer fails closed on a newer minor than the one it implements.
 */

import type { EstopState, Heartbeat, HeartbeatEcho, ModeState } from "./generated/telemetry.generated";
import {
  TELEMETRY_SCHEMA_ID,
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_SCHEMA_VERSION_PATTERN,
} from "./generated/telemetry-version.generated";

export {
  TELEMETRY_SCHEMA_ID,
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_SCHEMA_VERSION_PATTERN,
};

export interface SafetyFlagSample {
  estop: EstopState;
  deadman: boolean;
  mode: ModeState;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseTelemetrySemver(
  version: string,
): { major: number; minor: number; patch: number } | null {
  const match = SEMVER.exec(version);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Same major, and the message minor is less than or equal to the supported minor.
 * Patch is ignored. A newer minor is rejected: this SDK does not ignore unknown fields.
 * A different major is breaking.
 */
export function isTelemetryVersionCompatible(
  messageVersion: string,
  supportedVersion: string = TELEMETRY_SCHEMA_VERSION,
): boolean {
  const message = parseTelemetrySemver(messageVersion);
  const supported = parseTelemetrySemver(supportedVersion);
  if (!message || !supported) {
    return false;
  }
  if (message.major !== supported.major) {
    return false;
  }
  return message.minor <= supported.minor;
}

export class TelemetryVersionError extends Error {
  readonly code = "TELEMETRY_VERSION_MISMATCH" as const;

  constructor(
    message: string,
    readonly requested: string,
    readonly supported: string,
  ) {
    super(message);
    this.name = "TelemetryVersionError";
  }
}

export function assertTelemetryVersionCompatible(
  messageVersion: string,
  supportedVersion: string = TELEMETRY_SCHEMA_VERSION,
): void {
  if (!isTelemetryVersionCompatible(messageVersion, supportedVersion)) {
    throw new TelemetryVersionError(
      `Incompatible telemetry schema ${messageVersion}; this SDK implements ${supportedVersion}. Minor versions are additive and major versions break.`,
      messageVersion,
      supportedVersion,
    );
  }
}

/**
 * True only when deadman is asserted, e-stop is clear and unlatched with source none,
 * and neither subsystem mode is fault. Missing flags return false.
 * This is not a safety gate: it does not apply caps, joint limits, watchdogs, or staleness.
 */
export function safetyFlagsAllowMotion(state: SafetyFlagSample | null | undefined): boolean {
  if (state == null || state.estop == null || state.mode == null) {
    return false;
  }
  if (state.deadman !== true) {
    return false;
  }
  if (state.estop.active !== false) {
    return false;
  }
  if (state.estop.latched !== false) {
    return false;
  }
  if (state.estop.source !== "none") {
    return false;
  }
  if (state.mode.base === "fault" || state.mode.arm === "fault") {
    return false;
  }
  return true;
}

/** Copy seq and t_client unchanged and stamp the server clock (seconds since the Unix epoch). */
export function echoHeartbeat(heartbeat: Heartbeat, serverTimeSeconds: number): HeartbeatEcho {
  if (!Number.isFinite(serverTimeSeconds) || serverTimeSeconds < 0) {
    throw new RangeError("server time must be a finite number of seconds >= 0");
  }
  return {
    v: heartbeat.v,
    seq: heartbeat.seq,
    t_client: heartbeat.t_client,
    t: serverTimeSeconds,
  };
}

export function isHeartbeatEchoOf(echo: HeartbeatEcho, heartbeat: Heartbeat): boolean {
  return echo.v === heartbeat.v && echo.seq === heartbeat.seq && echo.t_client === heartbeat.t_client;
}
