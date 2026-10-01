"""Fail if pyproject.toml lists a classifier trove-classifiers does not know."""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path

import trove_classifiers


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    project = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    classifiers = project.get("classifiers", [])
    unknown = [item for item in classifiers if item not in trove_classifiers.classifiers]
    if unknown:
        print("unknown trove classifiers:", file=sys.stderr)
        for item in unknown:
            print(f"  {item}", file=sys.stderr)
        return 1
    print(f"{len(classifiers)} classifiers are known to trove-classifiers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
