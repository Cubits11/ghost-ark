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

/**
 * Text files worth scanning. Lockfiles and binaries are excluded by extension.
 *
 * This list is an enforcement boundary, not a convenience: anything absent from
 * it is a public surface this file silently does not check. It omitted `.tex`
 * for four days, during which `docs/paper/main.tex` — the manuscript, the single
 * most externally-facing document here — carried a free-mail address that the
 * test below exists to forbid. The guard reported green because it never opened
 * the file. Extensions added in that repair: tex, tf, tfvars, cfg, mts, cts,
 * html, sql, c, h, bib, and the extensionless build files.
 */
const SCANNABLE =
  /(\.(md|mdx|ts|tsx|mts|cts|mjs|cjs|js|json|yml|yaml|txt|sh|rs|py|tla|cfg|cff|toml|tex|bib|tf|tfvars|html|sql|c|h)$)|((^|\/)(Makefile|Dockerfile[^/]*)$)/u;
const SKIP = /(^|\/)(package-lock\.json|Cargo\.lock)$/u;

/**
 * A maintainer contact belongs in SECURITY.md as a role, not a personal inbox
 * scattered through documentation. Free-mail domains are the specific signal:
 * an institutional address in a citation is legitimate.
 *
 * The local part is bounded to 64 characters because RFC 5321 §4.5.3.1.1 bounds
 * it there. An unbounded `+` made this pattern quadratic on long runs of
 * local-part characters — see the linear-time discriminator below, which is the
 * test that would have caught it. No `g` flag, so the constant is stateless and
 * safe to share across cases.
 */
const FREE_MAIL =
  /[A-Za-z0-9._%+-]{1,64}@(gmail|yahoo|hotmail|outlook|proton(mail)?|icloud|aol)\.[A-Za-z.]{2,}/u;

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
    const offenders: string[] = [];
    for (const path of scannableFiles()) {
      const match = FREE_MAIL.exec(read(path));
      if (match) {
        offenders.push(`${path}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("detects a free-mail address in every scanned file type (discriminator)", () => {
    // The test above passing means either "no violation exists" or "the scanner
    // never looked". Those are not the same result, and this repository has
    // already shipped the second one while reporting the first. Assert the
    // scanner opens the file types that carry author contact details, and that
    // the pattern fires on a planted address in each.
    // Assembled at runtime rather than written as a literal. Spelling a real
    // free-mail address here would force this file onto an exemption list, and
    // an exemption is a permanent blind spot in the one file most likely to
    // accumulate contact details while being edited.
    const planted = `contact: someone${"@"}gmail.com`;
    for (const ext of ["tex", "md", "cff", "bib", "html", "mts", "tf"]) {
      expect(SCANNABLE.test(`docs/planted.${ext}`), `.${ext} must be scanned`).toBe(true);
      expect(FREE_MAIL.test(`${planted} in a .${ext} file`), `.${ext} content`).toBe(true);
    }
    // ...and that it stays silent on the address type the rule permits.
    expect(FREE_MAIL.test(`contact: someone${"@"}psu.edu`)).toBe(false);
  });

  it("scans the whole tracked tree in linear time (discriminator)", () => {
    // The original pattern began `[A-Za-z0-9._%+-]+@`. On input with a long run
    // of local-part characters and no `@`, the engine retries from every offset
    // in the run, which is quadratic. `tools/kernel-probe/kernel-probe.mjs`
    // embeds a 65,536-character run of `x` and contains no `@` at all — a
    // generated file, committed by this project, that took the guard above from
    // 94ms to 13s and pushed it past the suite timeout. A hygiene check that
    // times out is a hygiene check that did not run.
    //
    // The bound is RFC 5321 §4.5.3.1.1's 64-octet limit on a local part, so it
    // is the specification's number rather than a tuned one.
    const adversarial = `${"x".repeat(65_536)} no at-sign anywhere`;
    const started = process.hrtime.bigint();
    expect(FREE_MAIL.test(adversarial)).toBe(false);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    // Measured at ~0.3ms bounded against ~13,000ms unbounded on the development
    // host. Two orders of magnitude of headroom, so this fails on a return of
    // the quadratic pattern rather than on a slow runner.
    expect(elapsedMs).toBeLessThan(1_000);
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

describe("public interface: current institutional record", () => {
  it("records the current repository without replaying transfer-local operational detail", () => {
    const publicInterface = read("docs/artifact/PUBLIC_INTERFACE.md");
    expect(publicInterface).toContain("PSUCyberSecurityLab/ghost-ark");
    expect(publicInterface).not.toContain("Cubits11/ghost-ark");
    expect(publicInterface).not.toMatch(/backup\/|--mirror|\.env\.example/iu);
  });
});
