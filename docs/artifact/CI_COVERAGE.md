# CI Coverage Matrix — what is verified on every commit, and what is not

Tier: **core**. Last audited 2026-08-02.

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
| Claim-language discipline | `scan:claims` over 827 files, 0 violations required | `ci.yml` | yes: forbidden vocabulary fails the build |
| Assumption lattice | `check-assumptions.mjs` | `ci.yml` | yes |
| Required-docs presence | `docs:check` | `ci.yml` | yes: a missing core doc fails the build |
| Terraform | `fmt -check`, `init -backend=false`, `validate` | `ci.yml` | — |
| Python syntax | `py_compile` over all tracked Python | `artifacts-verify.yml` | — |
| **Rust: dab gateway** | `cargo fmt --check`, `clippy -D warnings`, `cargo test --locked` (13 tests) | `artifacts-verify.yml` | — |
| **Rust: dab verifier** | same, `--locked` (13 tests) | `artifacts-verify.yml` | — |
| **Rust: tools/experiments** | same, `--locked` (4 tests) | `artifacts-verify.yml` | — |
| **Python verifier behavior** | verifies a valid fixture **and** must reject `MAL-003` | `artifacts-verify.yml` | yes: negative control fails the job if a tampered receipt is accepted |
| **TLA+ specs + mutants** | 4 baselines must pass, 4 mutants must violate | `artifacts-verify.yml` → `tools/proofs/run-tlc.sh` | **yes: a mutant that passes fails CI** |
| **Experiments E1–E7** | all eight run; guard tests assert measured findings | `artifacts-verify.yml` | yes: E4 tautology verdict must be PASS; E1-B intervals must be disjoint; E5 must report 0 peer disagreements; E6 must hold 8/8 invariants including antitonicity; E7 must rediscover the 2^53 class |
| **E1-B determinism** | same seed reproduces byte-identical report; different seed does not | `ci.yml` (in `npm test`) | yes: both directions asserted |
| Repo hygiene | no tracked build output, no tracked private keys or `.env`, unbuilt prototypes stay inert, `dab/bench` stays quarantined | `ci.yml` (in `npm test`) | yes |
| Research classification | every `docs/research/*.md` must be classified | `ci.yml` (in `npm test`) | yes: an unclassified doc fails the build |
| CodeQL / Semgrep / gitleaks | static analysis and secret scanning | `ci.yml` | — (see the semgrep row under NOT verified) |
| **Lockfile integrity** | `lockfile-lint`: every resolved URL must be an HTTPS npm host | `artifacts-verify.yml` | yes |
| **Dependency advisories** | `npm audit --audit-level=critical` blocks; full report printed non-blocking | `artifacts-verify.yml` | yes (at critical) |
| **Strict JSON admission** | 24 tests pinning the fix for E1's three unintended kernel members | `ci.yml` (in `npm test`) | yes: each rule paired with a demonstration that the collapse it prevents is real |

"Directionally asserted" means CI checks that the guard can *fail*, not merely that it
passes. A green invariant with no failing mutant is not evidence.

## NOT verified in CI — read this section first

These are real gaps. None of them is hidden behind a passing badge.

| Gap | Consequence | Why not |
|:---|:---|:---|
| **No live AWS execution, anywhere** | Every AWS-path claim is local-only or synth-only. No live evidence bundle exists in this repository. | Requires a bounded, approved live AWS window with cost and cleanup runbooks. Deliberately not automated. |
| **No KMS signing path exercised** | KMS-mode signing is unverified end to end. The `kms-style-rsa` fixture is a **local simulation** of the algorithm, not KMS evidence. | Needs live AWS credentials. |
| **eBPF prototype is never built** | `dab/gateway/UNBUILT_PROTOTYPES/bpf/` is inert source text. Its own banner overclaimed and has been corrected in place. | Development host is macOS; no eBPF. No runner configured. |
| **`TenantIsolation.tla` is an unchecked stub** | Tenant-isolation is *modelled* but not model-checked, and has no mutant. | Not yet written to a checkable state. It is excluded from `run-tlc.sh` rather than passed vacuously. |
| **`proofs/cloud/*.tla` unchecked** | 4 cloud specifications have no recorded TLC run and no mutants. | Same. |
| **E2 timing on CI runners is not a result** | CI runs E2 as a smoke test only. Shared runners are too noisy for reported latency. | Reported E2 numbers come from a recorded single host; see EXPERIMENTS.md §E2. |
| **No cross-machine reproduction** | All latency figures are one host, one architecture. | Not automated. |
| **Cross-runtime receipt verification is NOT sound today** | E7 finds four structural divergence classes across V8, CPython, and jq, and no two of the three induce the same equivalence relation. A receipt canonicalized in one runtime can fail re-verification in another on inputs as ordinary as `1` versus `1.0`. | This is a property of the JSON number model, not a bug to patch. Mitigating it requires either a single mandated runtime, a stricter admission profile than `strictJsonAdmission` currently enforces (it does not reject `1.0`), or a non-JSON wire format. All three are design decisions, not fixes. |
| **E7's third arm depends on a system `jq`** | Without jq, E7 runs on two arms and the outlier attribution in its class table is not meaningful. | Reported per-arm rather than silently degraded; CI installs jq explicitly. |
| **E7's outlier attribution is jq-VERSION dependent** | jq 1.7 preserves large integer literals; jq 1.6 converts to double first. On jq ≥ 1.7 V8 is the lone outlier on the 2^53 class; on jq 1.6 CPython is. Debian bookworm ships 1.6, Homebrew ships 1.7.1 — so the same experiment reports opposite attributions on CI and on the development host. | The test now branches on the reported jq version and asserts the correct outlier for each, rather than pinning the host's answer. The version-independent finding — that the class exists and the arms disagree — is asserted unconditionally. **The reported headline "V8 is the outlier" holds for jq ≥ 1.7 and is stated with that qualifier.** |
| **Semgrep reports but does not gate** | The job is green while semgrep reports **96 findings** (measured 2026-08-01 with `p/default p/security-audit p/secrets`): 48 `github-actions-mutable-action-tag`, 23 `path-join-resolve-traversal`, 9 `contains-bidirectional-characters`, 7 `hardcoded-hmac-key`, 5 `dependabot-missing-cooldown`, and others. A passing badge here means "the scanner ran", not "the scanner found nothing". | The findings are unreviewed, so raising the gate now would fail the build on a backlog nobody has triaged — and a gate that fails for reasons nobody has read is one people learn to skip. The honest sequence is triage first, then gate at a level the repository actually meets, as `npm audit --audit-level=critical` already does. **One ERROR-severity finding was real and is fixed**: `mutation.yml` interpolated a `workflow_dispatch` input directly into a `run:` block — a shell injection, introduced by this repository two commits before semgrep caught it. ERROR-severity count is now 0. |
| **Semgrep's image pull is flaky** | One of six consecutive runs failed at `Pull returntocorp/semgrep-agent:v1` with no code change. | Transient Docker Hub failure, not rot — the image still resolves. Noted because a security job that goes red at random is the fastest way to teach a team to ignore red. |
| **The TLA+ toolchain pin is trust-on-first-use** | `scripts/run-proofs.sh` pins the sha256 of the asset served by the official `tlaplus/tlaplus` release for tag `v1.8.0`, fetched 2026-08-01 and verified against the file actually downloaded. There is no independent publication to cross-check it against — Maven Central carries no `org.lamport:tla2tools:1.8.0` — so the pin attests "this is what upstream served on that date", not "this is the authentic build". | This is the honest ceiling for a single-source artifact. Both runners now check the same digest, read from one place, so they cannot drift apart. Resolved from a prior, worse state — see the retraction in EXPERIMENTS.md. |
| **`dab/roundtrip`, `dab/k8s`, `dab/agent-runtime` not exercised** | Socket-level and k8s round-trip evidence exists as recorded runs, not as CI-reproduced runs. | Needs a container runtime and network setup in CI. |
| **Mutation score is scheduled, not per-commit** | E10 runs weekly and on demand (`mutation.yml`), not on every pull request. A trust-kernel change can therefore merge before its mutation impact is known. | Deliberate. Stryker copies the working tree per worker and re-runs covering tests per mutant — hours, not minutes. A gate slow enough that the honest response to a red build is "skip it" is worse than no gate. Promote to blocking on a release branch once the survivor list is worked down. |
| **E10 covers 10 files, not the repository** | The mutation score describes the receipt trust kernel only. Policy evaluation, runtime, vault, retrieval, the gateway, and the CDK stack have **no measured test strength at all**. | Scope is pre-registered in `tools/experiments/mutationScope.ts` and pinned against the import graph. A repo-wide score is not reported because it has not been run. |
| **The kernel's mutation score is 85.8%, and 2.5% of its mutants are unreached** | All ten declared files measured and remediated (2026-08-02): aggregate 85.8% covered (1345/1568), 83.6% on Stryker's total denominator, 223 survivors, 40 mutants executed by no test. Down from 72.3% / 60.6% / 373 / 261 at first measurement. The weakest remaining are `kmsSigner.ts` (68.2%), `signer.ts` (73.2%), and `verifier.ts` (73.6%). | The gate is `break: 80`, set from the measured 83.6%. It has moved 75 → 58 → 70 → 80, each step after a sweep rather than before one. Full table, per-file triage, and the equivalent-mutant arguments in EXPERIMENTS.md §E10. |
| **No real-traffic corpus for E1/E1-B** | E1-B quantifies the collapse rate under a *declared synthetic generator* (52.5% [49.0%, 56.1%] unguarded). That interval describes sampling variability under that generator, NOT production receipt traffic. | This is falsifier F2 in `00_THESIS.md` and remains the single largest open weakness. Breadth (12→31 classes) and a sampled arm narrow it; only real traffic closes it. |
| **Verifier independence is authorial, not third-party** | E5 reports 0 disagreements across Node and Python, but all three verifiers were written by the same author from the same specification. They can share a misreading. | A genuinely independent reimplementation by another party is the only thing that fixes this, and none exists. |
| **Compromised-signer coverage is HMAC-only** | E4-B closed the original gap — 5 of 10 verifier checks were unisolatable (E4 finding F4.3) — but only for HMAC. There is still no RSA/KMS compromised-signer fixture (public key only), and no record-receipt (`rct_`) fixture, which leaves the `tenant` check unisolated. | The earlier "no compromised-signer fixtures" entry survived the commit that closed it and is corrected here rather than deleted; see EXPERIMENTS.md §E4-B. |
| **8 high-severity npm advisories remain** | `npm audit` reports 10 advisories (8 high, 2 moderate), all devDependencies. Not in the shipped runtime path, but CI and developer machines execute them, so dev-only lowers severity rather than eliminating it. | The chain roots in the SBOM toolchain (`@cyclonedx/cyclonedx-npm` → `libxmljs2` → `node-gyp` → …) and clearing it needs a breaking major. `npm audit fix` took 13 → 10. The CI gate is set at `critical`, which the repository actually meets, rather than at `high`, which it would fail — a threshold met is worth more than a threshold declared. Dependabot is configured to move these. |
| **GitHub Actions are pinned to mutable tags** | `actions/checkout@v4` and similar can be repointed by whoever controls the action repository, so each is an unpinned dependency with access to CI. | Pinning every action to a commit SHA is the strong fix and is not yet done. Dependabot's `github-actions` ecosystem is configured as the prerequisite. The `supply-chain` job sets `persist-credentials: false` so the job that executes third-party code does not also hold the workflow token. |
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
