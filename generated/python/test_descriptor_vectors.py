"""Validate ohho.descriptor.v1 golden vectors with JSON Schema and the generated pydantic models."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError as SchemaError
from pydantic import ValidationError
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = ROOT / "packages" / "schemas" / "ohho.descriptor.v1"
VECTORS = SCHEMA_DIR / "vectors" / "descriptor"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ohho_schemas.descriptor_v1 import RobotDescriptor  # noqa: E402

SCHEMA_FILES = ("defs.json", "descriptor.json")
SCHEMA_NAME = "descriptor.json"
OMNIBOT_CEILINGS = {
    "max_vx_mps": 0.2,
    "max_vy_mps": 0.2,
    "max_wz_rad_s": 1.0,
    "max_accel_x_mps2": 0.5,
    "max_accel_y_mps2": 0.5,
    "max_accel_wz_rad_s2": 2.0,
    "max_joint_step_rad": 0.15,
}


def load_registry() -> tuple[dict[str, dict], Registry]:
    schemas: dict[str, dict] = {}
    resources = []
    for name in SCHEMA_FILES:
        document = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
        schemas[name] = document
        resources.append((document["$id"], Resource.from_contents(document)))
    return schemas, Registry().with_resources(resources)


def vector_paths(bucket: str) -> list[Path]:
    paths = sorted((VECTORS / bucket).glob("*.json"))
    if not paths:
        raise SystemExit(f"no {bucket} descriptor vectors")
    return paths


def main() -> None:
    schemas, registry = load_registry()
    hard = schemas["defs.json"]["$defs"]["HardSafetyCaps"]["properties"]
    for key, ceiling in OMNIBOT_CEILINGS.items():
        if hard[key]["maximum"] != ceiling:
            raise SystemExit(f"{key} maximum {hard[key]['maximum']} is above {ceiling}")

    validate = Draft202012Validator(schemas[SCHEMA_NAME], registry=registry)
    valid_ok = 0
    invalid_ok = 0
    for path in vector_paths("valid"):
        instance = json.loads(path.read_text(encoding="utf-8"))
        validate.validate(instance)
        RobotDescriptor.model_validate(instance)
        valid_ok += 1
    for path in vector_paths("invalid"):
        instance = json.loads(path.read_text(encoding="utf-8"))
        try:
            validate.validate(instance)
        except SchemaError:
            pass
        else:
            raise SystemExit(f"jsonschema accepted invalid vector {path}")
        try:
            RobotDescriptor.model_validate(instance)
        except ValidationError:
            pass
        else:
            raise SystemExit(f"pydantic accepted invalid vector {path}")
        invalid_ok += 1

    omnibot = RobotDescriptor.model_validate(
        json.loads((VECTORS / "valid" / "omnibot.json").read_text(encoding="utf-8"))
    )
    if omnibot.id != "omnibot" or omnibot.safety.hard.max_vx_mps != 0.2:
        raise SystemExit("OmniBot descriptor drifted above the 0.2 m/s linear cap")
    if omnibot.safety.hard.max_joint_step_rad != 0.15:
        raise SystemExit("OmniBot joint step drifted above 0.15 rad")
    if omnibot.arms[0].joints[-1].max != 0.8:
        raise SystemExit("gripper max drifted above 0.8 rad")
    if omnibot.apriltags:
        raise SystemExit("OmniBot descriptor invented an AprilTag")

    print(f"python descriptor vectors: {valid_ok} valid accepted, {invalid_ok} invalid rejected")


if __name__ == "__main__":
    main()
