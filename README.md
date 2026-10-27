# ohho-sdk

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

TypeScript client SDK for OhhO robots: `@ohho/connect`, `@ohho/schemas`, and `@ohho/client`.

MCP tools are split per [docs/mcp-split.md](docs/mcp-split.md) (hosted console vs on-robot `ohho mcp`).

**Engine:** [ohho-os](https://github.com/ohho-robotics/ohho-os) · **Client SDK:** [ohho-sdk](https://github.com/ohho-robotics/ohho-sdk)

Licensed under Apache-2.0 ([LICENSE](LICENSE)).

## Moved from the old ohho-sdk repository

The Python `ohho/` engine (PyPI package `ohho-os`) now lives in [ohho-robotics/ohho-os](https://github.com/ohho-robotics/ohho-os). This repository is the TypeScript client only. Old clone URLs and paths under the former `ohho-sdk` name remain reachable via GitHub redirects and history.

## Versioning

**SDK semver** (npm packages in this repo) and **protocol version**
(`PINNED_PROTOCOL_VERSION` in `@ohho/schemas`) are independent from **ohho-os**
(PyPI). Releasing one does not require releasing the other.

| ohho-os | Protocol | ohho-sdk (`@ohho/schemas`) |
| --- | --- | --- |
| 1.1.3+ | 1.0.0 | 1.0.0+ |

Transport JSON schemas are vendored under `packages/schemas/vendor/ohho-os/`.
Regenerate TypeScript after updating the pin:

```bash
npm run codegen:schemas
```

CI runs `npm run codegen:schemas -- --check` so generated types cannot drift from
the pinned protocol.

## Develop

```bash
npm ci
npm run codegen:schemas
npm test
npm run build
npm run demo   # SimulatedTransport smoke (after build)
```

## Telemetry schema (ohho.telemetry.v1)

`@ohho/schemas` also publishes **ohho.telemetry.v1**: telemetry, a safety-state
sample, and heartbeat plus echo. It is independent of `PINNED_PROTOCOL_VERSION`.
Units are SI and radians (milliseconds and degrees Celsius are named exceptions).
Minor versions only add optional fields; major versions break. See
`packages/schemas/README.md`.

```bash
npm run codegen:telemetry
npm run codegen:telemetry -- --check
```

Generated C# (`Ohho.Schemas`, Newtonsoft, netstandard2.1) is under
`generated/csharp/`, and Python (pydantic v2) is under `generated/python/`.
CI checks those outputs, validates the golden vectors in Python, and builds and
tests the C#.
