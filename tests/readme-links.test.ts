import { describe, it, expect } from "vitest";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(join(root, "..", "README.md"), "utf8");

describe("README cross-links", () => {
  it("links the ohho-os engine and the ohho-sdk client", () => {
    expect(readme).toMatch(/ohho-robotics\/ohho-os/);
    expect(readme).toMatch(/ohho-robotics\/ohho-sdk/);
  });

  it("keeps the moved note and Apache-2.0 badge", () => {
    expect(readme).toMatch(/Moved from the old ohho-sdk repository/i);
    expect(readme).toMatch(/License-Apache_2.0/);
  });
});
