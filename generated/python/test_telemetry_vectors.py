"""Validate ohho.telemetry.v1 golden vectors with JSON Schema and the generated pydantic models."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError as SchemaError
from pydantic import ValidationError
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = ROOT / "packages" / "schemas" / "ohho.telemetry.v1"
VECTORS = SCHEMA_DIR / "vectors"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ohho_schemas.telemetry_v1 import (  # noqa: E402
    Heartbeat,
    HeartbeatEcho,
    SafetyState,
    TelemetryV1,
)

SCHEMA_FILES = (
    "defs.json",
    "heartbeat.json",
    "heartbeat_echo.json",
    "safety_state.json",
    "telemetry.json",
)
KINDS = {
    "telemetry": (TelemetryV1, "telemetry.json"),
    "safety_state": (SafetyState, "safety_state.json"),
    "heartbeat": (Heartbeat, "heartbeat.json"),
    "heartbeat_echo": (HeartbeatEcho, "heartbeat_echo.json"),
}


def load_registry() -> tuple[dict[str, dict], Registry]:
    schemas: dict[str, dict] = {}
    resources = []
    for name in SCHEMA_FILES:
        document = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
        schemas[name] = document
        resources.append((document["$id"], Resource.from_contents(document)))
    return schemas, Registry().with_resources(resources)


def vector_paths(kind: str, bucket: str) -> list[Path]:
    paths = sorted((VECTORS / kind / bucket).glob("*.json"))
    if not paths:
        raise SystemExit(f"no {bucket} vectors for {kind}")
    return paths


def main() -> None:
    schemas, registry = load_registry()
    valid_ok = 0
    invalid_ok = 0
    for kind, (model, schema_name) in KINDS.items():
        validate = Draft202012Validator(schemas[schema_name], registry=registry)
        for path in vector_paths(kind, "valid"):
            instance = json.loads(path.read_text(encoding="utf-8"))
            validate.validate(instance)
            parsed = model.model_validate(instance)
            if kind in ("telemetry", "safety_state"):
                allowed = parsed.safety_flags_allow_motion()
                expect_allow = kind == "telemetry" and path.name == "full.json"
                if allowed is not expect_allow:
                    raise SystemExit(f"safety flag mismatch for {path}: {allowed}")
            valid_ok += 1
        for path in vector_paths(kind, "invalid"):
            instance = json.loads(path.read_text(encoding="utf-8"))
            try:
                validate.validate(instance)
            except SchemaError:
                pass
            else:
                raise SystemExit(f"jsonschema accepted invalid vector {path}")
            try:
                model.model_validate(instance)
            except ValidationError:
                pass
            else:
                raise SystemExit(f"pydantic accepted invalid vector {path}")
            invalid_ok += 1

    heartbeat = Heartbeat.model_validate(
        json.loads((VECTORS / "heartbeat" / "valid" / "typical.json").read_text(encoding="utf-8"))
    )
    echo = HeartbeatEcho.from_heartbeat(heartbeat, 1735689601.5)
    assert echo.seq == heartbeat.seq
    assert echo.t_client == heartbeat.t_client
    assert echo.v == heartbeat.v
    assert echo.t == 1735689601.5
    try:
        HeartbeatEcho.from_heartbeat(heartbeat, -1)
    except ValueError:
        pass
    else:
        raise SystemExit("negative server time was accepted")

    clear = SafetyState.model_validate(
        json.loads((VECTORS / "safety_state" / "valid" / "clear.json").read_text(encoding="utf-8"))
    )
    assert clear.safety_flags_allow_motion() is False
    latched = SafetyState.model_validate(
        json.loads((VECTORS / "safety_state" / "valid" / "latched.json").read_text(encoding="utf-8"))
    )
    assert latched.safety_flags_allow_motion() is False

    print(f"python telemetry vectors: {valid_ok} valid accepted, {invalid_ok} invalid rejected")


if __name__ == "__main__":
    main()
