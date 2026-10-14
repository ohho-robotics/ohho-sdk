import { describe, it, expect } from "vitest";

import { OhhOClient } from "../index";

describe("@ohho/client", () => {
  it("exports the OhhOClient class", () => {
    expect(new OhhOClient()).toBeInstanceOf(OhhOClient);
  });
});
