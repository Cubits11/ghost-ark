import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../..");
const BENCH_DIR = resolve(REPO_ROOT, "dab/bench");

/**
 * `dab/bench` contains detection suites whose results were quoted in the dissertation as
 * empirical evidence, while several of them invoked no Ghost-Ark component at all. The
 * directory is now quarantined by a README. Prose decays, so these tests hold the
 * quarantine in place: if the README is deleted or a workflow starts treating this
 * directory as an evidence source, the suite fails.
 */
describe("dab/bench quarantine holds", () => {
  it("carries a README that states it is not evidence about Ghost-Ark", () => {
    const readmePath = join(BENCH_DIR, "README.md");
    expect(existsSync(readmePath)).toBe(true);

    const readme = readFileSync(readmePath, "utf8");
    expect(readme).toMatch(/QUARANTINED/u);
    expect(readme).toMatch(/NOT measurements of any\s*\n?Ghost-Ark component/u);
    // The README must keep pointing at the experiments that superseded it.
    expect(readme).toContain("docs/research/EXPERIMENTS.md");
    expect(readme).toContain("experiment:e4");
  });

  it("still contains the tautological source lines the README documents, or the README is stale", () => {
    // If someone fixes concurrency.ts, this test fails and forces the README to be
    // updated too — so the quarantine notice can never describe code that no longer exists.
    const concurrency = readFileSync(join(BENCH_DIR, "attacks/concurrency.ts"), "utf8");
    const stillTautological = concurrency.includes("requestA.payload !== requestB.payload");
    const readme = readFileSync(join(BENCH_DIR, "README.md"), "utf8");

    if (stillTautological) {
      expect(readme).toContain("requestA.payload !== requestB.payload");
    } else {
      // Rehabilitated: the README must no longer claim this specific defect is present.
      expect(readme).not.toContain("hardcoded strings that are not hashes");
    }
  });

  it("is not consumed by any CI workflow as an evidence source", () => {
    const workflowDir = resolve(REPO_ROOT, ".github/workflows");
    if (!existsSync(workflowDir)) {
      return;
    }
    for (const entry of readdirSync(workflowDir)) {
      const contents = readFileSync(join(workflowDir, entry), "utf8");
      expect(contents, `${entry} runs dab/bench as an evidence source`).not.toMatch(/dab\/bench/u);
    }
  });

  it("is excluded from the experiment scripts, which must reference tools/experiments only", () => {
    const packageJson = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    const experimentScripts = Object.entries(packageJson.scripts).filter(([name]) => name.startsWith("experiment"));
    expect(experimentScripts.length).toBeGreaterThan(0);

    for (const [name, command] of experimentScripts) {
      expect(command, `${name} must not source evidence from dab/bench`).not.toMatch(/dab\/bench/u);
    }
  });
});
