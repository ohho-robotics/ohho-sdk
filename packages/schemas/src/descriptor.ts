/**
 * ohho.descriptor.v1 helpers. Types and the wire schema live next to this file.
 *
 * Hard-cap maximums are the OmniBot ceilings. A value above one of them is not
 * a valid descriptor, and a value at the ceiling does not raise a tighter
 * producer clamp.
 */

import {
  DESCRIPTOR_SCHEMA_ID,
  DESCRIPTOR_SCHEMA_VERSION,
  DESCRIPTOR_SCHEMA_VERSION_PATTERN,
} from "./generated/descriptor-version.generated";

export {
  DESCRIPTOR_SCHEMA_ID,
  DESCRIPTOR_SCHEMA_VERSION,
  DESCRIPTOR_SCHEMA_VERSION_PATTERN,
};

/** Ceilings locked to the OmniBot safety profile, Nav2 limits, and the arm step. */
export const OMNIBOT_HARD_CAPS = {
  max_vx_mps: 0.2,
  max_vy_mps: 0.2,
  max_wz_rad_s: 1,
  max_accel_x_mps2: 0.5,
  max_accel_y_mps2: 0.5,
  max_accel_wz_rad_s2: 2,
  max_joint_step_rad: 0.15,
} as const;

export type OmniBotHardCaps = {
  [Key in keyof typeof OMNIBOT_HARD_CAPS]: number;
};

/**
 * True only when every hard cap is finite, non-negative, and at or below the
 * OmniBot ceiling. Missing caps return false. This does not command the robot.
 */
export function hardCapsWithinOmniBotCeiling(
  hard: OmniBotHardCaps | null | undefined,
): boolean {
  if (hard == null) {
    return false;
  }
  for (const key of Object.keys(OMNIBOT_HARD_CAPS) as (keyof typeof OMNIBOT_HARD_CAPS)[]) {
    const value = hard[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return false;
    }
    if (value > OMNIBOT_HARD_CAPS[key]) {
      return false;
    }
  }
  return true;
}
