/**
 * Artifact-evaluation pipeline sanity checks.
 *
 * These assert that the AE orchestration is well-formed and that the DAB
 * aggregate runner produces the expected report shape. They do NOT assert that
 * the repository's gating stages pass — the known HEAD blockers (see
 * docs/artifact/repository_inventory.md §7) are intentionally left red, and the
 * honest report reflects that. This test only guards the harness itself.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..", "..");
const at = (p: string) => resolve(ROOT, p);

const REQUIRED_FILES = [
  "Makefile",
  "Dockerfile.reviewer",
  ".dockerignore",
  "docker-compose.reviewer.yml",
  "ARTIFACT_EVALUATION.md",
  "docs/artifact/repository_inventory.md",
  "scripts/reproduce.sh",
  "scripts/run-proofs.sh",
  "scripts/run-attacks.sh",
  "scripts/run-benchmarks.sh",
  "tools/artifact/aec-report.mjs",
  "dab/bench/run_all.ts",
  "docs/dissertation/build_paper.sh",
  "docs/dissertation/README.md",
  ".github/workflows/artifact.yml",
];

const SHEBANG_FILES = [
  "scripts/reproduce.sh",
  "scripts/run-proofs.sh",
  "scripts/run-attacks.sh",
  "scripts/run-benchmarks.sh",
  "docs/dissertation/build_paper.sh",
  "tools/artifact/aec-report.mjs",
];

const REQUIRED_MAKE_TARGETS = [
  "bootstrap",
  "lint",
  "build",
  "proof",
  "unit",
  "attack",
  "benchmark",
  "dissertation",
  "artifact-report",
  "ci-check",
  "reproduce",
  "clean",
];

describe("artifact-evaluation pipeline", () => {
  it("ships every required orchestration file", () => {
    for (const f of REQUIRED_FILES) {
      expect(existsSync(at(f)), `missing ${f}`).toBe(true);
    }
  });

  it("scripts start with a shebang", () => {
    for (const f of SHEBANG_FILES) {
      const head = readFileSync(at(f), "utf8").slice(0, 20);
      expect(head.startsWith("#!"), `${f} lacks a shebang`).toBe(true);
    }
  });

  it("Makefile declares every directive-required target", () => {
    const mk = readFileSync(at("Makefile"), "utf8");
    for (const t of REQUIRED_MAKE_TARGETS) {
      expect(new RegExp(`^${t}:`, "m").test(mk), `Makefile missing target ${t}`).toBe(true);
    }
  });

  it("reproduce.sh chains the stages in the documented order", () => {
    const src = readFileSync(at("scripts/reproduce.sh"), "utf8");
    const order = ["build", "claims", "proof", "unit", "attack", "benchmark", "dissertation"];
    let cursor = -1;
    for (const stage of order) {
      const idx = src.indexOf(`run_stage ${stage} `);
      const idxSkip = src.indexOf(`"stage": "${stage}"`);
      const found = idx >= 0 ? idx : idxSkip;
      expect(found, `stage ${stage} not found in reproduce.sh`).toBeGreaterThan(cursor);
      cursor = found;
    }
  });

  it("run-proofs.sh gates the DAB specs with real expectations and never edits them to pass", () => {
    const src = readFileSync(at("scripts/run-proofs.sh"), "utf8");
    expect(src).toMatch(/DAB_NonceLedger:clean/);
    expect(src).toMatch(/DAB_NonceLedger_Mutant:violation/);
    // It must not rewrite the LaTeX operator in the committed specs.
    expect(src).not.toMatch(/sed .*setminus/);
  });

  it("committed DAB reference logs record the real TLC verdicts", () => {
    const baseline = readFileSync(
      at("proofs/dab/artifacts/DAB_NonceLedger.tlc.txt"),
      "utf8",
    );
    expect(baseline).toMatch(/No error has been found/);
    const mutant = readFileSync(
      at("proofs/dab/artifacts/DAB_NonceLedger_Mutant.tlc.txt"),
      "utf8",
    );
    expect(mutant).toMatch(/Invariant NoReplays is violated/);
  });

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  it.runIf(nodeMajor >= 22)(
    "DAB aggregate runner emits an honest, well-formed report",
    () => {
      // The runner honestly exits 1 when all_passed is false, so capture
      // stdout whether it exits 0 or non-zero.
      let out: string;
      try {
        out = execFileSync(
          process.execPath,
          ["--experimental-strip-types", at("dab/bench/run_all.ts"), "--trials", "50"],
          { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] },
        );
      } catch (err: unknown) {
        const e = err as { stdout?: string };
        out = e.stdout ?? "";
      }
      const report = JSON.parse(out);
      expect(report.protocol).toBe("Ghost-Ark DAB Tier-0");
      expect(report.attacks).toHaveProperty("mutation");
      expect(report.attacks).toHaveProperty("replay");
      expect(report.attacks).toHaveProperty("unicode");
      expect(report.attacks).toHaveProperty("concurrency");
      expect(report.formal_games).toHaveProperty("games");
      expect(typeof report.all_passed).toBe("boolean");
      // Honesty guard: the scoring inversion (a detected replay counted as an
      // attacker win) was fixed in cd66782. With correct accounting the
      // aggregate must report a clean sweep AND zero in-suite advantage —
      // a green flag with nonzero advantage would be the new lie.
      expect(report.global_advantage).toBe(0);
      expect(report.all_passed).toBe(true);
    },
    20_000,
  );
});
