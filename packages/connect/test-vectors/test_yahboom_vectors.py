"""Golden-byte checks for packages/connect/test-vectors/yahboom-packets.json.

Run with: python -m pytest packages/connect/test-vectors/test_yahboom_vectors.py

When ohho-os ships packages/yahboom_ros2/protocol.py, import its builders here
instead of the inline mirror below.
"""

from __future__ import annotations

import json
from pathlib import Path

VECTORS_PATH = Path(__file__).with_name("yahboom-packets.json")

HEAD_TX = 0xFF
DEVICE_ID = 0xFC


def _clamp_int16(v: float) -> int:
    return max(-32768, min(32767, int(round(v))))


def _int16le(v: float) -> tuple[int, int]:
    x = _clamp_int16(v) & 0xFFFF
    return x & 0xFF, (x >> 8) & 0xFF


def build_packet(func: int, payload: list[int]) -> list[int]:
    length = len(payload) + 3
    before = [HEAD_TX, DEVICE_ID, length, func, *payload]
    checksum = (sum(before) + 5) & 0xFF
    return [*before, checksum]


def packet_set_car_type(car_type: int = 1) -> list[int]:
    return build_packet(0x15, [car_type & 0xFF])


def packet_motion(vx: float, vy: float, omega: float, car_type: int = 1) -> list[int]:
    payload = [
        car_type & 0xFF,
        *_int16le(vx * 1000),
        *_int16le(vy * 1000),
        *_int16le(omega * 1000),
    ]
    return build_packet(0x12, payload)


def packet_beep(ms: float) -> list[int]:
    return build_packet(0x02, list(_int16le(ms)))


BUILDERS = {
    "buildPacket": lambda v: build_packet(int(v["func"]), list(v["payload"])),
    "packetSetCarType": lambda v: packet_set_car_type(int(v["args"][0])),
    "packetMotion": lambda v: packet_motion(
        float(v["args"][0]), float(v["args"][1]), float(v["args"][2])
    ),
    "packetBeep": lambda v: packet_beep(float(v["args"][0])),
}


def test_yahboom_packet_vectors() -> None:
    data = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))
    for entry in data["vectors"]:
        builder = BUILDERS[entry["fn"]]
        got = builder(entry)
        want = entry["bytes"]
        assert got == want, f"{entry['id']}: expected {want}, got {got}"
