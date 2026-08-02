
# CLAUDE.md — Ghost-Ark Repository Instructions

Claude must read this file before making changes in this repository.

Ghost-Ark is an AWS-native reference implementation for bounded governance receipts and deterministic enforcement primitives around LLM/agentic AI applications.

Core claim boundary:

Ghost-Ark provides cryptographic receipts and bounded governance evidence. It verifies what was recorded, signed, policy-bounded, and replayable under Ghost-Ark verifier rules. It does not prove semantic safety, truth, compliance, alignment, production readiness, or deployment correctness.

## Operating Rules

Before modifying files, Claude must state:

1. files to inspect

2. files to create

3. files to modify

4. tests to add or update

5. commands to run

6. risk of the change

7. what will not be claimed

Do not commit unless explicitly instructed.

Do not run AWS deployment commands unless explicitly instructed.

Do not weaken tests, schemas, canonicalization, signature validation, tenant-boundary checks, or claim boundaries.

## Required Validation

For normal changes:

npm run lint

npx vitest run <new-or-modified-test-file>

For significant changes:

npm run lint

npm test

Do not claim success without command output or explicit limitation.

## Non-Claims

Never claim or imply:

- production-ready

- safe AI

- proves safety

- compliant

- compliance-certified

- formally verified

- trustless

- zero-knowledge

- secure by default

- prevents all attacks

- guarantees safety

- absolute-security language

- deployment-safety certification

- production enclave security

Allowed only in explicit limitation, warning, policy, research-only, or non-claim contexts.

## Core Project Thesis

Ghost Protocol = doctrine and threat model.

Ghost-Ark = AWS-native evidence/control-plane implementation.

CC-Framework = measurement science for correlated guardrail failure.

Unified thesis:

Verifiable Agent Governance under Correlated Guardrail Failure.

## Current Baseline

Measured at head on 2026-08-01. Re-measure before quoting; do not copy a stale number
forward. The previous entry in this file read "86/86 test files, 559/559 tests" while the
actual suite was 133 files and 849 tests — a documented baseline that disagreed with reality
on the first thing a reviewer checks.

- npm run lint passes

- npm test passes: 157 test files, 1208 tests (1 file / 9 tests skipped)

- npm run scan:claims: 828 files scanned, 0 forbidden-claim violations

- npm run assumptions: 7 annotated modules, 0 lattice violations

- cargo test --locked: 26 Rust tests pass (13 dab/gateway + 13 dab/verifier); clippy clean under -D warnings

- tools/proofs/run-tlc.sh: 4 TLA+ baselines clean, 4 mutants violate as required

- GitHub Actions: ci, artifacts-verify, and artifact-evaluation all green on main
  (2026-08-01). Before this date CI had failed on main for 40+ consecutive runs
  while CI_COVERAGE.md described the same artifacts as verified. Check the badge
  state, not the document, before believing either.

Known flake, fixed: two CDK-synth tests exceeded the 15s global vitest timeout under
parallel load, making npm test nondeterministically red on a clean clone. The synth is now
memoized and pre-warmed in beforeAll. Do not reintroduce a per-test synth in
infra/cdk/test/api-stack-governed-invoke.test.ts or tests/integration/api/template-auth.test.ts.

Public-surface rules: `docs/artifact/PUBLIC_INTERFACE.md` states what belongs in this
repository now that it is published under an institutional account — no career
correspondence, no commercial planning, no developer machine paths, no self-assigned
grades. Enforced by `tests/unit/repo-hygiene/publicInterface.test.ts`.

Human-facing twin: `CONTRIBUTING.md` states these same operating rules for human
contributors. The duplication is deliberate. Where the two disagree, this file governs for
assistants and `CONTRIBUTING.md` governs for humans — and the disagreement is a bug, so fix
both in the same commit.

Recent hardening areas:

- receipt canonicalization

- signature envelope validation

- execution nonce consistency

- replay compatibility

- base64 signature validation

- KMS/HMAC signing boundaries

- CDK/security environment assertions

Do not undo these hardening changes.

## Important Directories

apps/

packages/receipt-schema/

packages/enforcement-runtime/

services/

infra/cdk/

infra/terraform/

schemas/

tests/

docs/

examples/

tools/

Be careful with:

packages/receipt-schema/src/hashCanonicalization.ts

packages/enforcement-runtime/src/receipts/canonical.ts

packages/enforcement-runtime/src/receipts/signer.ts

packages/enforcement-runtime/src/receipts/emission.ts

packages/enforcement-runtime/src/receipts/verifier.ts

packages/enforcement-runtime/src/runtime/

packages/enforcement-runtime/src/retrieval/

packages/enforcement-runtime/src/vault/

infra/cdk/lib/api-stack.ts

README.md

## Empirical and Statistical Rules

These are binding. Each exists because this repository violated it and the violation was
found in audit. Full detail in docs/research/EXPERIMENTS.md.

No point estimate without a dispersion measure. Latency is p50 with IQR, never a bare p50.

No proportion without its denominator, and no detection rate without a control arm. A
verifier that rejects everything scores 100% detection and is useless; the control arm is
what makes the number mean anything.

No confidence interval over a curated census. A CI describes sampling variability under
repeated random draws. A hand-authored corpus has none: it is the whole population and its
size is an authoring decision. Use reportProportion with provenance "census" and report exact
counts. A Wilson interval was once computed at n = 2 and called a robust lower bound; at 2/2
that lower bound is below 0.4.

No interval below n = 30 (MIN_N_FOR_PROPORTION_INTERVAL), even for genuine random samples.

No hypothesis selected from the same data used to bound it. Discovery and confirmation are
separate tiers.

Pre-register intent before measuring. E1's consumer intents live in
tools/experiments/kernelAlphabet.ts and are pinned by a test, so editing one to match a
result surfaces in review.

State the host for any timing claim. A latency figure without a machine is not reproducible.

Report what was not measured. A silently dropped arm makes the system look better than it is.

A detection benchmark must invoke a real component. If a check would still report
"detected" when the mechanism it depends on is broken, it is tautological and measures
nothing. Apply the E4 discriminator: break the mechanism, confirm detection stops. Do not add
new benchmarks to dab/bench, which is quarantined for exactly this defect.

Never present a placeholder as measured output. The string "sha256:A" once appeared inside a
block labelled "Raw Benchmark Output" in the dissertation, emitted by the benchmark itself.

## Receipt Rules

Preserve deterministic canonical JSON.

Reject host-language non-JSON objects before signing.

Do not claim RFC 8785 / JCS compliance unless explicitly implemented and tested.

Receipt v1 compatibility matters. Do not change semantic multiplicity of fields such as action_taken without a schema migration.

## Signature Rules

Signing proves signing authorization over the receipt payload. It does not prove the AI output is true or safe.

Local HMAC is dev-only.

KMS signing is intended AWS mode.

KMS key IDs in verification-critical paths should be immutable key ARNs, not mutable aliases.

KMS signing does not prove hardware attestation or runtime integrity.

Do not claim Nitro Enclave/PCR-bound execution integrity unless an explicit AWS-supported attestation flow is implemented and tested.

## AWS Reality Boundary

Never claim the full cloud path exists unless it has live AWS evidence.

Distinguish:

- local-only

- AWS-synth-only

- AWS-live

- research-only

- aspirational

- non-claim

Target cloud architecture:

Cloud Security Evidence Analyst Agent on AWS.

Future path:

API Gateway

Cognito / Lambda authorizer

Governed Invoke Lambda

Policy repository

Server-side retrieval provider

Bedrock Guardrails input assessment

Read-only tool gateway

Allowlisted Bedrock model invocation

Post-model policy and redaction

Bedrock Guardrails output assessment

KMS-signed decision receipt

DynamoDB receipt ledger

S3 Object Lock checkpoint bundle

CloudWatch/X-Ray trace binding

Sanitized evidence bundle

CC-Framework observation export

## Tool Gateway Boundary

Initial agent tools must be read-only.

Allowed initial tools:

- read CloudWatch alarm state

- read DynamoDB receipt metadata

- read sanitized S3 evidence bundles

- query Athena read-only datasets

- search evidence index if configured

- summarize sanitized deployment outputs

Forbidden initial tools:

- delete resources

- modify IAM

- rotate keys

- write production data

- send emails

- create external side effects

- execute arbitrary shell in cloud

No tool use without receipt semantics.

## Frontier Task Preference

If asked to run the frontier cartographer task, prefer this bounded sequence:

1. Create docs/research/INVISIBLE_FRONTIER_PROBLEMS.md

2. Create docs/claims/CLAIM_EVIDENCE_ATTACK_MAP.md

3. Create schemas/ghost_claim_evidence_attack_map.v1.json

4. Create docs/architecture/CLOUD_AGENT_GOVERNANCE_TARGET.md

5. Implement tools/claims/scan-claims.ts

6. Create docs/claims/CLAIM_LANGUAGE_POLICY.md

7. Create tests/integration/claims/claimLanguagePolicy.test.ts

8. Run lint and targeted tests

9. Run full tests if practical

Do not implement Bedrock Guardrails, server-side retrieval, tool gateway, formal model, and claim scanner all in one pass.

## Completion Report

At the end of substantial work, report:

Files created:

Files modified:

Commands run:

Tests:

Security/claim impact:

Remaining gaps:

Next highest-leverage task:

## North Star

A skeptical reviewer should be able to say:

I do not trust the author.

I do not trust the README.

I do not trust the model.

But I can inspect the receipt, replay the canonical digest, verify the signature, map the claim to evidence, inspect the non-claim, and reproduce the failure boundary.

---

# Execution Plan — 112 Steps

Written 2026-08-02 against measured repository state, not aspiration. Every step
names an acceptance criterion that is checkable by command. A step without a
passing acceptance criterion is not done, regardless of how much work went into
it.

**How to use this.** Work phases in order; within a phase, order is a
recommendation. Do not batch — each step is sized to be one commit with its
acceptance output in the message. When a step turns out to be wrong or already
done, strike it through with the evidence rather than deleting it: a silently
removed step is indistinguishable from one never planned.

**The brutal framing.** Phases 0–3 are debts already incurred. Phase 4 onward is
new work. If effort is limited, Phase 1 outranks everything else in this file:
no third party has ever run this artifact, and every other number here is
self-reported.

## Phase 0 — The record is currently wrong (do first, cheap)

1. Re-measure `npm audit`; CI_COVERAGE claims "8 high-severity advisories" and the actual count is 3 (1 high, 2 moderate). — Acceptance: the row matches `npm audit` output on the day of the commit.
2. Add a dated "measured on" stamp to every numeric claim in CI_COVERAGE. — Acceptance: no bare number without a date.
3. Audit CI_COVERAGE end to end against live commands. — Acceptance: every row reproduced or corrected in one commit.
4. Do the same for `README-AE.md`. — Acceptance: each claim→command pair executed and exit code recorded.
5. Do the same for `ARTIFACT_EVALUATION.md`. — Acceptance: as above.
6. ~~Grep the dissertation for claims retracted in EXPERIMENTS.md.~~ **DONE 2026-08-02, and the premise was wrong.** Every match in `04_Empirical_Evaluation.md` was already inside its own §6.0 Retractions table, and the chapter already deferred to EXPERIMENTS.md on conflict. No live retracted claim existed. The real defect was different and worse: the two retraction lists had **drifted in both directions** — R6/R7/R8 recorded in EXPERIMENTS.md and never propagated to the chapter, R9 retracted in the chapter and never propagated back. A reader consulting either document alone got an incomplete list of what this project has withdrawn, which is a worse failure than the original overclaims because it is the *correction* that was incomplete.
7. ~~Add a SUPERSEDED banner to each affected section.~~ **Superseded by 6.** No banner was needed; both tables now carry stable IDs R1–R9 and the chapter names EXPERIMENTS.md as the source of record.
8. ~~Write that hygiene test.~~ **DONE** — `tests/unit/repo-hygiene/retractionSync.test.ts`. Asserts ID-set equality in both directions, contiguous numbering so a deleted retraction leaves a gap, a floor of nine, a named tie-breaker, and that retracted phrases appear nowhere outside a retraction context. Discriminator-checked: removing one row from the chapter fails it.
9. Reconcile `docs/paper/` against the same retraction list. — Acceptance: no retracted claim survives in the manuscript.
10. Verify every `docs/research/*.md` marked `core` still earns it. — Acceptance: seven core docs, each with an experiment or proof behind it.
11. Demote any core doc without evidence to `supporting` or `exploratory`. — Acceptance: `researchIndex.test.ts` green with the new tiers.
12. Publish a `docs/artifact/CLAIM_LEDGER.md` mapping every public claim → command → last-verified date. — Acceptance: `docs:check` gates it.

## Phase 1 — Third-party independence (the largest open weakness)

13. Write a one-page reviewer brief: what to attack, what would falsify, what is already known-broken. — Acceptance: reviewable without reading the repository.
14. Send it to one person outside the project. — Acceptance: a reply exists. **This step cannot be completed by an assistant.**
15. Record their findings verbatim in `docs/validation/`, including ones that are wrong. — Acceptance: findings file with attribution and date.
16. Fix what they find, or record why not. — Acceptance: each finding has a disposition.
17. Ask a second reviewer to reimplement the receipt verifier from `docs/` alone, without reading `verifiers/`. — Acceptance: an independent implementation exists.
18. Run E5 with that implementation as a fourth arm. — Acceptance: disagreement count reported, whatever it is.
19. If it disagrees, treat that as the most important result in the repository. — Acceptance: a finding written before any fix.
20. Publish `kernel-probe` results for three canonicalizers this project does not control and did not choose (ask the reviewer to pick). — Acceptance: three reports committed.
21. Open a GitHub issue template for external kernel-probe reports. — Acceptance: template exists and is linked from KERNEL_PROBE.md.
22. Add a `CONTRIBUTORS.md` recording every external contribution. — Acceptance: gated by `docs:check`.

## Phase 2 — E10 beyond the receipt kernel

23. Extend `mutationScope.ts` to a second declared scope: `enforcement-runtime/src/policy/` (8 files). — Acceptance: import-graph pin passes for the new scope.
24. Sweep policy. — Acceptance: a per-file table committed.
25. Triage policy survivors into real-gap / equivalent with written arguments. — Acceptance: every survivor has a disposition.
26. Write tests for the real gaps. — Acceptance: re-sweep shows movement.
27. Re-measure and record before/after. — Acceptance: both numbers in EXPERIMENTS.md.
28. Repeat 23–27 for `runtime/` (8 files). — Acceptance: as above.
29. Repeat for `retrieval/` (6 files). — Acceptance: as above.
30. Repeat for `vault/` (5 files). — Acceptance: as above.
31. Repeat for `gateway/` (4 files). — Acceptance: as above.
32. Repeat for `bedrock/` (5 files). — Acceptance: as above.
33. Repeat for `tenancy/` (1 file) and `identity/` (1 file). — Acceptance: as above.
34. Repeat for `attestation/` (3 files). — Acceptance: as above.
35. Repeat for `proofs/` (3 files). — Acceptance: as above.
36. Repeat for `evidence/` (1 file) and `aws/` (1 file). — Acceptance: as above.
37. Publish one aggregate table across all scopes. — Acceptance: totals reconcile with the per-scope reports.
38. Set a `break` threshold per scope from measurement, never before it. — Acceptance: each threshold is under its measured value.
39. Add the new scopes to `mutation.yml`. — Acceptance: the scheduled run covers them.
40. Record wall-clock per scope so the schedule stays feasible. — Acceptance: durations in EXPERIMENTS.md.

## Phase 3 — The 223 survivors and 40 unreached mutants in the receipt kernel

41. `signer.ts` — 57 survivors, the largest single block. Triage all 57. — Acceptance: each classified with an argument.
42. Kill the base64/hex regex survivors that are genuinely killable. — Acceptance: re-sweep delta recorded.
43. Record the equivalent ones with the fixed-length-alphabet argument. — Acceptance: written in the test file, not a commit message.
44. `strictJsonAdmission.ts` — 40 survivors, mostly loop bounds. Triage. — Acceptance: each classified.
45. Prove or disprove the loop-bound equivalence claims one at a time. — Acceptance: no survivor left as "unexamined".
46. `verifier.ts` — 39 survivors, never remediated. Triage and remediate. — Acceptance: re-sweep.
47. `keyManifest.ts` — 29 survivors, 10 unreached. Remediate. — Acceptance: unreached → 0.
48. `hashCanonicalization.ts` — 20 survivors, 8 unreached. Remediate. — Acceptance: unreached → 0.
49. `canonical.ts` — 18 survivors. Remediate. — Acceptance: re-sweep.
50. `kmsSigner.ts` — 7 survivors, 6 unreached, and the lowest-scoring file at 68.2%. Remediate. — Acceptance: unreached → 0.
51. `kmsVerifier.ts` — 5 survivors. Argue each or kill it. — Acceptance: no unexamined survivor.
52. `chain.ts` and `emission.ts` — 4 each. Finish them. — Acceptance: no unexamined survivor.
53. Decide the fate of the unreachable `emission.ts:134` terminal throw. — Acceptance: removed with a test, or annotated as intentionally-dead with a comment explaining why it stays.
54. Re-sweep the full kernel. — Acceptance: aggregate ≥ 90% covered, unreached ≤ 10.
55. Raise `break` to just under the new measured total. — Acceptance: `mutationScope.test.ts` green.
56. Write the equivalent-mutant catalogue as one document. — Acceptance: every claimed-equivalent mutant appears with its argument.

## Phase 4 — Formal methods

57. `TenantIsolation.tla` is an unchecked stub and tenant isolation is a headline claim. Write it to a checkable state. — Acceptance: TLC runs it.
58. Write its mutant. — Acceptance: the mutant violates.
59. Add both to `run-tlc.sh`. — Acceptance: 5 baselines / 5 mutants.
60. `proofs/cloud/BigQueryIndex.tla` — check or delete. — Acceptance: TLC log committed, or the file is gone with a reason.
61. Same for `CloudConsistency.tla`. — Acceptance: as above.
62. Same for `ReceiptPublication.tla`. — Acceptance: as above.
63. Same for `StorageCheckpoint.tla`. — Acceptance: as above.
64. Write a mutant for every cloud spec that survives. — Acceptance: each violates.
65. Record TLC state counts for every spec. — Acceptance: a spec with a suspiciously small state space is investigated, not accepted.
66. Assert a minimum state count per spec in `run-tlc.sh`. — Acceptance: a vacuously-passing spec fails the gate.
67. Re-strip machine paths from newly generated TLC logs. — Acceptance: `publicInterface.test.ts` green.
68. Document what each spec does NOT model. — Acceptance: one coverage-boundary paragraph per spec.

## Phase 5 — Supply chain

69. Merge the 5 Rust patch bumps (#16, #17, #23, #24 and one more) one at a time. — Acceptance: `cargo test --locked` green per merge.
70. Merge the 4 minor npm bumps (#26, #28, #29, #30). — Acceptance: `npm run validate` green per merge.
71. `sha2 0.10 → 0.11` (#14, #22) is a RustCrypto trait break, not a patch. Port the code. — Acceptance: both crates compile and test.
72. `rand 0.8 → 0.10` (#21) is a major API change. Port. — Acceptance: gateway tests green.
73. `ed25519-dalek 2 → 3` (#12, #20) touches signing. Port with extreme care. — Acceptance: the socket round-trip evidence is regenerated, not assumed.
74. Re-record the DAB round-trip evidence after 73. — Acceptance: new recorded logs committed.
75. `typescript 6 → 7` (#27). Port. — Acceptance: `npm run lint` clean with no new `any`.
76. GitHub Actions majors (#11, #13, #15, #18, #19). — Acceptance: each workflow green after each bump.
77. Pin every action to a commit SHA. Semgrep reports 48 mutable-tag findings. — Acceptance: zero `github-actions-mutable-action-tag` findings.
78. Enable Dependabot for the new `tools/experiments-json` crate. — Acceptance: config lists it.
79. Re-run `npm audit`; drive the remaining 3 to 0 or record why not. — Acceptance: a dated row in CI_COVERAGE.
80. Raise the audit gate to the level actually met. — Acceptance: gate passes on a clean clone.

## Phase 6 — CI hardening

81. Triage all 96 semgrep findings into fix / suppress-with-reason / accept. — Acceptance: every finding has a disposition.
82. Fix the 23 `path-join-resolve-traversal` findings or argue each. — Acceptance: written argument per suppression.
83. Fix the 7 `hardcoded-hmac-key` findings — these are test vectors; make that unambiguous. — Acceptance: renamed or annotated so the scanner and a human agree.
84. Fix the 9 `contains-bidirectional-characters` findings. — Acceptance: zero remaining, or a test asserting they are intentional.
85. Raise the semgrep gate to the level met. — Acceptance: the job blocks on regression.
86. Replace the deprecated `returntocorp/semgrep-agent` image. — Acceptance: no deprecated image reference.
87. Add retry-on-transient to the semgrep pull. — Acceptance: a flake does not fail the build.
88. Make the mutation job blocking on a release branch. — Acceptance: a score regression fails that branch.
89. Add cross-machine E2 reproduction on a second runner architecture. — Acceptance: two hosts, two recorded p50+IQR figures.
90. Report the between-host difference honestly. — Acceptance: a dispersion statement, not an average.
91. Exercise `dab/roundtrip` in CI. — Acceptance: the socket round-trip runs, not just its recorded log.
92. Exercise `dab/k8s`. — Acceptance: as above, or a written reason it cannot run.
93. Exercise `dab/agent-runtime`. — Acceptance: as above.
94. Add a clean-clone smoke job that runs `npm ci && npm run validate` with no cache. — Acceptance: green, and it would have caught the ERESOLVE defect.

## Phase 7 — The AWS reality boundary

95. Cost-bound and approve one live AWS window. — Acceptance: written approval and a spend cap. **Requires a human decision.**
96. Execute the preflight runbook. — Acceptance: preflight output recorded.
97. Emit one KMS-signed receipt against real KMS. — Acceptance: a receipt whose `keyId` is a real key ARN.
98. Verify it with all three verifiers. — Acceptance: three verdicts, agreement or disagreement recorded.
99. Produce one sanitized live evidence bundle. — Acceptance: passes `validate:evidence-bundle`.
100. Run the cleanup runbook and record it. — Acceptance: no residual billable resources.
101. Move the KMS rows in CI_COVERAGE from `AWS-synth-only` to `AWS-live` — only for what actually ran. — Acceptance: no row upgraded without a recorded artifact.
102. Write down what the live window did NOT cover. — Acceptance: an explicit list.

## Phase 8 — Falsifier F2 (the real-traffic corpus)

103. Decide the licensing and provenance policy for third-party corpora. — Acceptance: written policy. **Requires a human decision.**
104. Identify three corpora this project did not author. — Acceptance: sources named with licences.
105. Vendor or fetch them under that policy. — Acceptance: provenance recorded per file.
106. Run E1's pathology classes against them to measure real-world incidence. — Acceptance: rates with denominators.
107. Report the rate with a genuine sampling interval where n ≥ 30 and provenance is `sampled`. — Acceptance: `reportProportion` attaches an interval legitimately.
108. State plainly whether F2 is closed, narrowed, or untouched. — Acceptance: 00_THESIS.md updated either way.

## Phase 9 — Publication and external utility

109. Package `kernel-probe` so it runs without this repository — a single file or a published package. — Acceptance: it runs from a clean directory.
110. Write the standalone result: four ecosystems, three universal duplicate-key collapses, and the 2^53 finding that narrowed the claim. — Acceptance: a draft that stands without Ghost-Ark.
111. Decide the venue and the authorship, including the lab's role. — Acceptance: written. **Requires a human decision.**
112. Re-run every number in the draft from a clean clone on the day of submission. — Acceptance: each figure reproduced, with the command and host recorded.

## What NOT to do

Do not add a new subsystem before Phase 3 finishes. The repository's credibility
is the ratio of claims made to evidence attached, and new surface without an
experiment behind it moves that ratio the wrong way. The quarantine directories
exist because that lesson was learned expensively, twice.

Do not raise a threshold before measuring. It has already been wrong once:
`break: 75` was set on two files' evidence when the full sweep held 60.6%.

Do not report a step complete without its acceptance output. "Should work" and
"works locally" have both been false in this repository within the last month —
the latter cost 40+ consecutive red CI runs.
