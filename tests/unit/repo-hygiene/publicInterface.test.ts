import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Invariants for a repository published under an institutional account.
 *
 * Ghost-Ark is moving from a personal account to a university security lab's
 * organisation. That changes what the repository is: not one person's working
 * directory made visible, but an artifact an institution's name is attached to.
 * Three categories stop being acceptable at that boundary, and none of them is a
 * style preference.
 *
 *   1. CAREER CORRESPONDENCE. Endorsement requests, circulation drafts, and
 *      submission letters are a person's professional life, not a research
 *      output. They also carry personal contact details into a public index.
 *
 *   2. COMMERCIAL PLANNING. A go-to-market or capitalization document under an
 *      institutional account invites the question of whether the affiliation is
 *      being used to support a venture. That question is expensive to answer and
 *      free to avoid.
 *
 *   3. DEVELOPER MACHINE STATE. Absolute home-directory paths leak a username
 *      and local layout, and they make committed artifacts non-reproducible for
 *      anyone else — a recorded proof log that names one machine is weaker
 *      evidence than one that does not.
 *
 * These tests are the enforcement. Prose asking contributors to be careful is
 * not a control.
 */

const REPO_ROOT = resolve(__dirname, "../../..");

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  })
    .split("\0")
    .filter((path) => path.length > 0);
}

/** Text files worth scanning. Lockfiles and binaries are excluded by extension. */
const SCANNABLE = /\.(md|mdx|ts|tsx|mjs|cjs|js|json|yml|yaml|txt|sh|rs|py|tla|cff|toml)$/u;
const SKIP = /(^|\/)(package-lock\.json|Cargo\.lock)$/u;

function scannableFiles(): string[] {
  return trackedFiles().filter((path) => SCANNABLE.test(path) && !SKIP.test(path));
}

/** Reads a tracked file, tolerating anything that is not valid UTF-8. */
function read(path: string): string {
  try {
    if (statSync(join(REPO_ROOT, path)).size > 8 * 1024 * 1024) {
      return "";
    }
    return readFileSync(join(REPO_ROOT, path), "utf8");
  } catch {
    return "";
  }
}

describe("public interface: no career correspondence", () => {
  it("tracks no outreach, endorsement, or submission-letter directory", () => {
    const offenders = trackedFiles().filter((path) =>
      /(^|\/)(outreach|correspondence|letters)\//u.test(path)
    );
    expect(offenders).toEqual([]);
  });

  it("tracks no file whose name declares it personal correspondence", () => {
    const offenders = trackedFiles().filter((path) =>
      /(endorsement|circulation|cover[-_]?letter|recommendation)[-_a-z0-9]*\.(md|txt|docx?)$/iu.test(path)
    );
    expect(offenders).toEqual([]);
  });

  it("carries no personal email address on a public surface", () => {
    // A maintainer contact belongs in SECURITY.md as a role, not a personal
    // inbox scattered through documentation. Free-mail domains are the specific
    // signal: an institutional address in a citation is legitimate.
    const freeMail = /[A-Za-z0-9._%+-]+@(gmail|yahoo|hotmail|outlook|proton(mail)?|icloud|aol)\.[A-Za-z.]{2,}/u;
    const offenders: string[] = [];
    for (const path of scannableFiles()) {
      const match = freeMail.exec(read(path));
      if (match) {
        offenders.push(`${path}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("public interface: no commercial planning material", () => {
  it("tracks no go-to-market, capitalization, or underwriting document", () => {
    const offenders = trackedFiles().filter((path) =>
      /(gtm|go[-_]?to[-_]?market|capitali[sz]ation|series[-_][a-c]|underwriting|term[-_]sheet|pitch[-_]?deck)/iu.test(path)
    );
    expect(offenders).toEqual([]);
  });
});

describe("public interface: no developer machine state", () => {
  it("embeds no absolute home-directory path", () => {
    // Matches /Users/<name>, /home/<name>, and C:\Users\<name>. The repository
    // previously shipped eleven files containing one developer's home path,
    // including committed TLC proof logs — which made those logs name a machine
    // rather than describe a run.
    const homePath = /(?:\/Users\/[a-z][a-z0-9._-]+|\/home\/[a-z][a-z0-9._-]+|[A-Z]:\\Users\\[A-Za-z0-9._-]+)/u;
    const allowed = new Set<string>([
      // This file states the patterns it forbids.
      "tests/unit/repo-hygiene/publicInterface.test.ts"
    ]);
    const offenders: string[] = [];
    for (const path of scannableFiles()) {
      if (allowed.has(path)) {
        continue;
      }
      const match = homePath.exec(read(path));
      if (match) {
        offenders.push(`${path}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("embeds no machine-specific temporary directory in recorded artifacts", () => {
    // TLC writes its scratch path into every log. Left in, it makes a recorded
    // proof artifact look machine-bound; a reader cannot tell whether the run
    // depended on that path.
    const offenders: string[] = [];
    for (const path of scannableFiles()) {
      if (path === "tests/unit/repo-hygiene/publicInterface.test.ts") {
        continue;
      }
      if (/\/private\/var\/folders\/[a-z0-9]/iu.test(read(path))) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("public interface: the entry points a reader needs", () => {
  it("names the claim, the check, the non-claim, and the gaps from the README", () => {
    // The four things an institutional reader must be able to reach without
    // reading the tree: what is claimed, how to check it, what is disclaimed,
    // and what is unverified. If any link rots out of the README, the repository
    // stops being self-describing and starts requiring a guide.
    const readme = read("README.md");
    for (const target of [
      "docs/research/00_THESIS.md",
      "docs/research/EXPERIMENTS.md",
      "docs/artifact/CI_COVERAGE.md",
      "CONTRIBUTING.md",
      "CITATION.cff"
    ]) {
      expect(readme, `README must link ${target}`).toContain(target);
    }
  });

  it("states the claim boundary in the README rather than only in a subdirectory", () => {
    const readme = read("README.md");
    expect(readme).toMatch(/What this is not|Not a proof/u);
  });
});
