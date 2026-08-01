import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The claim gate (`npm run scan:claims`) reads `.md`, `.mdx`, `.ts`, and `.tsx`.
 * That is a reasonable scope — those are the surfaces a reader treats as
 * authored claims — but it means the gate's coverage is defined by file
 * extension, and anything parked outside those extensions is invisible to it.
 *
 * This repository shipped exactly that hole. `ghost_ark_audit_payload.txt` sat
 * at the repository root: 363 KB and 7,941 lines, a concatenated dump of 44
 * source and documentation files made for pasting into a model's context. It was
 * never scanned, because it was `.txt`. Copied into a scanned extension it trips
 * 319 findings — most are lines whose real homes are allowlisted boundary
 * documents, but the dump also preserved `ghost_ark_ring0.bpf.c` at its
 * pre-quarantine path, banner intact: "Mitigations implemented for Zero-Days 1,
 * 3, 4, 5". That claim was retracted and the file quarantined to
 * `dab/gateway/UNBUILT_PROTOTYPES/`; the dump kept the uncorrected copy alive
 * where nothing would ever look at it.
 *
 * The specific file is gone. These tests keep the hole closed:
 *
 *   1. No large unscanned-extension blob may sit at the repository root, which
 *      is where context dumps and scratch files accumulate.
 *   2. The scanner must skip directories that this repository's own tooling
 *      generates, so its verdict describes the committed tree rather than
 *      whatever a tool left on disk.
 *
 * Neither test can prove the gate sees every claim. They remove the two ways
 * this repository has actually lost claim text.
 */

const REPO_ROOT = resolve(__dirname, "../../..");

/** Extensions the claim scanner reads. Mirrors check-forbidden-claims.mjs. */
const SCANNED_EXTENSIONS = [".md", ".mdx", ".ts", ".tsx"];

/**
 * Root-level files exempt from the size rule, each because a tool requires the
 * name and the content is machine-generated rather than authored claim text.
 */
const ROOT_BLOB_EXEMPTIONS = new Set([
  "package-lock.json",
  "LICENSE",
  "tla2tools.jar",
  "cdk.json",
  "tsconfig.json",
  "package.json",
  "stryker.config.json",
  "docker-compose.reviewer.yml",
  "CITATION.cff"
]);

/**
 * 16 KB. Chosen to be comfortably above every legitimate root config file and
 * far below the 363 KB dump this test exists to prevent. A root file that
 * outgrows this is either generated output that belongs in `artifacts/`, or
 * prose that belongs in `docs/` where the gate can read it.
 */
const MAX_ROOT_UNSCANNED_BYTES = 16 * 1024;

function trackedRootFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--", ":(top)*"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  return output
    .split("\0")
    .filter((path) => path.length > 0 && !path.includes("/"));
}

describe("claim-surface coverage", () => {
  it("keeps no large unscanned-extension blob at the repository root", () => {
    const offenders: string[] = [];

    for (const file of trackedRootFiles()) {
      if (ROOT_BLOB_EXEMPTIONS.has(file)) {
        continue;
      }
      if (SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension))) {
        continue;
      }
      const bytes = statSync(join(REPO_ROOT, file)).size;
      if (bytes > MAX_ROOT_UNSCANNED_BYTES) {
        offenders.push(`${file} (${bytes} bytes)`);
      }
    }

    // If this fails, do not add the file to ROOT_BLOB_EXEMPTIONS to make it
    // pass. Move generated output to artifacts/ and prose to docs/, where the
    // claim gate reads it.
    expect(offenders).toEqual([]);
  });

  it("does not track scratch or context-dump files at the repository root", () => {
    // Named patterns rather than a size rule, because a small scratch file is
    // still a file a reviewer will read as part of the artifact. `scratch_ifc.ts`
    // — a 33-line IFC demo importing packages by relative path from the root —
    // was tracked for months.
    const suspicious = trackedRootFiles().filter((file) =>
      /^(scratch|tmp|temp|draft|notes?|dump|payload|paste|context)[-_.]|[-_](scratch|dump|payload|paste|audit_payload)\./iu.test(file)
    );

    expect(suspicious).toEqual([]);
  });

  it("makes the scanner skip tool-generated directories so its verdict tracks the committed tree", () => {
    const scanner = readFileSync(join(REPO_ROOT, "tools/research/check-forbidden-claims.mjs"), "utf8");

    // Stryker (experiment E10) copies the entire working tree into
    // .stryker-tmp/sandbox-*/. Every file then appears twice: once at its real
    // path where the allowlist applies, and once inside the sandbox where it
    // does not. Measured while adding E10: a clean tree reported 280 violations,
    // every one a sandbox duplicate of an allowlisted file.
    for (const generated of [".stryker-tmp", "artifacts", "node_modules", "cdk.out", "dist", "coverage"]) {
      expect(scanner, `scanner must skip generated directory ${generated}`).toContain(`"${generated}"`);
    }
  });

  it("git-ignores the mutation sandbox so it cannot be committed", () => {
    // .stryker-tmp is a complete copy of the repository, ~11 GB on the host that
    // added E10. Untracked-but-unignored, a stray `git add -A` commits the whole
    // repository a second time.
    const ignored = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(ignored).toMatch(/^\/?\.stryker-tmp\/?$/mu);
  });
});
