# Changelog

All notable changes to **ohho-sdk** (npm packages `@ohho/connect`, `@ohho/schemas`,
`@ohho/client`) are documented here. The Python engine is versioned independently
in [ohho-os](https://github.com/ohho-robotics/ohho-os).

## [1.0.0] - unreleased

### Added

- **Protocol version** — `@ohho/schemas` exports `PINNED_PROTOCOL_VERSION`,
  `SUPPORTED_PROTOCOL_VERSIONS`, and `assertProtocolCompatible`.
- **Generated transport types** — from a pinned copy of ohho-os `schemas/` via
  `npm run codegen:schemas` (enforced in CI with `--check`).
- **Connect-time check** — `@ohho/connect` `connectTransport()` validates protocol
  before opening a transport; `RobotConnectionProvider` uses it.
