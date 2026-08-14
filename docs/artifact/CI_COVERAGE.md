# CI Coverage Matrix — what is verified on every commit, and what is not

Tier: **core**. Last audited 2026-08-06.

> **What "audited" means here, precisely.** Re-executed **2026-08-06**, numbers
> taken from live output: `npm test` (164 files / 1270 tests, of which 1 file and
> 9 tests skipped), `npm run scan:claims` (840 files, 0 violations), and `npm audit`
> (**5 advisories: 3 high, 2 moderate** — see the row below; this figure had
> drifted for the second time).
>
> Executed **2026-08-02** and carried forward unchanged since: `npm run
> experiments` (E1, E1-B, E2–E7, E11), `cargo test --locked` on all four Rust
> crates (13 / 13 / 4 / 0), and the strict-JSON-admission suite (24 tests).
>
> **Corrected 2026-08-12, and the correction is the point of this table.** `dab/agent-runtime`
> sits outside the root npm workspaces, and the file at
> `dab/agent-runtime/package-lock.json` was **a copy of `package.json`, not a lockfile**.
> Consequently `npm audit` run in that directory reported `found 0 vulnerabilities` — a
> false green — while Dependabot, which resolves manifest ranges directly, reported a
> **critical**: `vitest ^2.1.0` admits 2.1.0–2.1.8, affected by GHSA-9crc-q9x8-hgqq
> (RCE via the API server) and GHSA-5xrq-8626-4rwp (UI server arbitrary file read/exec).
> Note that `^2.1.9` would NOT have been sufficient — GHSA-5xrq affects everything below
> 3.2.6 — so the range was moved to `^4.1.10`, matching the root. A real lockfile now
> exists at that path, and both CI gates were widened to cover it. The remaining root
> advisories (5 high, 2 moderate) are bundled inside `aws-cdk-lib` and `npm audit fix`
> measurably changes nothing (`added 0, removed 0, changed 0`); they need upstream
> releases, which is why the gate sits at critical.
>
> **Never re-run on either date**, carried forward from their last recorded run:
> the TLC gate (`tools/proofs/run-tlc.sh`), the E10 mutation score, and the
> semgrep finding count. Rows sourced from a carried-forward run say so. A
> document-level "last audited" date that silently covers unexecuted rows is the
> exact defect this matrix was written to expose.

A reviewer's fair question is not "do your tests pass?" but "**which of your artifacts are
guarded, and which can rot silently?**" Before 2026-07-29 the answer was uncomfortable: CI
ran `npm run validate` and `terraform validate` only. The Rust gateway and verifier (2,877
lines), 14 TLA+ specifications with their mutants, and the Python verifier were entirely
unguarded — the three most impressive artifacts in the repository were the three CI never
touched.

This document is the honest matrix. It is deliberately written to be *usable against* the
project.

## Verified on every push and pull request

| Artifact | What runs | Workflow | Directionally asserted? |
|:---|:---|:---|:---|
| TypeScript workspace (57k lines) | `tsc --noEmit`, full `vitest run` | `ci.yml` → `npm run validate` | — |
| Claim-language discipline | `scan:claims` over 838 files, 0 violations required (measured 2026-08-04) | `ci.yml` | yes: forbidden vocabulary fails the build |
| Assumption lattice | `check-assumptions.mjs` | `ci.yml` | yes |
| Required-docs presence | `docs:check` | `ci.yml` | yes: a missing core doc fails the build |
| Terraform | `fmt -check`, `init -backend=false`, `validate` | `ci.yml` | — |
| Python syntax | `py_compile` over all tracked Python | `artifacts-verify.yml` | — |
| **Rust: dab gateway** | `cargo fmt --check`, `clippy -D warnings`, `cargo test --locked` (13 tests) | `artifacts-verify.yml` | — |
| **Rust: dab verifier** | same, `--locked` (13 tests) | `artifacts-verify.yml` | — |
| **Rust: tools/experiments** | same, `--locked` (4 tests, re-run 2026-08-02) | `artifacts-verify.yml` | — |
| **Python verifier behavior** | verifies a valid fixture **and** must reject `MAL-003` | `artifacts-verify.yml` | yes: negative control fails the job if a tampered receipt is accepted |
| **TLA+ specs + mutants** | 5 baselines must pass, 5 mutants must violate. (The `make proof` runner records **6** baselines + 5 mutants; the sixth, `DAB_ExecutionBoundary`, has no mutant, so it is checked but not gated. `TenantIsolation` joined the gate 2026-08-12, rebuilt from a declared stub.) | `artifacts-verify.yml` → `tools/proofs/run-tlc.sh` | **yes: a mutant that passes fails CI** |
| **Experiments E1–E7, E11** | all nine run; guard tests assert measured findings. `GHOST_ARK_REQUIRE_E11=1` turns a missing third-party runtime into a failure in this job, so E11 cannot silently skip where it is supposed to run | `artifacts-verify.yml` | yes: E4 tautology verdict must be PASS; E1-B intervals must be disjoint; E5 must report 0 peer disagreements; E6 must hold 8/8 invariants including antitonicity; E7 must rediscover the 2^53 class; E11 must find kernel members in every third-party arm AND must NOT find the 2^53 collapse outside the JavaScript number model |
| **E14 third-party verifier** | `thirdPartyVerifier.test.ts`: the arm may import nothing from this repository and may not import `hashlib`/`hmac`; the differential must report 0 disagreements; OpenSSL must accept exactly one PSS treatment per RSA fixture | `ci.yml` (in `npm test`) | **yes: three discriminator tests require the arm to reject a tampered signature, a wrong expected key id, and the PSS treatment the fixture was not signed under** |
| **E1-B determinism** | same seed reproduces byte-identical report; different seed does not | `ci.yml` (in `npm test`) | yes: both directions asserted |
| Repo hygiene | no tracked build output, no tracked private keys or `.env`, unbuilt prototypes stay inert, `dab/bench` stays quarantined | `ci.yml` (in `npm test`) | yes |
| **Cross-document figure drift** | `measuredFigureConsistency.test.ts`: measured figures must agree in every document that quotes them; the malicious corpus size and the TLC baseline/mutant split are recomputed from the tracked tree, not asserted; no document may claim a mutant for a spec that has none | `ci.yml` (in `npm test`) | **yes: each check was verified to fail on a reintroduced defect** |
| **Manuscript evidence source** | `paperEvidenceSource.test.ts`: the paper may not cite the quarantined `dab/bench` without disclosure, may not reference it as a reproduction command, must define every macro it invokes, and must resolve every `\ref` | `ci.yml` (in `npm test`) | yes |
| **Cited commands exist** | `citedCommandsResolve.test.ts`: every `npm run` / `make` target cited in a reviewer-facing document must exist. Existence only — a command can exist and measure nothing, which is E4's department | `ci.yml` (in `npm test`) | yes |
| Research classification | every `docs/research/*.md` must be classified | `ci.yml` (in `npm test`) | yes: an unclassified doc fails the build |
| CodeQL | static analysis, `javascript-typescript` | `ci.yml` | — |
| **Semgrep** | `p/default p/security-audit p/secrets`, SARIF uploaded to the Security tab, **gated at ERROR severity** by `tools/ci/sarif-gate.mjs` | `ci.yml` | yes, at ERROR (0 findings). WARNING/INFO remain an untriaged backlog — see the semgrep row under NOT verified |
| **Secret scanning** | gitleaks 8.30.1 CLI, pinned by version and sha256, over **full history** (`--log-opts=--all`, `fetch-depth: 0`); SARIF uploaded; **any** finding fails | `ci.yml` | yes: `main`'s 229-commit history measured clean 2026-08-06 |
| **Workflow hardening** | `workflowHardening.test.ts`: every action pinned to a 40-hex commit with a version comment, no `inputs.`/`github.event.`/`github.head_ref` interpolated into a `run:` block, every workflow declares a concurrency group, no deploy cancels mid-apply | `ci.yml` (in `npm test`) | **yes: all five checks verified to fail on a reintroduced defect** |
| **Lockfile integrity** | `lockfile-lint`: every resolved URL must be an HTTPS npm host. Runs over **both** lockfiles — the root one and `dab/agent-runtime/` (added 2026-08-12; see the row below for why the second one was invisible) | `artifacts-verify.yml` | yes |
| **Dependency advisories** | `npm audit --audit-level=critical` blocks; full report printed non-blocking. Runs over **both** package trees | `artifacts-verify.yml` | yes (at critical) |
| **Strict JSON admission** | 24 tests pinning the fix that takes E1's five unintended kernel members to 0 (measured 2026-08-02) | `ci.yml` (in `npm test`) | yes: each rule paired with a demonstration that the collapse it prevents is real |
| **npm provenance attestation** | `release-provenance.yml`: publishes `@ghost-ark/kernel-probe` to npm on `v*` tag push with `--provenance`. Binds tarball to commit SHA and GitHub Actions execution context. Does **not** prove semantic safety, model alignment, truth, or deployment correctness. | `release-provenance.yml` | yes: fails build on test failure or unpinned action |
| **Receipt-conformance artifact** | `conformanceArtifact.test.ts`: the committed `tools/receipt-conformance/` artifact must match a fresh generation from the pre-registered manifests; the shipped harness must import Node built-ins only; the reference Node verifier must conform on all three levels (36/36 verdict, 30/30 failing-check, 4/4 identity); the E14 third-party arm's three failing-check mismatches are asserted exactly, not hidden | `ci.yml` (in `npm test`) | **yes: four mutant candidates (accept-all, reject-all, wrong-reason, wrong-identity) must each be reported nonconformant, and a missing fixture must abort the run rather than shrink the suite** |

"Directionally asserted" means CI checks that the guard can *fail*, not merely that it
passes. A green invariant with no failing mutant is not evidence.

**What the npm provenance attestation does and does not establish.** For
`@ghost-ark/kernel-probe`, the attestation minted by `npm publish --provenance`
binds the published tarball to this repository, the tagged commit SHA, and the
exact `release-provenance.yml` run that built it — verifiable with
`npm audit signatures` or from the package's registry page. That is supply-chain
custody: the bytes on npm came from this source, built in public CI, and nobody
substituted a different tarball on the way. It establishes nothing about the
code's behaviour — not that the probe's verdicts are correct, not that the code
is free of defects, and nothing about safety or compliance. Those claims live
and die with the experiments and guards in this matrix; the only connection the
attestation has to them is that the workflow runs `npm run validate` before it
publishes, so a tarball cannot ship from a tree whose own gates are red.

## NOT verified in CI — read this section first

These are real gaps. None of them is hidden behind a passing badge.

| Gap | Consequence | Why not |
|:---|:---|:---|
| **No live AWS execution, anywhere** | Every AWS-path claim is local-only or synth-only. No live evidence bundle exists in this repository. | Requires a bounded, approved live AWS window with cost and cleanup runbooks. Deliberately not automated. |
| **No KMS signing path exercised** | KMS-mode signing is unverified end to end. The `kms-style-rsa` fixture is a **local simulation** of the algorithm, not KMS evidence. | Needs live AWS credentials. |
| **eBPF prototype is never built** | `dab/gateway/UNBUILT_PROTOTYPES/bpf/` is inert source text. Its own banner overclaimed and has been corrected in place. | Development host is macOS; no eBPF. No runner configured. |
| **`TenantIsolation.tla` refines only to the design** | Checked clean (149,796 distinct states) with a violating mutant as of 2026-08-12, but like every model here it validates the finite abstraction, not the TypeScript handlers or any AWS deployment. | The refinement layer between model actions and implementation traces does not exist (FORMAL_METHODS_NOTES.md). |
| **`proofs/cloud/*.tla` unchecked** | 4 cloud specifications have no recorded TLC run and no mutants. | Same. |
| **E2 timing on CI runners is not a result** | CI runs E2 as a smoke test only. Shared runners are too noisy for reported latency. | Reported E2 numbers come from a recorded single host; see EXPERIMENTS.md §E2. |
| **No cross-machine reproduction** | All latency figures are one host, one architecture. | Not automated. |
| **Cross-runtime receipt verification is NOT sound today** | E7 finds eight structural divergence classes over four underlying mechanisms across V8, CPython, and jq (measured 2026-08-02 at the 1500-input default; the four extra classes are nesting variants of signed-zero and float-precision), and no two of the three induce the same equivalence relation. A receipt canonicalized in one runtime can fail re-verification in another on inputs as ordinary as `1` versus `1.0`. | This is a property of the JSON number model, not a bug to patch. Mitigating it requires either a single mandated runtime, a stricter admission profile than `strictJsonAdmission` currently enforces (it does not reject `1.0`), or a non-JSON wire format. All three are design decisions, not fixes. |
| **E11 skips outside `artifacts-verify`** | The `ci` and `artifact-evaluation` jobs do not install Ruby, jq, and Rust, so E11 self-skips there. A green `npm test` on a contributor laptop does not mean E11 ran. | Deliberate: those jobs answer different questions, and installing four runtimes everywhere buys nothing. The risk — a skipped generality test reporting green — is closed by `GHOST_ARK_REQUIRE_E11=1` in the one job that does run it, which fails rather than skips. |
| **E7's third arm depends on a system `jq`** | Without jq, E7 runs on two arms and the outlier attribution in its class table is not meaningful. | Reported per-arm rather than silently degraded; CI installs jq explicitly. |
| **E7's outlier attribution is jq-VERSION dependent** | jq 1.7 preserves large integer literals; jq 1.6 converts to double first. On jq ≥ 1.7 V8 is the lone outlier on the 2^53 class; on jq 1.6 CPython is. Debian bookworm ships 1.6, Homebrew ships 1.7.1 — so the same experiment reports opposite attributions on CI and on the development host. | The test now branches on the reported jq version and asserts the correct outlier for each, rather than pinning the host's answer. The version-independent finding — that the class exists and the arms disagree — is asserted unconditionally. **The reported headline "V8 is the outlier" holds for jq ≥ 1.7 and is stated with that qualifier.** |
| **Semgrep's WARNING/INFO backlog is still untriaged** | Measured 2026-08-01: **96 findings** — 48 `github-actions-mutable-action-tag`, 23 `path-join-resolve-traversal`, 9 `contains-bidirectional-characters`, 7 `hardcoded-hmac-key`, 5 `dependabot-missing-cooldown`, and others. **The 48 mutable-tag findings are resolved as of 2026-08-06**: every action is pinned to a 40-hex commit and `workflowHardening.test.ts` fails if one regresses. The remaining ~48 are unreviewed. The full count has NOT been re-measured since the pinning change — re-run semgrep before quoting a total. | The job now gates at ERROR (0 findings) and uploads SARIF, so the backlog is visible in the Security tab rather than only in a log a reviewer cannot open. Gating the rest would fail the build on findings nobody has read, which teaches people to skip the gate. Triage first, then raise. **One ERROR-severity finding was real and is fixed**: `mutation.yml` interpolated a `workflow_dispatch` input directly into a `run:` block — a shell injection, introduced by this repository two commits before semgrep caught it, and now also blocked by a hygiene test. |
| ~~**Semgrep's image pull is flaky**~~ **Resolved 2026-08-06** | One of six consecutive runs failed at `Pull returntocorp/semgrep-agent:v1` with no code change. | The deprecated `semgrep/semgrep-action@v1`, which pulled that image, is gone; the job installs a pinned `semgrep==1.172.0` from PyPI instead. Recorded rather than deleted because the failure was real. |
| **The gitleaks job would have failed on the first push under an organisation** | `gitleaks/gitleaks-action@v2` requires a licence key for repositories owned by an **organisation** ("If you are scanning repos that belong to an organization account, you will need to obtain a free license key"); personal accounts need none. Under the personal account this job ran green, so the defect was invisible until the account boundary was crossed. **Resolved 2026-08-06** by running the gitleaks CLI directly, which carries no such condition. | Found while preparing an institutional move, not by a test — and it is the general shape worth remembering: a CI result measured under one account type is not evidence about another. The replacement is pinned by version and sha256, the same discipline `tools/proofs` applies to `tla2tools.jar`. |
| **The TLA+ toolchain pin is trust-on-first-use** | `scripts/run-proofs.sh` pins the sha256 of the asset served by the official `tlaplus/tlaplus` release for tag `v1.8.0`, fetched 2026-08-01 and verified against the file actually downloaded. There is no independent publication to cross-check it against — Maven Central carries no `org.lamport:tla2tools:1.8.0` — so the pin attests "this is what upstream served on that date", not "this is the authentic build". | This is the honest ceiling for a single-source artifact. Both runners now check the same digest, read from one place, so they cannot drift apart. Resolved from a prior, worse state — see the retraction in EXPERIMENTS.md. |
| **`dab/roundtrip`, `dab/k8s`, `dab/agent-runtime` not exercised** | Socket-level and k8s round-trip evidence exists as recorded runs, not as CI-reproduced runs. | Needs a container runtime and network setup in CI. |
| **Mutation score is scheduled, not per-commit** | E10 runs weekly and on demand (`mutation.yml`), not on every pull request. A trust-kernel change can therefore merge before its mutation impact is known. | Deliberate. Stryker copies the working tree per worker and re-runs covering tests per mutant — hours, not minutes. A gate slow enough that the honest response to a red build is "skip it" is worse than no gate. Promote to blocking on a release branch once the survivor list is worked down. |
| **E10 covers 10 files, not the repository** | The mutation score describes the receipt trust kernel only. Policy evaluation, runtime, vault, retrieval, the gateway, and the CDK stack have **no measured test strength at all**. | Scope is pre-registered in `tools/experiments/mutationScope.ts` and pinned against the import graph. A repo-wide score is not reported because it has not been run. |
| **The kernel's mutation score is 85.8%, and 2.5% of its mutants are unreached** | All ten declared files measured and remediated (2026-08-02): aggregate 85.8% covered (1345/1568), 83.6% on Stryker's total denominator, 223 survivors, 40 mutants executed by no test. Down from 72.3% / 60.6% / 373 / 261 at first measurement. The two weakest were re-swept and remediated 2026-08-12: `kmsSigner.ts` 68.2% → 96.4% (survivors 7 → 1), `signer.ts` 73.2% → 98.1% (survivors 57 → 4); the aggregate was **not** re-derived and now understates the suite. The weakest remaining file is `verifier.ts` (73.6%). | The gate is `break: 80`, set from the measured 83.6%. It has moved 75 → 58 → 70 → 80, each step after a sweep rather than before one. Full table, per-file triage, and the equivalent-mutant arguments in EXPERIMENTS.md §E10. |
| **Real traffic and consumer relevance are measured, but not prevalence-bounded** | E12 sampled a declared real-traffic frame and found 0 of 64 eligible payloads carrying any pathology class. E16 separately runs named, version-pinned consumer engines and observes different decisions on documents with one receipt identity. | E12's independent-producer count is too small to bound a rate, and E16 is an existence result rather than a deployment-incidence study. The repository does not report how often consumer-relevant divergence occurs in practice. |
| **Verifier independence is authorial, not third-party** | E5 reports 0 disagreements across Node and Python, but all three verifiers were written by the same author from the same specification. They can share a misreading. | A genuinely independent reimplementation by another party is the only thing that fixes this, and none exists. **Partially narrowed by E11**, which measures four canonicalizers written entirely outside this repository — but E11 tests canonicalization, not receipt verification, so the verifier-independence gap itself is still open. |
| **Compromised-signer coverage is HMAC-only** | E4-B closed the original gap — 5 of 10 verifier checks were unisolatable (E4 finding F4.3) — but only for HMAC. There is still no RSA/KMS compromised-signer fixture (public key only), and no record-receipt (`rct_`) fixture, which leaves the `tenant` check unisolated. | The earlier "no compromised-signer fixtures" entry survived the commit that closed it and is corrected here rather than deleted; see EXPERIMENTS.md §E4-B. |
| **npm advisories remain** | `npm audit` reports **5** advisories (**3 high, 2 moderate**) as of 2026-08-06, all reached through devDependencies. Not in the shipped runtime path, but CI and developer machines execute them, so dev-only lowers severity rather than eliminating it. **This row has now been wrong twice**: it read "8 high-severity advisories" when the true count was 3, was corrected on 2026-08-02, and had drifted again to 5 by 2026-08-06 without anyone touching the manifest. | Roots verified by `npm ls` on 2026-08-06, all dev: `@cyclonedx/cyclonedx-npm` → `libxmljs2` → `node-gyp` → … (`brace-expansion`, `ip-address`); `@stryker-mutator/core` → `typed-rest-client` → `qs`; and `ajv` → `fast-uri`. The CI gate is `critical`, which the repository meets, rather than `high`, which it would fail — a threshold met is worth more than a threshold declared. **A count that drifts with no local change is the point of the row**: advisories are published against dependencies you already have, so this number decays on the calendar, not on commits. Re-measure on the day you quote it; do not carry it forward. |
| **GitHub Actions are pinned to mutable tags** | `actions/checkout@v4` and similar can be repointed by whoever controls the action repository, so each is an unpinned dependency with access to CI. | Pinning every action to a commit SHA is the strong fix and is not yet done. Dependabot's `github-actions` ecosystem is configured as the prerequisite. The `supply-chain` job sets `persist-credentials: false` so the job that executes third-party code does not also hold the workflow token. |
| **`tools/experiments-json` has zero tests** | A fourth Rust crate exists and `cargo test --locked` on it reports `0 passed` (measured 2026-08-02). It compiles in CI and is otherwise unguarded; this row exists because the crate was absent from this matrix entirely, so its emptiness read as coverage. | It is a thin JSON-emitting helper for the experiments harness whose output is consumed by tests that *do* exist. That is an argument for low risk, not for zero tests, and it is stated here rather than left off the table. Dependabot enrolment is step 78 of the plan. |
| **NFC/NFD over-discrimination is unfixed** | Semantically identical strings in different normalization forms receive different receipt identities, so evidence that crossed a normalizing hop fails re-verification. | A fix requires choosing a normalization policy for signed string values, which changes what gets signed and needs a receipt schema migration. Deliberately not done as a side effect of a hardening pass. |

## Evidence-tier vocabulary

Used consistently across this repository; a claim without one of these tiers is unlabelled
and should be treated as unsupported.

- **local-only** — runs and is verified on a developer machine and in CI.
- **AWS-synth-only** — a CloudFormation template is generated and asserted. Proves nothing
  about runtime behavior.
- **AWS-live** — executed against real AWS with a preserved, sanitized evidence bundle.
  **Nothing in this repository currently holds this tier.**
- **research-only** — a model, protocol, or analysis with no runtime binding.
- **aspirational** — design text with no implementation. `UNBUILT_PROTOTYPES/` is here.
- **non-claim** — explicitly disclaimed.

## Reproducing the full local gate

```bash
npm ci
npm run validate          # lint, full test suite, docs check, claim scan, assumptions
npm run test:experiments  # experiment guards + repo hygiene
npm run experiments       # E1-E4, printing measured results
```

Rust and TLA+ are not in `npm run validate` because they need non-Node toolchains:

```bash
cd dab/gateway && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked
cd dab/verifier && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked
```

```bash
curl -fsSL -o tla2tools.jar https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar
bash tools/proofs/run-tlc.sh
```
