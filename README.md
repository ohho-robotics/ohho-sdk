# OhhO OS

Python package `ohho-os` (import `ohho`), version 1.1.3.
Homepage: [ohho-robotics.com](https://ohho-robotics.com).
Source: [ohho-robotics/ohho-sdk](https://github.com/ohho-robotics/ohho-sdk).

[![CI](https://github.com/ohho-robotics/ohho-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/ohho-robotics/ohho-sdk/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

## Install

```bash
pip install ohho-os
ohho doctor
ohho sim --robot omnibot --seconds 2
```

`pip install ohho-os` installs the dependency-free base (stdlib only) and the
`ohho` console script. `ohho doctor` prints the interpreter, the runtimes and
adapters it can import, and the built-in robot ids. `ohho sim` connects with
transport `sim://` and runtime `native`, then drives an in-process pattern for
the given number of seconds.

From a git checkout, `pip install -e .` is the same base install, editable.

CI (`.github/workflows/ci.yml`) runs `python -m unittest discover -s tests`,
then `ohho doctor` and `ohho sim --robot omnibot --seconds 2`, on Ubuntu,
macOS, and Windows for Python 3.10, 3.11, 3.12, and 3.13. That workflow is
green on `main`. Tag `v1.1.2` published `ohho-os` 1.1.2 to PyPI.

## Tests

```bash
python -m unittest discover -s tests
```

On Python 3.12.3, Linux, base install (no extras):

```
Ran 197 tests in 23.041s
OK (skipped=18)
```

The 18 skips were: 4 hardware-in-the-loop tests (`OHHO_HIL` unset),
13 tests that need `agent_engine` and numpy, and 1 test that needs
fastapi (`[serve]`). No failures. A missing `rclpy` is logged from a
background ROS 2 runtime thread; the suite still exits 0.

## Needs hardware

`ohho doctor`, `ohho sim --robot omnibot`, and the default test run do
not open a serial port, a camera, or a GPU. The simulator is in-process.

`tests/hil/` talks to real robots. Every test in that package is
skipped unless `OHHO_HIL=1`. The ports they use:

| Test | Device | Environment variable | Default |
|---|---|---|---|
| OmniBot base | Yahboom serial | `OHHO_OMNIBOT_PORT` | `/dev/ttyUSB0` |
| OmniBot arm | Feetech bus | `OHHO_OMNIBOT_ARM` | `/dev/ttyACM0` |
| OmniBot base + arm | both of the above | both | both defaults |
| Unitree Go2 | DDS interface | `OHHO_GO2_IFACE` | `eth0` |

Those adapters are not installed by `pip install ohho-os`. The extras are
`serial` (pyserial), `arm` (lerobot), and `unitree` (cyclonedds). The
`ros2` extra does not pip-install `rclpy`; that module comes from a ROS 2
distro. `train` needs torch. None of those were installed for the test
run above.

## TypeScript

`ts/` is the previous TypeScript workspace (`package.json`,
`tsconfig.json`, `packages/`), moved with the same file contents. It does
not typecheck. `tsc --noEmit -p ts/tsconfig.json` (TypeScript 5.6.3)
exits with 246 `error TS` diagnostics, including missing modules
(`react`, `vitest`, `@/lib/...`) and files that are not in this tree
(`packages/schemas/src/types.ts`, `packages/schemas/src/robot-catalog.ts`).
See `ts/AGENTS.md`. Paths in that file still describe the old repository
root.

## Licence

Apache-2.0. The full text is [`LICENSE`](LICENSE).

## Releasing

```bash
git tag v1.1.3
git push origin v1.1.3
```

The tag version must match `version` in `pyproject.toml`.
`.github/workflows/release.yml` runs on tags matching `v*`. It fails the
release when those versions differ, checks every classifier against
`trove-classifiers`, builds the sdist and wheel with `python -m build`,
runs `twine check`, and publishes to PyPI with trusted publishing
(`pypa/gh-action-pypi-publish`, `environment: pypi`, no API token). A
following job, in a fresh virtualenv on Ubuntu and macOS, retries
`pip install ohho-os==<tag version>` until that version is installable,
then runs `ohho doctor`.

`ohho-os` 1.1.2 is the release already on PyPI (tag `v1.1.2`). Tag
`v1.1.1` points at `286d408` and was not published: PyPI returned 400
because `Topic :: Scientific/Engineering :: Robotics` is not a trove
classifier.
