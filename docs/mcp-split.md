# MCP split (OHH-173)

OhhO MCP tools are split by **where they execute**:

- **Hosted** tools run on the private [console](https://github.com/ohho-robotics/console.ohho-robotics.com) (`POST /api/mcp`). They use garage, fleet, marketplace, training, and other cloud-backed consoles.
- **On-robot** tools run on the device via [OhhO OS](https://github.com/ohho-robotics/ohho-os) (`ohho mcp`, stdio MCP).

The public **ohho-sdk** npm workspace no longer ships `@ohho/mcp` tool implementations.

## Classification (20 product modules)

| Module | Placement | Runs on | Notes |
|--------|-----------|---------|-------|
| `garage` | Hosted | Console | User robot registry, garage CRUD |
| `market` | Hosted | Console | Skill marketplace catalog, install/purchase |
| `fleet` | Hosted | Console | Fleet health, OTA, alerts |
| `train` | Hosted | Console | Training jobs, checkpoints, sweeps |
| `twin` | Hosted | Console | Digital twin state and what-if |
| `care` | Hosted | Console | Maintenance work orders, fleet metrics |
| `shield` | Hosted | Console | Fleet security, CVEs, quarantine |
| `comply` | Hosted | Console | Standards, audit packages |
| `proof` | Hosted | Console | Safety verification suites |
| `build` | Hosted | Console | Robot design, BOM, templates |
| `view` | Hosted | Console | Visualization layers and recording |
| `mind` | Hosted | Console | Assistant memory/goals (OpenRouter) |
| `connect` | On-robot | OhhO OS | Live transport, telemetry, velocity, e-stop |
| `bridge` | On-robot | OhhO OS | Protocol adapters and joint maps |
| `frame` | On-robot | OhhO OS | On-device process / runtime surface |
| `bench` | On-robot | OhhO OS | Bench flash, calibration, self-test |
| `serve` | On-robot | OhhO OS | On-robot policy inference / deploy |
| `data` | On-robot | OhhO OS | Local episodes and dataset export |
| `autonomy` | On-robot | OhhO OS | Missions and navigation |
| `pilot` | On-robot | OhhO OS | Teleop and arm commands |

## Repositories

| Repo | MCP role |
|------|----------|
| `console.ohho-robotics.com` (private) | `lib/<product>/mcp-tools.ts`, `lib/mcp/registry.ts` (hosted subset on `/api/mcp`) |
| `ohho-os` | `ohho/mcp_server.py`, `ohho mcp` CLI |
| `ohho-sdk` | No tool code — this document and package README pointers only |
