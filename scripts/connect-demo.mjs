/**
 * Smoke demo: connect via SimulatedTransport, drive briefly, print telemetry.
 * Requires `npm run build` first (loads compiled @ohho/connect + @ohho/schemas).
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTransport } = require("../packages/connect/dist/index.js");
const { defaultRobotConfig } = require("../packages/schemas/dist/index.js");

async function main() {
  const robot = defaultRobotConfig();
  const transport = createTransport(robot, { protocol: "simulated" });

  const status = await transport.connect();
  if (status.state !== "connected") {
    console.error("Demo failed: expected connected, got", status.state);
    process.exit(1);
  }

  let snapshot = null;
  transport.onTelemetry((t) => {
    if (t.odom) snapshot = t;
  });

  transport.sendVelocity({ linearX: 0.25, linearY: 0, angularZ: 0.1 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  transport.disconnect();

  const odom = snapshot?.odom;
  console.log(
    JSON.stringify(
      {
        protocol: status.protocol,
        label: status.label,
        odom: odom ?? null,
      },
      null,
      2,
    ),
  );

  if (!odom) {
    console.error("Demo failed: no odometry telemetry received");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
