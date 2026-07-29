# CI Coverage Matrix — what is verified on every commit, and what is not

Tier: **core**. Last audited 2026-07-29.

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
| Claim-language discipline | `scan:claims` over 772 files, 0 violations required | `ci.yml` | yes: forbidden vocabulary fails the build |
| Assumption lattice | `check-assumptions.mjs` | `ci.yml` | yes |
| Required-docs presence | `docs:check` | `ci.yml` | yes: a missing core doc fails the build |
| Terraform | `fmt -check`, `init -backend=false`, `validate` | `ci.yml` | — |
| Python syntax | `py_compile` over all tracked Python | `artifacts-verify.yml` | — |
| **Rust: dab gateway** | `cargo fmt --check`, `clippy -D warnings`, `cargo test --locked` (13 tests) | `artifacts-verify.yml` | — |
| **Rust: dab verifier** | same, `--locked` (13 tests) | `artifacts-verify.yml` | — |
| **Rust: tools/experiments** | same, `--locked` (4 tests) | `artifacts-verify.yml` | — |
| **Python verifier behavior** | verifies a valid fixture **and** must reject `MAL-003` | `artifacts-verify.yml` | yes: negative control fails the job if a tampered receipt is accepted |
| **TLA+ specs + mutants** | 4 baselines must pass, 4 mutants must violate | `artifacts-verify.yml` → `tools/proofs/run-tlc.sh` | **yes: a mutant that passes fails CI** |
| **Experiments E1–E4** | all four run; guard tests assert measured findings | `artifacts-verify.yml` | yes: E4's tautology verdict must be PASS |
| Repo hygiene | no tracked build output, no tracked private keys or `.env`, unbuilt prototypes stay inert, `dab/bench` stays quarantined | `ci.yml` (in `npm test`) | yes |
| Research classification | every `docs/research/*.md` must be classified | `ci.yml` (in `npm test`) | yes: an unclassified doc fails the build |
| CodeQL / Semgrep / gitleaks | static analysis and secret scanning | `ci.yml` | — |
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
| **`dab/roundtrip`, `dab/k8s`, `dab/agent-runtime` not exercised** | Socket-level and k8s round-trip evidence exists as recorded runs, not as CI-reproduced runs. | Needs a container runtime and network setup in CI. |
| **Stryker mutation testing not in CI** | `stryker.config.json` exists; mutation score is not gated. | Runtime cost. Run locally. |
| **No real-traffic corpus for E1** | E1 shows unintended kernel members are *possible and present*, never how *frequent*. | This is falsifier F2 in `00_THESIS.md` and the single largest open weakness. |
| **No compromised-signer fixtures** | 5 of 10 verifier checks cannot be isolated by the corpus (E4 finding F4.3). | The corpus does not model an attacker holding the signing key. Highest-value next fixture. |
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
