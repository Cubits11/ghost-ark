import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

/**
 * Independent reports are useful only when a reviewer can reproduce the
 * bounded observation and when the public intake does not invite disclosure of
 * secrets or unauthorized testing. Keep both properties explicit as this
 * repository evolves.
 */
describe("external kernel-probe reports", () => {
  const form = ".github/ISSUE_TEMPLATE/kernel-probe-report.yml";

  it("collects the evidence needed to reproduce a report", () => {
    const issueForm = read(form);
    for (const id of ["probe-version", "environment", "authorization", "command", "output", "interpretation"]) {
      expect(issueForm).toContain(`id: ${id}`);
    }
  });

  it("makes authorization and safe public disclosure explicit", () => {
    const issueForm = read(form);
    expect(issueForm).toMatch(/authorized/iu);
    expect(issueForm).toMatch(/credentials/iu);
    expect(issueForm).toMatch(/private production inputs/iu);
    expect(issueForm).toMatch(/not a security advisory/iu);
  });

  it("links the report form from the standalone probe guide", () => {
    const guide = read("tools/kernel-probe/README.md");
    expect(guide).toContain(
      "https://github.com/PSUCyberSecurityLab/ghost-ark/issues/new?template=kernel-probe-report.yml"
    );
    expect(guide).toMatch(/not a security advisory/iu);
  });
});
