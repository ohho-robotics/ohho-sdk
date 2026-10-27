## Cursor Cloud specific instructions

`ohho-sdk` is an npm-workspaces TypeScript library with three packages: `@ohho/schemas`, `@ohho/connect`, and `@ohho/client`. MCP tool code lives in the private console repo and in ohho-os (`ohho mcp`); see `docs/mcp-split.md`.

From the repository root:

- `npm ci` — install dependencies (lockfile committed).
- `npm run typecheck` — project references build / typecheck all packages.
- `npm run build` — emit compiled output to each package's `dist/`.
- `npm test` — Vitest (schemas, connect simulated transport, client).
- `npm run lint` — ESLint per workspace.
- `npm run demo` — runs `scripts/connect-demo.mjs` against **SimulatedTransport** (requires build first).
- `packages/connect/test-vectors/yahboom-packets.json` — shared golden bytes for TS (Vitest) and optional Python (`test_yahboom_vectors.py`).

Publishing `@ohho/connect`, `@ohho/schemas`, and `@ohho/client` is manual; see `.github/workflows/release.yml`. This workspace does not ship `@ohho/mcp`.
