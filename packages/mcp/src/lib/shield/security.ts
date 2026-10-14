/*
 * Mock security data for OhhO Shield.
 */

export interface DeviceIdentity {
  id: string;
  fingerprint: string;
  status: "verified" | "rotate_key" | "untrusted";
  lastSeen: string;
}

export interface CVERecord {
  id: string;
  package: string;
  version: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "open" | "patched";
}

/** No invented device identities. Shield does not have a live inventory. */
export const INITIAL_DEVICES: DeviceIdentity[] = [];

/** No invented CVE ids. A real feed would come from pip-audit or similar. */
export const INITIAL_CVES: CVERecord[] = [];
