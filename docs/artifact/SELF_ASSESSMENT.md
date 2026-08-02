# Self-Assessment — 2026-08-01

Tier: **core**. This document is written to be used against the project.

Every claim below links to something runnable or to a commit. Where a number is
quoted, the command that produced it is named. Where something is broken, it is
named as broken rather than described as in-progress.

## The headline finding of this audit

**Continuous integration failed on `main` for at least 40 consecutive runs,
from 2026-07-17 to 2026-08-01, while `docs/artifact/CI_COVERAGE.md` described a
matrix of artifacts as "verified on every push and pull request."**

That is the worst defect this repository has carried. Not because CI was red —
CI goes red — but because the document whose entire purpose is to tell a
reviewer what is actually checked was, for two weeks, describing a system that
was not running. A reviewer who trusted `CI_COVERAGE.md` would have been
misled by the one file specifically written to prevent that.

The root causes, once reproduced properly:

| Cause | Why it hid |
|:---|:---|
| `npm ci` failed with `ERESOLVE` (`@vitejs/plugin-react@6` → `vite@8` → `esbuild ^0.27\|\|^0.28` against a root pin of `^0.25.5`) | The developer's user-level `~/.npmrc` carries `legacy-peer-deps=true`, which downgrades `ERESOLVE` to a warning. Every local run was green. "Works locally" was not evidence — it was machine-local config doing invisible work. |
| `cargo fmt --check` failed on all three Rust crates | Never run locally before pushing. |
| `dab/gateway/src/v200.rs` did not compile | Its NSM call used a bulk `DescribePCRs` API that does not exist. The branch is `#[cfg(target_os = "linux")]`, so macOS never compiled it and CI always did. |
| `cgroupOrchestrator.test.ts` asserted a mock-fallback value | The fallback is only reached when the real `/proc` lookup fails. It passed on macOS, where cgroups do not exist, and failed on Linux, where the feature is real. |

The diagnosis took reproducing the runner in Docker. Four earlier hypotheses —
lockfile desync, platform-constrained packages, `engines` mismatch,
case-sensitivity — were each checked and each wrong. Local reproduction on the
development host could not have found this, because the development host was
the problem.

## What was found inside the code

**`v200.rs` returned a fabricated attestation pass.** Off-Linux,
`fetch_local_pcrs` returned `EXPECTED_GHOST_ARK_V200_HASH` — the exact constant
`verify_and_merge_intent` compares against — so the hardware-attestation check
passed unconditionally on the development host while the real path could not
build. That "pristine hash" is the ASCII string
`v200-pristine-hash-placeholder`; `DummyLwwMap::apply` returns
`"sha256:merged-state-root-placeholder"`. A placeholder labelled as a digest is
the defect this repository already retracted once, in `"ci": "sha256:A"` under a
heading reading "Raw Benchmark Output". It recurred, in the library, for weeks,
with zero tests. Now quarantined to `UNBUILT_PROTOTYPES/rust/`.

**E1's own harness reported a different headline depending on the
environment.** With `python3` present, `universal_unintended_kernel` is 4; with
it absent, 5 — and both runs exited 0. A missing interpreter was reported
through the same channel CPython uses to reject an input, so the arm scored
fail-closed on all 31 classes, stopped being a *deciding* arm, and silently left
the unanimity quantifier. E1 now refuses to emit a census with a missing arm.

**E7's headline attribution depends on the jq version.** jq 1.7 preserves large
integer literals; jq 1.6 converts to double first. On jq ≥ 1.7, V8 is the lone
outlier on the 2^53 class. On jq 1.6, CPython is. Debian ships 1.6; Homebrew
ships 1.7.1. The published finding holds for jq ≥ 1.7 and now says so.

**The claim gate had an extension-shaped blind spot.** A 363 KB, 7,941-line
context dump sat at the repository root as `.txt`, which the scanner does not
read. Copied into a scanned extension it trips 319 findings, and it preserved
the retracted "Mitigations implemented for Zero-Days 1, 3, 4, 5" banner at its
pre-quarantine path. Removed; a hygiene test now blocks the pattern.

## The first mutation score

`npm run mutation && npm run mutation:summarize`, host darwin/arm64 Apple M1 ×8,
node v22.22.3, 22m49s for 334 mutants:

| file | score | killed | survived | no coverage |
|:---|---:|---:|---:|---:|
| `packages/receipt-schema/src/strictJsonAdmission.ts` | **81.4%** (263/323) | 263 | **60** | 11 |

Stryker's own headline is 78.7% (263/334); the difference is whether uncovered
mutants sit in the denominator. Both are stated because quoting one without
saying which is the error.

**This is 1 of 10 declared files.** The other nine are unmeasured. The 60
survivors cluster in the escape-sequence dispatch and the bounds arithmetic of
the admission scanner — the text-level parser that E1's entire mitigation claim
rests on. Eleven mutants are executed by no test in the declared scope at all.

The fix itself is not in doubt: E1 measures unintended kernel members 5 → 0
directly. What E10 shows is that the *tests around* that fix are weaker than the
fix's importance warrants.

## What is genuinely strong

- **The doctrine works.** Every defect above was found by applying rules this
  repository already wrote down — the E4 discriminator, "report what was not
  measured," "no proportion without its denominator." The rules are not
  decoration; they located real bugs in the code that wrote them.
- **Negative results are published.** E7's cross-runtime finding — no two of
  three JSON pipelines induce the same equivalence relation — is a result
  against the project's own convenience, and it is in the README-linked docs
  rather than a footnote.
- **Invariants are directionally asserted.** TLA+ specs ship with mutants that
  must violate. A green spec with no failing mutant is not accepted as evidence.
- **The Provenance Kernel Problem is a real contribution.** `Sound(C, Σ, P)` is
  ternary, the kernel is monotone in the alphabet and the intended set antitone
  in consumers, so soundness does not persist even with the canonicalizer
  unchanged. E6 measures the antitonicity on the implementation rather than
  assuming it from the formalism.

## Rating

**6.5 / 10 as a research artifact. 4 / 10 as a maintained system.**

The gap between those two numbers is the finding. The science is real: the
experiments are pre-registered, the negative results are published, the claim
boundary is enforced by a scanner rather than by intention. A skeptical reviewer
can run `npm run validate` on a clean clone and get a green result they can
inspect.

But for two weeks that same reviewer would have gotten a red one, and the
document that told them what was checked would have been wrong. A verification
artifact whose own verification is broken is making a claim it cannot support,
and the sophistication of everything above it does not compensate.

What would move this to 8:

1. ~~Answer the `tla2tools.jar` hash question.~~ **Answered, and the answer was
   worse than upstream drift.** The pin `58d44845…` was recorded 2026-07-15 for
   a release first published 2026-07-31 — the URL 404'd on the day it was
   pinned, so the digest can never have been computed from it, and it matches no
   artifact obtainable today. The proof stage of `make reproduce` therefore
   checked **zero** specifications for sixteen days while `tools/proofs/run-tlc.sh`
   fetched the same jar with no integrity check and reported green. Both runners
   now verify one digest, computed from the file actually downloaded, read from a
   single source. The remaining limitation is honest and stated: it is
   trust-on-first-use against upstream, because no independent publication of
   this artifact exists to cross-check.
2. ~~Complete E10 over all ten declared files~~ **Done (2026-08-02): 72.3% covered
   aggregate, 60.6% total, 261 mutants unreached.** Working the 373-survivor list
   down is the remaining half, and it is the larger half.
3. A real-traffic corpus — falsifier F2, still the largest open weakness.
4. A third-party reimplementation of the verifier. All three current verifiers
   share one author and can share one misreading.

## Not claimed

This document rates engineering and epistemic hygiene. It is not evidence of
security, correctness, compliance, or production readiness, and a self-assigned
number is not an external review. The repository has never been audited by
anyone other than its author and an AI assistant working under its rules.
