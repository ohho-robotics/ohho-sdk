## Cursor Cloud specific instructions

`ohho-sdk` is an npm-workspaces TypeScript library with four packages: `@ohho/schemas`, `@ohho/connect`, `@ohho/mcp`, and `@ohho/client`. Nothing in this repo is a long-running service. There is no dev server, Docker Compose stack, env file, or root npm script. Dependency refresh is `npm install` from the repository root (no lockfile is committed).

Build and lint scripts live on each package in `packages/*/package.json`.

- `npm run build --workspace=@ohho/<pkg>` runs `tsc`. The only TypeScript config is the root `tsconfig.json`, which has no `include`. `tsc` therefore typechecks every package together, and with `noEmitOnError` unset it writes `.js` and `.d.ts` files beside the sources. Delete that emit; it is not source. Compilation fails because sources import `@/lib/...` plus `packages/schemas/src/types.ts`, `packages/schemas/src/robot-catalog.ts`, and `packages/mcp/src/types.ts`, which are not in this extract. `packages/connect/src/RobotConnectionProvider.tsx` also needs React and a `jsx` compiler option. These modules typecheck on their own when passed as file arguments to `tsc`: `packages/client`, `packages/connect/src/yahboom.ts`, `packages/connect/src/protocols.ts`, `packages/connect/src/types.ts`, and `packages/schemas/src/market-skills.ts`.
- `npm run lint --workspace=@ohho/<pkg>` runs `eslint .`. ESLint is not a dependency and there is no ESLint config, so the script exits with code 127.
- There is no `npm test` script. The only test file, `packages/connect/src/connect.test.ts`, imports Vitest (undeclared) and `@/lib/garage/*`.

The path that executes today is the Connect simulated robot plus the Yahboom packet encoder. Garage imports in `packages/connect/src/factory.ts` and `packages/connect/src/simulated.ts` are type-only, so `npx tsx` can load `createTransport`, call `connect`, `sendVelocity`, `sendJointCommand`, and `emergencyStop`, and read telemetry. `packages/connect/src/config.ts` value-imports `@/lib/garage/client` and will not load. `getSkill` from `packages/schemas/src/market-skills.ts` loads the same way. `@ohho/client` exports an empty `OhhOClient` class.
