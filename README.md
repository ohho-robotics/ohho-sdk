# OhhO OS

Python package `ohho-os` (import `ohho`), version 1.1.1. The `ohho` console
script is installed by `pip install -e .`.

[![CI](https://github.com/ohho-robotics/ohho-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/ohho-robotics/ohho-sdk/actions/workflows/ci.yml)

The badge reads `.github/workflows/ci.yml` on
[ohho-robotics/ohho-sdk](https://github.com/ohho-robotics/ohho-sdk).
That workflow has not run for this tree yet.

## Three commands

```bash
pip install -e .
ohho doctor
ohho sim --robot omnibot --seconds 2
```

`pip install -e .` installs the dependency-free base (stdlib only) and the
`ohho` script. `ohho doctor` prints the interpreter, the runtimes and
adapters it can import, and the built-in robot ids. `ohho sim` connects
with transport `sim://` and runtime `native`, then drives an in-process
pattern for the given number of seconds.

On this machine (Python 3.12.3, Linux, base install) both commands exited 0.
`ohho doctor` reported runtime `native`, adapter `sim`, and robots
`omnibot`, `sim`, `unitree-go2`.

## Tests

```bash
python -m unittest discover -s tests
```

Same environment as above:

```
Ran 197 tests in 22.971s
OK (skipped=18)
```

The 18 skips were: 4 hardware-in-the-loop tests (`OHHO_HIL` unset),
13 tests that need `agent_engine` and numpy, and 1 test that needs
fastapi (`[serve]`). No failures.

CI runs that discover command, then `ohho doctor` and
`ohho sim --robot omnibot --seconds 2`, on Ubuntu, macOS, and Windows
for Python 3.10, 3.11, 3.12, and 3.13. This commit does not include a
GitHub Actions result for those cells.

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

Those adapters are not installed by `pip install -e .`. The extras are
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

TODO. Varun decides the licence in OHH-18. `pyproject.toml` does not set
`license`. The `LICENSE` file states the same gap. Do not treat earlier
commits that still contain an Apache-2.0 `LICENSE` as the licence of
this tree.

## Releasing

```bash
git tag v1.1.1
git push origin v1.1.1
```

`v1.1.1` matches `version` in `pyproject.toml`. `.github/workflows/release.yml` runs on tags matching `v*`. It fails the release when the tag version and that `version` differ, builds the sdist and wheel with `python -m build`, runs `twine check`, and publishes to PyPI with trusted publishing (`pypa/gh-action-pypi-publish`, `environment: pypi`, no API token). A following job, in a fresh virtualenv on Ubuntu and macOS, retries `pip install ohho-os==<tag version>` until that version is installable, then runs `ohho doctor`.

No tag has been pushed for this tree, and nothing has been published. `pyproject.toml` does not set `license` (OHH-18), so PyPI metadata will not include a licence until that decision lands.
