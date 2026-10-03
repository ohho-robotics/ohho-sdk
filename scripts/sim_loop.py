#!/usr/bin/env python3
"""Run the nightly CPU sim loop: Record -> Validate -> Train ACT -> Serve -> Drive sim.

Reproduce locally with:
    python scripts/sim_loop.py
    # or
    ohho sim-loop
"""

from __future__ import annotations

import sys
from ohho.sim_loop import main

if __name__ == "__main__":
    sys.exit(main())
