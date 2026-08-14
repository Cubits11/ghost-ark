import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

/**
 * E16 closed a public gap after the README, evidence ledger, and generated evidence
 * ladder had each already described it as open. This guard protects the public
 * entry points from telling a reviewer that a measured result does not exist.
 */
describe("E16 public-surface consistency", () => {
  const surfaces = [
    "README.md",
    "docs/artifact/CI_COVERAGE.md",
    "tools/figures/render-readme-figures.mjs"
  ] as const;

  it("does not retain the superseded unnamed-consumer gap", () => {
    for (const path of surfaces) {
      expect(read(path), path).not.toMatch(/No named consumer has been shown to distinguish any pair/iu);
    }
  });

  it("makes the result and its incidence boundary visible from the README", () => {
    const readme = read("README.md");
    expect(readme).toContain("**E16**");
    expect(readme).toContain("npm run experiment:e16");
    expect(readme).toMatch(/existence[^\n]{0,80}(?:not|rather than)[^\n]{0,80}(?:prevalence|incidence)/iu);
  });

  it("keeps the evidence ledger and figure source on the current status", () => {
    expect(read("docs/artifact/CI_COVERAGE.md")).toContain("E16");
    expect(read("tools/figures/render-readme-figures.mjs")).toContain("E16");
  });
});
