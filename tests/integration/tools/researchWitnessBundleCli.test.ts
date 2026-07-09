import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function run(command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
}

describe("research witness bundle CLI", () => {
  it("generates a locally verifiable witness checkpoint consistency bundle", () => {
    const outDir = mkdtempSync(join(tmpdir(), "ghost-ark-witness-bundle-"));

    const generated = run("npx", [
      "ts-node",
      "tools/scripts/createResearchWitnessBundle.ts",
      "--out",
      outDir
    ]);

    expect(generated.status).toBe(0);
    expect(generated.stdout).toContain("Wrote local research witness bundle");

    const previousCheckpoint = join(outDir, "previous-witness-checkpoint.json");
    const newCheckpoint = join(outDir, "new-witness-checkpoint.json");
    const proof = join(outDir, "consistency-proof.json");
    const manifest = join(outDir, "witness-key-manifest.json");
    const readme = join(outDir, "README.md");

    for (const file of [previousCheckpoint, newCheckpoint, proof, manifest, readme]) {
      expect(existsSync(file)).toBe(true);
    }

    expect(readFileSync(readme, "utf8")).toContain("Non-Claims");

    const verified = run(process.execPath, [
      "tools/ghost-verify.mjs",
      "--witness-checkpoint-consistency-proof",
      proof,
      "--previous-witness-checkpoint",
      previousCheckpoint,
      "--new-witness-checkpoint",
      newCheckpoint,
      "--witness-key-manifest",
      manifest
    ]);

    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain("PASS witness_consistency_proof");
    expect(verified.stdout).toContain("PASS witness_previous_checkpoint_signatures");
    expect(verified.stdout).toContain("PASS witness_new_checkpoint_signatures");
    expect(verified.stdout).toContain("VERDICT: PASS");
  });
});
