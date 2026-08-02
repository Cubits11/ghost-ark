import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseClaimMatrix, unresolvableCommands } from "../../../tools/claims/verifyClaimMatrix";

/**
 * Keeps `docs/governance/claim-evidence-matrix.md` from becoming decoration.
 *
 * The matrix maps 20 public claims to the command that verifies each. It is the
 * repository's answer to "do not trust the author, run the commands" — and until
 * 2026-08-02 nothing ran them. A row could cite an npm script that had been
 * renamed, or a test file that had been deleted, and the matrix would still read
 * as evidence. **A documented command nobody executes is an assertion wearing a
 * command's clothes.**
 *
 * These tests are the cheap half: they check statically that every cited command
 * still resolves. The expensive half — actually executing them — is
 * `npm run claims:verify`, which cannot live here because five rows cite
 * `npm test` and running it from inside `npm test` would recurse.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const rows = parseClaimMatrix();

describe("claim matrix stays executable", () => {
  it("parses every claim row", () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const row of rows) {
      expect(row.id, "each row needs an id").toMatch(/^CLAIM-\d+$/u);
      expect(row.claim.length, `${row.id} needs a claim`).toBeGreaterThan(0);
      expect(row.status.length, `${row.id} needs a status`).toBeGreaterThan(0);
    }
  });

  it("cites only commands that still resolve", () => {
    // The load-bearing assertion: every `npm run X` names a real script, and
    // every test path names a file that exists.
    expect(unresolvableCommands(rows)).toEqual([]);
  });

  it("gives every locally-verifiable claim a command", () => {
    // A row claiming local evidence with no command is a claim with no way to
    // check it, which is the shape this matrix exists to prevent.
    const missing = rows
      .filter((row) => row.status === "Local evidence" || row.status === "Local partial")
      .filter((row) => row.command === null)
      .map((row) => row.id);
    expect(missing).toEqual([]);
  });

  it("gives every AWS-required claim a status that says so, not a local command", () => {
    // The other direction. An AWS-required claim with a local command would
    // convert a declared gap into a false pass — the failure mode this
    // repository documents more than any other.
    for (const row of rows.filter((r) => r.awsRequired.startsWith("Yes"))) {
      expect(
        ["AWS-required", "AWS-synth-only", "Local partial"],
        `${row.id} requires AWS but is marked ${row.status}`
      ).toContain(row.status);
    }
  });

  it("cites no command that mutates tracked files", () => {
    // Found by running the matrix: CLAIM-020's command regenerated a committed
    // fixture, and because the signature is ECDSA — non-deterministic by design —
    // every verification produced a different byte sequence. A reviewer following
    // the documented instructions got a dirty working tree and no way to tell
    // whether they had broken something.
    //
    // Verification must be side-effect-free on tracked state. Output paths belong
    // under artifacts/, which is gitignored.
    const offenders = rows
      .filter((row) => row.command !== null)
      .filter((row) => /--out\s+(?!artifacts\/)/u.test(row.command as string))
      .map((row) => `${row.id}: ${row.command}`);
    expect(offenders).toEqual([]);
  });

  it("leaves the working tree clean after the side-effect-free commands run", () => {
    // A direct check rather than an inference. Runs only the fast, obviously
    // side-effect-free commands; `npm test` and `cdk synth` are excluded for
    // runtime, not because they are suspect.
    const cheap = rows
      .map((row) => row.command)
      .filter((command): command is string => command !== null)
      .filter((command) => command.startsWith("npm run research:witness-bundle"));

    // Measured as a DELTA, not an absolute. The first version asserted the tree
    // was clean afterwards, which failed whenever the developer running it had
    // uncommitted work of their own — reporting someone's in-progress edit as a
    // side effect of a claim command. A check that cannot tell those apart
    // produces confusing failures and gets disabled.
    const dirtyPaths = (): Set<string> =>
      new Set(
        execFileSync("git", ["status", "--porcelain", "--", "examples/", "docs/", "packages/"], {
          cwd: REPO_ROOT,
          encoding: "utf8"
        })
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => line.slice(3))
      );

    const before = dirtyPaths();
    for (const command of cheap) {
      execFileSync("sh", ["-c", command], { cwd: REPO_ROOT, stdio: "ignore", timeout: 120_000 });
    }
    const newlyDirty = [...dirtyPaths()].filter((path) => !before.has(path));

    expect(newlyDirty, "a documented verification command mutated tracked files").toEqual([]);
  }, 180_000);
});
