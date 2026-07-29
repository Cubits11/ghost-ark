import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../..");
const UNBUILT_DIR = resolve(REPO_ROOT, "dab/gateway/UNBUILT_PROTOTYPES");

function listFiles(directory: string): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      entries.push(...listFiles(full));
    } else {
      entries.push(full);
    }
  }
  return entries;
}

/**
 * These tests enforce a claim the repository makes about itself: that everything under
 * UNBUILT_PROTOTYPES is inert. The directory previously lived at `dab/gateway/src/bpf/`
 * with a banner reading "Mitigations implemented for Zero-Days 1, 3, 4, 5" while being
 * compiled by nothing and loaded by nothing. Prose alone cannot keep that honest; if a
 * file here ever becomes load-bearing, one of these tests fails and forces it out of
 * the directory.
 */
describe("UNBUILT_PROTOTYPES is inert", () => {
  it("exists and carries a README stating its non-claim status", () => {
    expect(existsSync(UNBUILT_DIR)).toBe(true);
    const readme = readFileSync(join(UNBUILT_DIR, "README.md"), "utf8");
    expect(readme).toMatch(/not compiled, not loaded, not load-bearing/u);
    expect(readme).toMatch(/aspirational/u);
  });

  it("is referenced by no Rust source, Cargo manifest, or build script", () => {
    const prototypeNames = listFiles(UNBUILT_DIR)
      .filter((path) => !path.endsWith("README.md"))
      .map((path) => path.split("/").pop() as string);

    expect(prototypeNames.length).toBeGreaterThan(0);

    const searchRoots = ["dab/gateway/src", "dab/verifier/src"]
      .map((relativePath) => resolve(REPO_ROOT, relativePath))
      .filter((path) => existsSync(path));

    const sourceFiles = searchRoots.flatMap((root) => listFiles(root));
    for (const manifest of ["dab/gateway/Cargo.toml", "dab/verifier/Cargo.toml"]) {
      const path = resolve(REPO_ROOT, manifest);
      if (existsSync(path)) {
        sourceFiles.push(path);
      }
    }

    for (const sourceFile of sourceFiles) {
      const contents = readFileSync(sourceFile, "utf8");
      for (const prototypeName of prototypeNames) {
        expect(contents, `${relative(REPO_ROOT, sourceFile)} references unbuilt prototype ${prototypeName}`).not.toContain(prototypeName);
      }
    }
  });

  it("is referenced by no CI workflow", () => {
    const workflowDir = resolve(REPO_ROOT, ".github/workflows");
    if (!existsSync(workflowDir)) {
      return;
    }
    for (const workflow of listFiles(workflowDir)) {
      const contents = readFileSync(workflow, "utf8");
      expect(contents, `${relative(REPO_ROOT, workflow)} builds an unbuilt prototype`).not.toContain("UNBUILT_PROTOTYPES");
    }
  });

  it("keeps the corrected eBPF prototype quarantined rather than in the gateway source tree", () => {
    expect(existsSync(resolve(REPO_ROOT, "dab/gateway/src/bpf"))).toBe(false);
    expect(existsSync(join(UNBUILT_DIR, "bpf/ghost_ark_ring0.bpf.c"))).toBe(true);
  });
});

/**
 * The repository is a provenance artifact. A reviewer running `npm test` on a clean
 * clone must not find compiled binaries or build directories tracked in git.
 */
describe("build output is not tracked", () => {
  it("tracks no Rust target/, dist/, or cdk.out/ paths", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .split("\n")
      .filter((line) => line.length > 0);

    const offenders = tracked.filter(
      (path) => /(^|\/)target\//u.test(path) || path.startsWith("dist/") || path.includes("cdk.out/") || path.endsWith(".rlib") || path.endsWith(".rmeta")
    );

    expect(offenders, `tracked build output: ${offenders.slice(0, 10).join(", ")}`).toEqual([]);
  });

  it("tracks no environment files, private keys, or secret directories", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .split("\n")
      .filter((line) => line.length > 0);

    const offenders = tracked.filter((path) => /(^|\/)\.env($|\.)/u.test(path) || path.startsWith("secrets/") || path.endsWith(".p12"));

    expect(offenders, `tracked sensitive paths: ${offenders.join(", ")}`).toEqual([]);
  });

  it("tracks only PEM files that are declared public keys", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      .split("\n")
      .filter((line) => line.endsWith(".pem"));

    for (const path of tracked) {
      const contents = readFileSync(resolve(REPO_ROOT, path), "utf8");
      expect(contents, `${path} contains a PRIVATE key`).not.toMatch(/PRIVATE KEY/u);
      expect(contents, `${path} is not a recognizable public key`).toMatch(/BEGIN (?:RSA )?PUBLIC KEY/u);
    }
  });
});
