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
```
