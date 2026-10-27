# @ohho/schemas

JSON Schema and generated types for OhhO. The vendored ohho-os transport shapes
(`packages/schemas/vendor/ohho-os/`, including the legacy `Telemetry` object)
are unchanged. **ohho.telemetry.v1** is a separate contract for VR, apk, and web.

## ohho.telemetry.v1

Source schemas:

- `ohho.telemetry.v1/telemetry.json` — full sample
- `ohho.telemetry.v1/safety_state.json` — safety fields only
- `ohho.telemetry.v1/heartbeat.json` — client ping `{v, seq, t_client}`
- `ohho.telemetry.v1/heartbeat_echo.json` — server echo of that ping plus `t`
- `ohho.telemetry.v1/defs.json` — shared fields
- `ohho.telemetry.v1/manifest.json` — schema id `ohho.telemetry.v1`, semver `1.0.0`

Golden vectors (valid and invalid) live under `ohho.telemetry.v1/vectors/`.

Regenerate TypeScript, C#, and Python after a schema edit:

```bash
npm run codegen:telemetry
npm run codegen:telemetry -- --check
```

| Output | Path |
| --- | --- |
| TypeScript | `src/generated/telemetry.generated.ts` |
| C# (Newtonsoft, namespace `Ohho.Schemas`, netstandard2.1) | `generated/csharp/Ohho.Schemas/` |
| Python (pydantic v2) | `generated/python/ohho_schemas/` |

This schema version is independent of `PINNED_PROTOCOL_VERSION` (the ohho-os transport pin).

### Version negotiation

`v` is `MAJOR.MINOR.PATCH`.

- **Patch** — wording only. No wire change. A `1.0.x` consumer accepts any `1.0.*` patch.
- **Minor** — additive optional fields only. Old required fields keep their types and names. This SDK fails closed: `isTelemetryVersionCompatible` accepts a message minor less than or equal to the minor it implements, and rejects a newer minor. It does not ignore unknown fields.
- **Major** — breaking. Removing, renaming, or retyping a field, or adding a required field, needs a new major and a new `ohho.telemetry.vN` document.

`1.0.0` is compatible with a consumer that implements `1.2.0`. `1.2.0` is not compatible with a consumer that implements `1.0.0`. `2.0.0` is not compatible with `1.x`.

### Units

SI quantities and radians, with two named exceptions (`rtt_ms`, `latency_ms`, and `temp`).

| Field | Unit |
| --- | --- |
| `t`, `t_client` | seconds since the Unix epoch (UTC). Not a ROS `{secs, nsecs}` stamp. |
| `link.rtt_ms`, `policy.latency_ms` | milliseconds |
| `link.hz` | hertz. `0` means the stream is dead. It does not clear an e-stop. |
| `nav.eta` | seconds from `t` |
| `base.cmd`, `base.meas` | body frame. `vx`/`vy` m/s, `wz` rad/s. No schema maximum. |
| `base.pose`, `nav.goal` | `x`/`y` metres, `yaw` radians about +Z. Pose is in `base.frame` (for example `odom`). Goal is in the map frame. |
| `joints[]` | revolute. `pos`/`cmd`/`min`/`max` radians, `vel` rad/s, `effort` N·m. |
| `gripper.pos`, `gripper.cmd` | metres of opening |
| `imu.roll`/`pitch`/`yaw` | radians |
| `imu.ax`/`ay`/`az` | m/s², sensor frame, gravity included |
| `battery.v` | volts. No upper cap. |
| `battery.pct`, `sys.cpu` | percent, 0 to 100 inclusive. Not the legacy transport battery fraction of 0..1. |
| `sys.temp` | degrees Celsius. Not kelvin, and not a safety limit. |
| `rec.frames` | count |

Zero is a real measurement. Omit an optional block when the robot has no such sample. Do not send zeros to mean "missing".

`mode.arm` is required. A robot with no arm sends `"not_present"` and omits `joints` and `gripper`.

### Safety fields

Required on both telemetry and safety state: `v`, `t`, `robot_id`, `kind`, `mode`, `estop`, `deadman`, `link`.

- `deadman: true` means the operator deadman control is asserted. `false` is not a permit. Omitting it is invalid and must not be read as either value.
- `estop.active` or `estop.latched` means motion must not be commanded. `source` is `none` only when both flags are false. Otherwise it is `hardware`, `software`, `remote`, or `watchdog`.
- `mode` `fault` on base or arm is not a permit. `not_present` means that subsystem is not installed.

`safetyFlagsAllowMotion` (C# `SafetyFlagsAllowMotion`, Python `safety_flags_allow_motion`) returns true only when deadman is asserted, e-stop is clear and unlatched with source `none`, and neither mode is `fault`. Missing flags return false.

That helper is not a safety gate. It does not apply velocity caps, joint limits, acceleration caps, watchdogs, or staleness checks, and a schema-valid sample is not permission to skip the producer safety gate. This schema does not raise or remove any cap. `min`/`max` on a joint describe that joint; they are not a licence to widen a limit. A large `vx` is still a valid report.

A default-constructed C# object is not a permit: `SafetyFlagsAllowMotion()` returns false until the safety fields are present and clear.

### Examples

Minimal sample (no arm, no IMU). Motion is not permitted (`deadman` is false):

```json
{
  "v": "1.0.0",
  "t": 1735689600.5,
  "robot_id": "omnibot-sim",
  "kind": "sim",
  "mode": { "base": "idle", "arm": "not_present" },
  "estop": { "active": false, "latched": false, "source": "none" },
  "deadman": false,
  "link": { "rtt_ms": 5, "hz": 20 }
}
```

Heartbeat and echo. `seq` and `t_client` are copied unchanged:

```json
{ "v": "1.0.0", "seq": 4, "t_client": 1735689601.25 }
```

```json
{ "v": "1.0.0", "seq": 4, "t_client": 1735689601.25, "t": 1735689601.5 }
```

Latched e-stop (still a valid sample, not a motion permit):

```json
{ "active": false, "latched": true, "source": "hardware" }
```

A full sample with base, joints, IMU, battery, nav, policy, recording, and host stats is `ohho.telemetry.v1/vectors/telemetry/valid/full.json`.

### Follow-up wiring (other repos)

- **OHH-208 / OmniBot** — `telemetry_aggregator` should emit this sample instead of leaving VR, apk, and web on raw ROS topics.
- **ohho-os** — publish `SafetyState` and `TelemetryV1` from the engine. Do not treat this document as a replacement for `SafetyGate` caps, the e-stop latch, or the deadman arming phrase.
- **OhhO-VR** — compile `generated/csharp/Ohho.Schemas` (Newtonsoft, namespace `Ohho.Schemas`) in the VR tests and stop parsing raw ROS for this contract. Map the VR string `nav2` to `mode.base = "auto"` when that wiring lands.
- **OHH-214** — `RobotDescriptor` names `robot_id` and `kind` from this sample. See below.

## ohho.descriptor.v1

Source schemas:

- `ohho.descriptor.v1/descriptor.json` — latched robot descriptor
- `ohho.descriptor.v1/defs.json` — shared fields
- `ohho.descriptor.v1/manifest.json` — schema id `ohho.descriptor.v1`, semver `1.0.0`

The golden OmniBot document is `ohho.descriptor.v1/vectors/descriptor/valid/omnibot.json`.

Regenerate after a schema edit:

```bash
npm run codegen:descriptor
npm run codegen:descriptor -- --check
```

| Output | Path |
| --- | --- |
| TypeScript | `src/generated/descriptor.generated.ts` |
| C# (Newtonsoft, namespace `Ohho.Schemas`, netstandard2.1) | `generated/csharp/Ohho.Schemas/DescriptorV1.generated.cs` |
| Python (pydantic v2) | `generated/python/ohho_schemas/descriptor_v1.py` |

C# reuses `OhhoJson` and `OhhoValidate` from the telemetry file. Hard-cap maximums are the OmniBot ceilings and must not be raised: 0.2 m/s linear, 1.0 rad/s yaw, 0.5 m/s² linear acceleration, 2.0 rad/s² yaw acceleration, 0.15 rad joint step. A document at the ceiling does not raise a tighter driver clamp. A schema-valid descriptor is not permission to skip the producer safety gate.

`v` follows the same major/minor/patch rules as ohho.telemetry.v1. Joint `min` / `max` / `home` are radians. AprilTag `size` is metres. `T_tag_base` is a row-major 4×4 transform into the base frame. OmniBot ships with an empty `apriltags` array.
