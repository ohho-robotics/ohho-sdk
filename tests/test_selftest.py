"""Unit tests for the hardware self-test suite (ohho selftest)."""

from __future__ import annotations

import json
import os
import re
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from ohho.adapters.sim import SimTransport
from ohho.cli import main
from ohho.registry import get_spec
from ohho.schema import ConnectionState, Odometry, Telemetry, TransportStatus
from ohho.selftest import (
    CheckResult,
    check_camera_frames,
    check_imu_rate,
    check_serial_link,
    check_sts3215_servos,
    check_wheel_spin_encoders,
    default_report_path,
    format_report_text,
    run_selftest,
)


class TestSelfTestUnitChecks(unittest.TestCase):
    def setUp(self):
        self.spec = get_spec("omnibot")
        self.sim_tp = SimTransport(self.spec)
        self.sim_tp.connect()

    def tearDown(self):
        self.sim_tp.disconnect()

    # ── Check 1: Serial link ──────────────────────────────────────────────────

    def test_check_serial_link_sim(self):
        res = check_serial_link(self.sim_tp, sim=True)
        self.assertEqual(res.name, "serial_link")
        self.assertEqual(res.status, "PASS")
        self.assertEqual(res.measurements["protocol"], "simulated")
        self.assertEqual(res.measurements["state"], "connected")

    def test_check_serial_link_hardware_missing_pyserial(self):
        with patch.dict("sys.modules", {"serial": None}):
            res = check_serial_link(self.sim_tp, sim=False, base_port="/dev/ttyUSB0")
            self.assertEqual(res.status, "SKIP")
            self.assertIn("pyserial", res.reason)

    def test_check_serial_link_hardware_disconnected(self):
        fake_tp = MagicMock()
        fake_tp.protocol = "serial"
        fake_tp.port = "/dev/nonexistent_port_123"
        fake_tp.status.return_value = TransportStatus(
            protocol="serial",
            state=ConnectionState.DISCONNECTED,
            label="Offline",
        )
        with patch("serial.Serial"):
            res = check_serial_link(
                fake_tp, sim=False, base_port="/dev/nonexistent_port_123"
            )
            self.assertEqual(res.status, "SKIP")
            self.assertIn("not connected", res.reason)

    # ── Check 2: Wheel spin & encoders ────────────────────────────────────────

    def test_check_wheel_spin_safety_locked_skip(self):
        # On hardware without allow_spin, check must SKIP
        res = check_wheel_spin_encoders(self.sim_tp, sim=False, allow_spin=False)
        self.assertEqual(res.status, "SKIP")
        self.assertIn("safety lock", res.reason.lower())
        self.assertTrue(res.measurements.get("safety_locked"))

    def test_check_wheel_spin_sim_pass(self):
        res = check_wheel_spin_encoders(self.sim_tp, sim=True)
        self.assertEqual(res.status, "PASS")
        self.assertTrue(res.measurements["all_ok"])
        wheels = res.measurements["wheels"]
        for w in ["front_left", "front_right", "rear_left", "rear_right"]:
            self.assertIn(w, wheels)
            self.assertGreater(wheels[w]["delta_ticks"], 0)
            self.assertTrue(wheels[w]["ok"])

    def test_check_wheel_spin_wheel_fail(self):
        # Mock transport where rear_right does not increment
        mock_tp = MagicMock()
        encs = {
            "front_left": 100,
            "front_right": 100,
            "rear_left": 100,
            "rear_right": 100,
        }

        def mock_get_enc():
            return dict(encs)

        mock_tp.get_wheel_encoders = mock_get_enc

        # Only increment FL, FR, RL, not RR
        def mock_send_m(fl, fr, rl, rr):
            if fl:
                encs["front_left"] += 50
            if fr:
                encs["front_right"] += 50
            if rl:
                encs["rear_left"] += 50
            # rr doesn't move!

        mock_tp.send_motor = mock_send_m
        res = check_wheel_spin_encoders(mock_tp, sim=True)
        self.assertEqual(res.status, "FAIL")
        self.assertIn("rear_right", res.reason)
        self.assertFalse(res.measurements["all_ok"])

    # ── Check 3: IMU publishing rate ──────────────────────────────────────────

    def test_check_imu_rate_sim(self):
        res = check_imu_rate(self.sim_tp, sim=True)
        self.assertEqual(res.status, "PASS")
        self.assertGreaterEqual(res.measurements["rate_hz"], 10.0)

    def test_check_imu_rate_hardware_pass(self):
        fake_tp = MagicMock()
        fake_tp.get_imu_rate.return_value = 25.0
        res = check_imu_rate(fake_tp, sim=False, min_rate_hz=10.0)
        self.assertEqual(res.status, "PASS")
        self.assertEqual(res.measurements["rate_hz"], 25.0)

    def test_check_imu_rate_hardware_low_fail(self):
        fake_tp = MagicMock()
        fake_tp.get_imu_rate.return_value = 4.5
        res = check_imu_rate(fake_tp, sim=False, min_rate_hz=10.0)
        self.assertEqual(res.status, "FAIL")
        self.assertIn("below minimum", res.reason)

    def test_check_imu_rate_hardware_zero_fail(self):
        fake_tp = MagicMock()
        fake_tp.get_imu_rate.return_value = 0.0
        fake_tp.status.return_value = TransportStatus(
            protocol="serial",
            state=ConnectionState.CONNECTED,
        )
        fake_tp.read.return_value = Telemetry(odom=Odometry())
        res = check_imu_rate(fake_tp, sim=False, min_rate_hz=10.0, sample_window_s=0.05)
        self.assertEqual(res.status, "FAIL")
        self.assertIn("No IMU packets", res.reason)

    # ── Check 4: STS3215 servos ───────────────────────────────────────────────

    def test_check_sts3215_servos_sim(self):
        res = check_sts3215_servos(self.sim_tp, sim=True)
        self.assertEqual(res.status, "PASS")
        self.assertEqual(res.measurements["count"], 6)
        self.assertTrue(res.measurements["all_responding"])
        servos = res.measurements["servos"]
        for s in servos:
            self.assertIn(s["id"], [1, 2, 3, 4, 5, 6])
            self.assertGreaterEqual(s["voltage"], 6.0)
            self.assertLessEqual(s["voltage"], 9.0)
            self.assertLessEqual(s["temperature"], 70.0)
            self.assertTrue(s["online"])

    def test_check_sts3215_servos_voltage_fail(self):
        fake_tp = MagicMock()
        fake_tp.status.return_value = TransportStatus(
            protocol="feetech", state=ConnectionState.CONNECTED
        )
        fake_tp.read_servo_diagnostics.return_value = [
            {
                "id": 1,
                "name": "j1",
                "voltage": 5.2,
                "temperature": 30.0,
                "position": 0.0,
                "online": True,
            },
            {
                "id": 2,
                "name": "j2",
                "voltage": 7.4,
                "temperature": 30.0,
                "position": 0.0,
                "online": True,
            },
            {
                "id": 3,
                "name": "j3",
                "voltage": 7.4,
                "temperature": 30.0,
                "position": 0.0,
                "online": True,
            },
            {
                "id": 4,
                "name": "j4",
                "voltage": 7.4,
                "temperature": 30.0,
                "position": 0.0,
                "online": True,
            },
            {
                "id": 5,
                "name": "j5",
                "voltage": 7.4,
                "temperature": 30.0,
                "position": 0.0,
                "online": True,
            },
            {
                "id": 6,
                "name": "j6",
                "voltage": 7.4,
                "temperature": 30.0,
                "position": 0.0,
                "online": True,
            },
        ]
        res = check_sts3215_servos(fake_tp, sim=False)
        self.assertEqual(res.status, "FAIL")
        self.assertIn("voltage 5.2V out of range", res.reason)

    def test_check_sts3215_servos_temperature_fail(self):
        fake_tp = MagicMock()
        fake_tp.status.return_value = TransportStatus(
            protocol="feetech", state=ConnectionState.CONNECTED
        )
        fake_tp.read_servo_diagnostics.return_value = [
            {
                "id": i,
                "name": f"j{i}",
                "voltage": 7.4,
                "temperature": 75.0 if i == 3 else 30.0,
                "position": 0.0,
                "online": True,
            }
            for i in range(1, 7)
        ]
        res = check_sts3215_servos(fake_tp, sim=False)
        self.assertEqual(res.status, "FAIL")
        self.assertIn("temperature 75.0°C exceeds 70.0°C", res.reason)

    def test_check_sts3215_servos_missing_fail(self):
        fake_tp = MagicMock()
        fake_tp.status.return_value = TransportStatus(
            protocol="feetech", state=ConnectionState.CONNECTED
        )
        # Only 5 servos instead of 6
        fake_tp.read_servo_diagnostics.return_value = [
            {
                "id": i,
                "name": f"j{i}",
                "voltage": 7.4,
                "temperature": 30.0,
                "position": 0.0,
                "online": True,
            }
            for i in range(1, 6)
        ]
        res = check_sts3215_servos(fake_tp, sim=False, expected_count=6)
        self.assertEqual(res.status, "FAIL")
        self.assertIn("Expected 6 servos but received 5", res.reason)

    def test_check_sts3215_servos_disconnected_skip(self):
        fake_tp = MagicMock()
        fake_tp.status.return_value = TransportStatus(
            protocol="feetech", state=ConnectionState.DISCONNECTED
        )
        fake_tp.read_servo_diagnostics.return_value = []
        res = check_sts3215_servos(fake_tp, sim=False)
        self.assertEqual(res.status, "SKIP")
        self.assertIn("arm bus not connected", res.reason)

    # ── Check 5: Camera frames ────────────────────────────────────────────────

    def test_check_camera_frames_sim(self):
        res = check_camera_frames(sim=True, required_frames=5)
        self.assertEqual(res.status, "PASS")
        self.assertEqual(res.measurements["frames_received"], 5)
        self.assertEqual(res.measurements["width"], 640)
        self.assertEqual(res.measurements["height"], 480)

    def test_check_camera_frames_missing_cv2(self):
        with patch.dict("sys.modules", {"cv2": None}):
            res = check_camera_frames(sim=False)
            self.assertEqual(res.status, "SKIP")
            self.assertIn("OpenCV", res.reason)

    def test_check_camera_frames_capture_mock(self):
        mock_cv2 = MagicMock()
        mock_cap = MagicMock()
        mock_cap.isOpened.return_value = True
        fake_frame = MagicMock()
        fake_frame.size = 640 * 480 * 3
        fake_frame.shape = (480, 640, 3)
        mock_cap.read.return_value = (True, fake_frame)
        mock_cv2.VideoCapture.return_value = mock_cap

        with patch.dict("sys.modules", {"cv2": mock_cv2}):
            res = check_camera_frames(sim=False, required_frames=3)
            self.assertEqual(res.status, "PASS")
            self.assertEqual(res.measurements["frames_received"], 3)
            self.assertEqual(res.measurements["width"], 640)
            self.assertEqual(res.measurements["height"], 480)
            mock_cap.release.assert_called_once()


class TestSelfTestReportAndRunner(unittest.TestCase):
    def test_default_report_path_format(self):
        p = default_report_path()
        self.assertTrue(re.match(r"^selftest-\d{8}-\d{6}\.json$", p))

    def test_run_selftest_sim_end_to_end(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_file = os.path.join(tmpdir, "test-report.json")
            report = run_selftest(
                robot="omnibot",
                sim=True,
                allow_spin=True,
                out_path=out_file,
            )
            self.assertEqual(report.robot, "omnibot")
            self.assertEqual(report.mode, "sim")
            self.assertEqual(report.overall_status, "PASS")
            self.assertEqual(report.summary["total"], 5)
            self.assertEqual(report.summary["passed"], 5)
            self.assertEqual(report.summary["failed"], 0)
            self.assertEqual(report.summary["skipped"], 0)

            # Check that all 5 checks are present in the report
            expected_checks = {
                "serial_link",
                "wheel_spin_encoders",
                "imu_rate",
                "sts3215_servos",
                "camera_frames",
            }
            self.assertEqual(set(report.checks.keys()), expected_checks)

            # Verify saved JSON on disk
            self.assertTrue(os.path.exists(out_file))
            with open(out_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.assertEqual(data["overall_status"], "PASS")
            self.assertEqual(data["summary"]["passed"], 5)
            self.assertIn("serial_link", data["checks"])

    def test_format_report_text(self):
        report = run_selftest("omnibot", sim=True)
        txt = format_report_text(report)
        self.assertIn("OhhO OS Hardware Self-Test Report", txt)
        self.assertIn("[PASS] serial_link", txt)
        self.assertIn("[PASS] wheel_spin_encoders", txt)
        self.assertIn("[PASS] imu_rate", txt)
        self.assertIn("[PASS] sts3215_servos", txt)
        self.assertIn("[PASS] camera_frames", txt)
        self.assertIn("Summary: 5 passed", txt)

    def test_cli_selftest_sim(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_file = os.path.join(tmpdir, "cli-report.json")
            code = main(["selftest", "--sim", "--out", out_file])
            self.assertEqual(code, 0)
            self.assertTrue(os.path.exists(out_file))

    def test_cli_selftest_failure_exit_code(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_file = os.path.join(tmpdir, "fail-report.json")
            # Force a check to FAIL
            with patch("ohho.selftest.check_wheel_spin_encoders") as mock_wheel:
                mock_wheel.return_value = CheckResult(
                    name="wheel_spin_encoders",
                    status="FAIL",
                    reason="Motor encoder wire disconnected",
                )
                code = main(["selftest", "--sim", "--out", out_file])
                self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
