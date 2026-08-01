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

  it("keeps the v200 Nitro attestation draft out of the gateway build", () => {
    // v200.rs was `pub mod v200;` in the gateway library for weeks while being
    // impossible to build on its only target platform: the NSM call used a bulk
    // `DescribePCRs` API that does not exist, behind `#[cfg(target_os =
    // "linux")]`. macOS never compiled it; CI did, and failed E0599 on every
    // run. Off-Linux the mock returned EXPECTED_GHOST_ARK_V200_HASH -- the very
    // constant the attestation check compares against -- so the check passed
    // unconditionally on the development host.
    //
    // Both halves of that must stay gone: the module out of the build, and the
    // dependency out of the manifest.
    expect(existsSync(resolve(REPO_ROOT, "dab/gateway/src/v200.rs"))).toBe(false);
    expect(existsSync(join(UNBUILT_DIR, "rust/v200.rs"))).toBe(true);

    const libRs = readFileSync(resolve(REPO_ROOT, "dab/gateway/src/lib.rs"), "utf8");
    expect(libRs, "v200 must not be declared as a gateway module").not.toMatch(/^\s*pub mod v200;/mu);

    const cargoToml = readFileSync(resolve(REPO_ROOT, "dab/gateway/Cargo.toml"), "utf8");
    expect(cargoToml, "the NSM dependency has no remaining consumer").not.toContain("aws-nitro-enclaves-nsm-api");
  });

  it("keeps the quarantine banner on the v200 draft so its status survives a skim", () => {
    const source = readFileSync(join(UNBUILT_DIR, "rust/v200.rs"), "utf8");
    expect(source).toMatch(/NOT COMPILED, NOT LOADED, NOT LOAD-BEARING/u);
    // The specific defects, not just a generic disclaimer. A reader who opens
    // this file should learn why it is here without consulting git history.
    expect(source).toContain("FABRICATED PASS");
    expect(source).toContain("DescribePCR");
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
