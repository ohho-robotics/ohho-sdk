# Hardware Bring-Up Self-Test (`ohho selftest`)

`ohho selftest` runs a comprehensive hardware diagnostic check across the robot's essential embedded subsystems:
- **Serial link**: base microcontroller and arm servo bus connectivity
- **Wheel motors & encoders**: four-wheel mecanum spin and encoder feedback direction verification
- **IMU**: accelerometer / gyro / attitude publication rate
- **STS3215 servos**: ID, voltage, temperature, and position telemetry for all 6 arm joints
- **Cameras**: video stream capture and frame arrival validation

Each check produces a `PASS`, `FAIL`, or `SKIP` status with explanatory reasons and quantitative measurements, recorded in a dated JSON report.

---

## Safety Invariant: Bench Wheel Spin Safety Lock

> [!WARNING]
> To prevent an elevated or bench-mounted robot from unexpectedly driving off a surface, wheel motor spin checks are **safety-gated**.

- On real hardware, wheel spin checks are **skipped by default** unless the operator passes `--allow-spin` (or `--spin-wheels`) or explicitly confirms the interactive prompt when prompted on a TTY.
- In simulated mode (`--sim`), wheel motion is evaluated in-process without driving physical actuators.
- Wheel spins are designed to be **short (0.25s) and low-speed (5% PWM)** to safely detect forward/reverse encoder ticks without excessive momentum.

---

## CLI Usage

### 1. In-process simulation (safe for CI)
```bash
ohho selftest --sim
```
Runs all 5 checks against the in-process simulator and outputs a dated JSON report (e.g. `selftest-20261003-120000.json`).

### 2. Real robot bring-up check (OmniBot)
```bash
# Wheel spin check will prompt for confirmation if run interactively:
ohho selftest --robot omnibot

# Or pass --allow-spin explicitly when the robot is elevated on a bench stand:
ohho selftest --robot omnibot --allow-spin
```

### 3. Custom report path and serial ports
```bash
ohho selftest --robot omnibot --allow-spin \
  --base-port /dev/ttyUSB0 \
  --arm-port /dev/ttyACM0 \
  --camera-idx 0 \
  --out /tmp/bench-report.json
```

### 4. Exit Codes & All-Skip Prevention
- `0`: Success (all checks passed or safely skipped with hardware verified, or `--sim` mode, or `--allow-all-skip` passed).
- `1`: One or more self-test checks reported `FAIL`.
- `2`: Hardware transport initialization failed or unhandled exception.
- `3`: All checks were `SKIP` in hardware mode (no hardware verified). Pass `--allow-all-skip` if an all-skip run is intentionally permitted.

---

## The 5 Hardware Checks

| Check Name | Target Subsystem | PASS Criteria | SKIP Condition |
|---|---|---|---|
| `serial_link` | Base & Arm serial links | Serial ports open, connection state `CONNECTED`, ping/query acknowledged | Port not connected / absent, or `pyserial` not installed |
| `wheel_spin_encoders` | 4 mecanum wheels (FL, FR, RL, RR) | Each wheel spins forward with positive encoder delta ($\Delta\text{ticks} > 0$) | `--allow-spin` omitted on hardware, or encoder counts not available from adapter |
| `imu_rate` | 6-DOF / 9-DOF IMU | Publishing rate $\ge 10.0\text{ Hz}$ measured over bounded window from single stream | Transport offline |
| `sts3215_servos` | 6x STS3215 bus servos | All 6 servos respond with valid ID, measured voltage ($6.0\text{--}9.0\text{ V}$), temperature ($< 70^\circ\text{C}$), and position (no fallback defaults) | Arm bus offline or no servos responding |
| `camera_frames` | RGB camera (e.g. `/dev/video0` or OpenCV index) | Minimum 5 consecutive frames received at valid resolution and rate | OpenCV not installed or device missing |

---

## JSON Report Schema

The output JSON report contains:
- `timestamp`: ISO-8601 UTC timestamp
- `robot`: Robot identifier (`"omnibot"`)
- `mode`: `"sim"` or `"hardware"`
- `overall_status`: `"PASS"` (all checks passed or safely skipped), `"FAIL"` (any check failed)
- `summary`: Counts of total, passed, failed, and skipped checks, plus total elapsed duration
- `checks`: Object mapping each check ID to `{name, status, reason, measurements, duration_s}`

### Example JSON Report
```json
{
  "timestamp": "2026-10-03T12:00:00.000000+00:00",
  "robot": "omnibot",
  "mode": "sim",
  "overall_status": "PASS",
  "summary": {
    "total": 5,
    "passed": 5,
    "failed": 0,
    "skipped": 0,
    "duration_s": 0.05
  },
  "checks": {
    "serial_link": {
      "name": "serial_link",
      "status": "PASS",
      "reason": "Simulated communication link active and responding",
      "measurements": {
        "protocol": "simulated",
        "state": "connected",
        "latency_ms": 0.0
      },
      "duration_s": 0.001
    },
    "wheel_spin_encoders": {
      "name": "wheel_spin_encoders",
      "status": "PASS",
      "reason": "All 4 wheels (front_left, front_right, rear_left, rear_right) spun with positive encoder counts in expected direction",
      "measurements": {
        "wheels": {
          "front_left": {
            "commanded_speed": 50,
            "start_ticks": 0,
            "end_ticks": 125,
            "delta_ticks": 125,
            "direction": "forward",
            "ok": true
          },
          "front_right": {
            "commanded_speed": 50,
            "start_ticks": 0,
            "end_ticks": 125,
            "delta_ticks": 125,
            "direction": "forward",
            "ok": true
          },
          "rear_left": {
            "commanded_speed": 50,
            "start_ticks": 0,
            "end_ticks": 125,
            "delta_ticks": 125,
            "direction": "forward",
            "ok": true
          },
          "rear_right": {
            "commanded_speed": 50,
            "start_ticks": 0,
            "end_ticks": 125,
            "delta_ticks": 125,
            "direction": "forward",
            "ok": true
          }
        },
        "all_ok": true
      },
      "duration_s": 0.02
    },
    "imu_rate": {
      "name": "imu_rate",
      "status": "PASS",
      "reason": "IMU publishing nominally at 20.0 Hz (expected >= 10.0 Hz)",
      "measurements": {
        "rate_hz": 20.0,
        "min_expected_hz": 10.0,
        "samples_received": 10,
        "window_s": 0.5
      },
      "duration_s": 0.005
    },
    "sts3215_servos": {
      "name": "sts3215_servos",
      "status": "PASS",
      "reason": "All 6 STS3215 servos responding (id, voltage, temperature, position)",
      "measurements": {
        "servos": [
          {"id": 1, "name": "arm_shoulder_pan", "voltage": 7.4, "temperature": 29.2, "position": 0.0, "online": true},
          {"id": 2, "name": "arm_shoulder_lift", "voltage": 7.4, "temperature": 30.1, "position": 0.0, "online": true},
          {"id": 3, "name": "arm_elbow_flex", "voltage": 7.4, "temperature": 28.8, "position": 0.0, "online": true},
          {"id": 4, "name": "arm_wrist_flex", "voltage": 7.4, "temperature": 27.9, "position": 0.0, "online": true},
          {"id": 5, "name": "arm_wrist_roll", "voltage": 7.4, "temperature": 28.4, "position": 0.0, "online": true},
          {"id": 6, "name": "arm_gripper", "voltage": 7.4, "temperature": 27.5, "position": 0.0, "online": true}
        ],
        "count": 6,
        "all_responding": true
      },
      "duration_s": 0.002
    },
    "camera_frames": {
      "name": "camera_frames",
      "status": "PASS",
      "reason": "Camera frame stream active (5 frames received, 640x480 at 30.0 fps)",
      "measurements": {
        "frames_received": 5,
        "width": 640,
        "height": 480,
        "fps": 30.0,
        "camera_id": "sim_camera"
      },
      "duration_s": 0.01
    }
  }
}
```

---

## What It Does Not Do

To keep self-test focused, robust, and safe on benchbring-up:
1. **No firmware flashing**: Flashing STM32 motor controllers or servo EEPROM remains a dedicated procedure (e.g. through ST-Link or Yahboom ISP tools).
2. **No guided assembly**: Assembly step checklists and CAD viewer walkthroughs remain in the OhhO Bench console.
3. **No destructive torque testing**: Servos are polled for status without commanding excessive loads or driving past limit stops.

---

## Real-Robot Run: Status

- **Software Implementation**: Complete & verified (unit tests + simulation mode in CI).
- **Real-robot run**: **Pending (Varun)** on physical OmniBot hardware.
