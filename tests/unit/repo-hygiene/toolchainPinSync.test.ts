import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every place this repository acquires the TLA+ toolchain must name the same
 * version and the same digest.
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-11 three CI jobs went red at once. The cause was not a code change:
 * `tlaplus/tlaplus` re-uploaded `tla2tools.jar` to the **prerelease** tag
 * `v1.8.0`, which it does repeatedly. Same URL, different bytes.
 *
 * The integrity checks did their job and refused to run. What they could not
 * catch is that this repository had pinned that one tag in three files at three
 * DIFFERENT digests, and had a fourth path — the Makefile — that fetched it with
 * no check at all:
 *
 *   e22f8ffb…  scripts/run-proofs.sh      (recorded 2026-08-01)
 *   58d44845…  Dockerfile.reviewer        (recorded earlier, never reconciled)
 *   58d44845…  Dockerfile.reproducer
 *   (none)     Makefile bootstrap target
 *   ab323b79…  what the URL actually served that morning
 *
 * `artifacts-verify.yml` carried a comment asserting the pins "cannot drift to
 * different pins" because the workflow reads the digest from run-proofs.sh. That
 * was true of the workflow and false of the repository: two other files held a
 * different value, and the comment made the drift harder to notice, not easier.
 *
 * So this test asserts agreement across every site. It cannot tell you the pin is
 * CORRECT — only that the repository has one opinion instead of four. Correctness
 * is the digest check's job at fetch time, and immutability is why the pin now
 * points at v1.7.4, the newest non-prerelease.
 */

const REPO_ROOT = resolve(__dirname, "../../..");

const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf8");

/** scripts/run-proofs.sh is the declared single source of truth. */
function sourceOfTruth(): { version: string; sha256: string } {
  const source = read("scripts/run-proofs.sh");
  const version = /^TLA_TOOLS_VERSION="([^"]+)"/mu.exec(source)?.[1];
  const sha256 = /^TLA_TOOLS_SHA256="([0-9a-f]{64})"/mu.exec(source)?.[1];
  expect(version, "scripts/run-proofs.sh must declare TLA_TOOLS_VERSION").toBeDefined();
  expect(sha256, "scripts/run-proofs.sh must declare TLA_TOOLS_SHA256").toBeDefined();
  return { version: version as string, sha256: sha256 as string };
}

describe("toolchain pin: every acquisition site agrees", () => {
  it("pins tla2tools to the same version and digest everywhere", () => {
    const { version, sha256 } = sourceOfTruth();
    const disagreements: string[] = [];

    // Each entry: file, and the values it must contain if it mentions tla2tools.
    for (const path of ["Dockerfile.reviewer", "Dockerfile.reproducer", "Makefile"]) {
      const source = read(path);
      if (!/tla2tools/u.test(source)) {
        continue;
      }
      // Any 64-hex literal in a file that fetches tla2tools must be THE digest.
      for (const found of source.match(/\b[0-9a-f]{64}\b/gu) ?? []) {
        if (found !== sha256) {
          disagreements.push(`${path}: digest ${found.slice(0, 8)}… != ${sha256.slice(0, 8)}…`);
        }
      }
      // Any hardcoded tlaplus release version must be THE version.
      for (const found of source.match(/releases\/download\/(v[0-9][^/]*)\//gu) ?? []) {
        const tag = /download\/(v[0-9][^/]*)\//u.exec(found)?.[1];
        if (tag && tag !== version) {
          disagreements.push(`${path}: version ${tag} != ${version}`);
        }
      }
      for (const found of source.match(/TLA_TOOLS_VERSION=(v[0-9][^\s\\]*)/gu) ?? []) {
        const tag = /TLA_TOOLS_VERSION=(v[0-9][^\s\\]*)/u.exec(found)?.[1];
        if (tag && tag !== version) {
          disagreements.push(`${path}: TLA_TOOLS_VERSION ${tag} != ${version}`);
        }
      }
    }

    expect(disagreements).toEqual([]);
  });

  it("never pins the toolchain to a prerelease tag", () => {
    // v1.8.0 is a prerelease whose asset is re-uploaded under the same tag. A pin
    // to a mutable target buys the ceremony of verification without the property:
    // it fails on the upstream project's schedule rather than on evidence, and it
    // means a recorded proof log naming that tag does not identify the bytes that
    // produced it. Pin releases, not prereleases.
    const { version } = sourceOfTruth();
    expect(version, "v1.8.0 is a rolling prerelease — pin a stable release").not.toBe("v1.8.0");
  });

  it("verifies the digest on every fetch path, including the Makefile", () => {
    // The Makefile bootstrap target fetched the jar with no integrity check at
    // all, which made it the one path that would have accepted a substituted jar
    // silently. It is also the path a reviewer runs first.
    const makefile = read("Makefile");
    const bootstrap = /^bootstrap:[\s\S]*?(?=^[a-z][a-z0-9_-]*:)/mu.exec(makefile)?.[0] ?? "";
    expect(bootstrap, "Makefile must have a bootstrap target").toContain("tla2tools");
    expect(bootstrap, "bootstrap must read the pinned digest").toMatch(/TLA_TOOLS_SHA256/u);
    expect(bootstrap, "bootstrap must compare the fetched digest").toMatch(/!=|sha256sum -c|shasum/u);
  });

  it("keeps the workflow reading the pin rather than restating it", () => {
    // artifacts-verify.yml derives the digest from run-proofs.sh. If someone
    // inlines a literal there, the workflow becomes a fifth opinion.
    const workflow = read(".github/workflows/artifacts-verify.yml");
    const tlaJob = workflow.slice(workflow.indexOf("tla-proofs:"));
    expect(tlaJob).toMatch(/grep -oE '\^TLA_TOOLS_SHA256/u);
    const literals = tlaJob.match(/\b[0-9a-f]{64}\b/gu) ?? [];
    expect(literals, "the TLA+ job must not inline a digest literal").toEqual([]);
  });
});
