# ohho-sdk

TypeScript client SDK for OhhO robots: `@ohho/connect`, `@ohho/schemas`, and `@ohho/client`.

MCP tools are split per [docs/mcp-split.md](docs/mcp-split.md) (hosted console vs on-robot `ohho mcp`).

Engine / on-robot OS: https://github.com/ohho-robotics/ohho-os

Licensed under Apache-2.0.

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
