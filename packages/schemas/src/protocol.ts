/**
 * OhhO wire protocol version — shared contract with ohho-os `schemas/`.
 *
 * `PINNED_PROTOCOL_VERSION` is generated from the vendor pin; SDK releases document
 * which protocol versions they support and refuse incompatible engines at connect.
 */

import {
  PINNED_PROTOCOL_VERSION,
  PINNED_OHHO_OS_VERSION,
} from "./protocol-version.generated";

export { PINNED_PROTOCOL_VERSION, PINNED_OHHO_OS_VERSION };

/** Protocol versions this SDK release can talk to (inclusive). */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [PINNED_PROTOCOL_VERSION];

export class ProtocolVersionError extends Error {
  readonly code = "PROTOCOL_VERSION_MISMATCH" as const;

  constructor(
    message: string,
    readonly requested: string,
    readonly supported: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS,
  ) {
    super(message);
    this.name = "ProtocolVersionError";
  }
}

export function isProtocolCompatible(version: string): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}

/** Fail closed when an engine advertises an unsupported protocol version. */
export function assertProtocolCompatible(version: string): void {
  if (!isProtocolCompatible(version)) {
    throw new ProtocolVersionError(
      `Unsupported OhhO protocol ${version}; this SDK supports ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
      version,
    );
  }
}
