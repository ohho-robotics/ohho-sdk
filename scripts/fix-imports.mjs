import fs from "fs";
import path from "path";

const root = "C:/Users/varun/ohho/sdk-ohh-172/packages";

const libMap = {
  "@/lib/mcp/types": null, // special per file
  "@/lib/twin/twin-data": "./lib/twin/twin-data",
  "@/lib/shield/security": "./lib/shield/security",
  "@/lib/serve/models": "./lib/serve/models",
  "@/lib/serve/inference": "./lib/serve/inference",
  "@/lib/proof/proof-data": "./lib/proof/proof-data",
  "@/lib/pilot/robots": "./lib/pilot/robots",
  "@/lib/pilot/teleop": "./lib/pilot/teleop",
  "@/lib/fleet/fleet": "./lib/fleet/fleet",
  "@/lib/care/care-data": "./lib/care/care-data",
  "@/lib/build/catalog": "./lib/build/catalog",
  "@/lib/build/design": "./lib/build/design",
  "@/lib/build/engine": "./lib/build/engine",
  "@/lib/bridge/adapters": "./lib/bridge/adapters",
  "@/lib/market/skills": "@ohho/schemas",
  "@/lib/garage/types": "@ohho/schemas",
  "@/lib/garage/robot-catalog": "@ohho/schemas",
  "@/lib/garage/robot-config": "@ohho/schemas",
  "@/lib/garage/client": "@ohho/schemas",
  "@/lib/connect/protocols": "@ohho/connect",
  "@/lib/connect/config": "@ohho/connect",
  "@/lib/connect/types": "@ohho/connect",
  "@/lib/products": "./products",
  "@/lib/comply/standards": null,
};

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else if (/\.tsx?$/.test(ent.name)) files.push(p);
  }
  return files;
}

function mcpTypesImport(file) {
  const rel = path.relative(path.dirname(file), path.join(root, "mcp/src/types"));
  let imp = rel.replace(/\\/g, "/");
  if (!imp.startsWith(".")) imp = "./" + imp;
  return imp;
}

for (const file of walk(root)) {
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes("@/lib")) continue;

  if (file.includes("comply-mcp-tools")) {
    text = text.replace(
      'import { type RequirementStatus } from "@/lib/comply/standards";\n',
      'type RequirementStatus = "done" | "review" | "open";\n',
    );
  }

  for (const [from, to] of Object.entries(libMap)) {
    if (to === null) continue;
    text = text.split(`from "${from}"`).join(`from "${to}"`);
  }

  if (text.includes("@/lib/mcp/types")) {
    const typesPath =
      file.includes(`${path.sep}mcp${path.sep}src${path.sep}`) &&
      !file.includes(`${path.sep}lib${path.sep}`)
        ? "./types"
        : mcpTypesImport(file);
    text = text.split('from "@/lib/mcp/types"').join(`from "${typesPath}"`);
  }

  // registry local mcp-tools
  const registryReplacements = [
    ["@/lib/garage/mcp-tools", "./garage-mcp-tools"],
    ["@/lib/connect/mcp-tools", "./connect-mcp-tools"],
    ["@/lib/bridge/mcp-tools", "./bridge-mcp-tools"],
    ["@/lib/market/mcp-tools", "./market-mcp-tools"],
    ["@/lib/twin/mcp-tools", "./twin-mcp-tools"],
    ["@/lib/care/mcp-tools", "./care-mcp-tools"],
    ["@/lib/fleet/mcp-tools", "./fleet-mcp-tools"],
    ["@/lib/serve/mcp-tools", "./serve-mcp-tools"],
    ["@/lib/build/mcp-tools", "./build-mcp-tools"],
    ["@/lib/pilot/mcp-tools", "./pilot-mcp-tools"],
    ["@/lib/shield/mcp-tools", "./shield-mcp-tools"],
    ["@/lib/comply/mcp-tools", "./comply-mcp-tools"],
    ["@/lib/proof/mcp-tools", "./proof-mcp-tools"],
    ["@/lib/frame/mcp-tools", "./frame-mcp-tools"],
    ["@/lib/train/mcp-tools", "./train-mcp-tools"],
    ["@/lib/data/mcp-tools", "./data-mcp-tools"],
    ["@/lib/view/mcp-tools", "./view-mcp-tools"],
    ["@/lib/autonomy/mcp-tools", "./autonomy-mcp-tools"],
    ["@/lib/mind/mcp-tools", "./mind-mcp-tools"],
    ["@/lib/bench/mcp-tools", "./bench-mcp-tools"],
  ];
  for (const [from, to] of registryReplacements) {
    text = text.split(`from "${from}"`).join(`from "${to}"`);
  }

  fs.writeFileSync(file, text);
}

console.log("imports fixed");
