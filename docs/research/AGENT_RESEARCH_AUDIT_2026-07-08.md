# Ghost-Ark Agent Research Audit And Execution Plan

Date: 2026-07-08  
Local repo: `/Users/pranavbhave/Documents/GitHub/ghost-ark`  
Remote: `https://github.com/Cubits11/ghost-ark.git`  
Sibling inspected locally: `/Users/pranavbhave/Documents/GitHub/cc-framework`  
Remote: `https://github.com/Cubits11/cc-framework.git`

## Scope And Verification Boundary

Verified locally:

- Ghost-Ark stack: TypeScript, npm workspaces, Vitest, AWS CDK, Terraform, JSON Schema, AWS service code, a small amount of AWS Glue/Python and AWS-gated Python tests.
- The branch `research-frontier-control-plane` exists locally and its first nine intended commits are already merged into `main` by PR #1. Current `main` points at `59b48aa`, merge of `research-frontier-control-plane`.
- CC-Framework is a Python research repo with `pyproject.toml`, pytest, Ruff, Pydantic, a finite-atom kernel, evidence governance, reporting, and many tests. It is currently dirty locally; do not treat it as a clean baseline.

Not verified:

- Public star counts, traffic, issue state, and GitHub UI settings.
- Any private Cubits11 repositories.
- Live AWS deployment state unless covered by checked-in evidence docs.

Primary sources used:

- OpenAI Codex AGENTS.md docs: https://developers.openai.com/codex/guides/agents-md
- OpenAI Codex best practices: https://developers.openai.com/codex/learn/best-practices
- OpenAI Codex app announcement: https://openai.com/index/introducing-the-codex-app/
- Gemini CLI repo: https://github.com/google-gemini/gemini-cli
- Gemini CLI GitHub advisory GHSA-wpqr-6v78-jr5g: https://github.com/advisories/GHSA-wpqr-6v78-jr5g
- Claude Code permissions: https://code.claude.com/docs/en/permissions
- Anthropic Claude Code auto mode: https://www.anthropic.com/engineering/claude-code-auto-mode
- AGENTS.md effectiveness paper: https://arxiv.org/html/2602.11988v1
- 0DIN agentic repo exploit write-up: https://0din.ai/blog/clone-this-repo-and-i-own-your-machine
- GitHub Copilot coding agent preview: https://github.blog/changelog/2025-05-19-github-copilot-coding-agent-in-public-preview/
- AWS Nitro KMS condition keys: https://docs.aws.amazon.com/kms/latest/developerguide/conditions-nitro-enclave.html
- Sigstore Rekor overview: https://docs.sigstore.dev/logging/overview/
- RISC Zero receipts: https://dev.risczero.com/api/zkvm/receipts
- SP1 proof verification docs: https://docs.succinct.xyz/docs/sp1/generating-proofs/basics
- EU GPAI Code of Practice: https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai
- NIST AI RMF: https://www.nist.gov/itl/ai-risk-management-framework
- OWASP LLM prompt injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- NIST adversarial ML taxonomy: https://csrc.nist.gov/pubs/ai/100/2/e2025/final

## SECTION 1 - Executive Verdict

| Dimension | Grade | Evidence | Blocks to 10/10 | Fastest improvement | Do not overclaim |
|---|---:|---|---|---|---|
| Ghost-Ark engineering credibility | 7.2 | Workspaces, Vitest, CDK/Terraform, schemas, runtime, receipts, policy tests, AWS docs. | No root agent guide until this pass; verifier/bundle story still fragmented; frontier layers are mostly L1-L3. | Ship external verifier bundle path and README quickstart. | Production readiness. |
| Ghost-Ark research credibility | 6.8 | Threat model, maturity ladder, frontier schemas, TLA+ stub, zk/mock boundary docs. | Formal and zk artifacts are stubs or mock interfaces; no paper-style evaluation matrix. | Add claim-to-evidence manifest and formal/runtime traceability table. | Formal proof or zk proof where only schema/mock exists. |
| Ghost-Ark security credibility | 6.5 | Tenant rejection, fail-closed runtime, KMS signing support, CodeQL/Semgrep/gitleaks CI. | Agent supply-chain threat model missing; claim scanner existed but was not in validate. | Keep scanner in `npm run validate`; add verifier negative fixtures. | "Fully trustless" or "certifies compliance." |
| Ghost-Ark GitHub traction potential | 7.0 | Sharp niche: verifiable AI infrastructure, AWS-native, receipts, non-claims. | README is dense and not instantly demoable; no GIF/social preview; no issue garden. | 5-minute offline verifier plus one diagram and good-first issues. | Broad AI safety solution. |
| Codex/Gemini readiness | 5.8 before this pass, 7.4 after | `AGENTS.md`, `CODEX_TASKS.md`, PR template now exist; tests are commandable. | Some tasks still too cross-cutting; no labels/templates yet. | Add issue labels and agent-local runbook. | Agent autonomy on AWS/IAM/KMS. |
| CC-Framework research credibility | 7.5 | Strong README boundaries, finite-atom kernel, pytest/Ruff/Pydantic, evidence governance. | Dirty local tree; enterprise reference can distract from paper core; pycache artifacts appear in file walk. | Freeze release claim manifest and keep enterprise reference quarantined. | Deployment safety certificate. |
| Combined thesis potential | 8.3 | CC gives dependence-aware guardrail science; Ghost-Ark gives evidence-bearing execution substrate. | Integration is conceptual; no shared artifact format yet. | Define bridge receipt: CC claim envelope anchored by Ghost-Ark checkpoint. | That receipts make guardrails correct. |

## SECTION 2 - Latest News And Strategic Implications

| Area | Source | Summary | Why it matters | Ghost-Ark change | Codex task |
|---|---|---|---|---|---|
| Codex instructions | OpenAI AGENTS.md docs | Codex reads layered `AGENTS.md` files before work and has a default size cap. | Root guidance must be short and operational. | Added `AGENTS.md`. | `codex/agent-root-agents-md` |
| Codex workflow | OpenAI best practices | Good prompts name goal, context, constraints, and done state. | Task cards need explicit tests and DoD. | Added `CODEX_TASKS.md`. | `codex/agent-codex-tasks` |
| Multi-agent Codex | OpenAI app | Codex app supports parallel long-running agent threads. | Repo needs safe zones and narrow tasks. | Split backlog by small branches. | Use one branch per issue. |
| Gemini CLI | Gemini CLI repo | Gemini supports `GEMINI.md`, PR review, issue triage, and search grounding. | Use Gemini for research, not unchecked code writes to IAM/KMS. | Add future `GEMINI.md` mirroring claim rules. | `docs: add gemini operating note` |
| Gemini security | GitHub advisory | Workspace trust/tool allowlisting RCE was patched in Gemini CLI/action. | Agent CI on untrusted PRs is high risk. | Do not run agent tools on untrusted PRs with secrets. | `security: add agent supply-chain threat model` |
| Claude permissions | Anthropic docs | Read, shell, and edit permissions have different approval semantics. | Agent instructions should deny broad AWS/destructive commands. | Added stop rules to `AGENTS.md`. | `docs: add local-first agent runbook` |
| Permission fatigue | Anthropic auto mode | Users approve most prompts; automation must account for fatigue. | CI gates must catch claims/secrets even after human rubber-stamp. | Wired claim scanner into validate. | `ci: run forbidden claim scanner in validate` |
| Agent context files | AGENTS.md paper | Human context files help slightly; generated ones can add cost/noise. | Keep root guide minimal; put backlog elsewhere. | `AGENTS.md` compact, `CODEX_TASKS.md` detailed. | Maintain under 32 KiB. |
| Agent exploitation | 0DIN | Clean repos can trigger harmful shell behavior through indirect setup chains. | Treat setup scripts as untrusted execution. | Add supply-chain runbook task. | `security: add agent supply-chain threat model` |
| Governance market | EU GPAI Code, NIST AI RMF | Current governance asks for transparency, risk management, safety/security documentation. | Ghost-Ark should sell evidence traceability, not safety outcomes. | Keep non-claims prominent. | README clarity task. |
| Nitro/KMS | AWS docs | KMS can condition key use on Nitro attestation and PCR measurements. | Phase A should implement PCR-bound KMS release before any enclave claim. | Current code models conditions only. | `attestation: add nitro manifest goldens` |
| Transparency logs | Sigstore Rekor | Inclusion and consistency monitoring matter; logs need auditors. | Single local checkpoint is not independent witness transparency. | Add consistency-proof schema and monitor plan. | `transparency: verify merkle inclusion proofs` |
| zk receipts | RISC Zero, SP1 docs | Receipts/proofs bind guest program identity and public output/journal. | Ghost-Ark zk layer must start with journal commitments, not LLM inference proof claims. | Keep mock verifier labeled. | `zk: canonicalize public journals` |
| LLM security | OWASP, NIST AML | Prompt injection, data poisoning, and adversarial ML are named risk classes. | Receipts should log policy decisions and provenance, not promise prompt-injection immunity. | Add negative prompt/RAG tests later. | `security: add agent supply-chain threat model` |

## SECTION 3 - Repository Archaeology

### Ghost-Ark Identity

Ghost-Ark is an AWS-native governed AI execution/evidence reference architecture. It implements receipt schemas, signing/verification helpers, policy/runtime packages, API handlers, ledger/search/ingest services, CDK/Terraform infrastructure, local verifier examples, and research-frontier primitives. Aspirational or partial: production Nitro enclave runtime, real zkVM verifier, independent witness network, complete formal refinement proof.

| Path | Purpose | Credibility value | Risk | Agent edit safety | Tests | Missing tests | Recommended next change |
|---|---|---|---|---|---|---|---|
| `README.md` | Public positioning and quickstart | High | Overclaim, density | Careful | `docs:check`, claim scan | First-screen diagram | Rewrite first 30 seconds. |
| `packages/receipt-schema/src/**` | Canonical receipt identity/payload | Very high | Canonicalization drift | Careful | unit tests | More golden vectors | Add bundle manifest vectors. |
| `packages/enforcement-runtime/src/**` | Policy/runtime/Bedrock/memory gates | Very high | tenant bypass, prompt leakage | Careful | many unit/integration tests | prompt-injection/RAG negatives | Add poisoned retrieval fixtures. |
| `packages/research-frontier/src/**` | frontier claim, Merkle, Nitro, zk interfaces | Medium-high | mock mistaken for proof | Safe-careful | research-frontier tests | inclusion proofs, hash verifier | Add verifier CLI and goldens. |
| `schemas/research/**` | machine-readable research artifacts | Medium | schema/runtime mismatch | Safe | schema-adjacent tests | schema validation CLI | Add maturity fields. |
| `proofs/tla/**` | tenant isolation model stub | Medium | fake-formal criticism | Careful | none in CI | TLC run docs/results | Add README and expected result. |
| `tools/research/check-forbidden-claims.mjs` | overclaim scanner | High | false negatives/exceptions | Safe | via `claims:check` | section-aware scanning | Expand patterns gradually. |
| `tools/ghost-verify.mjs` | local verifier | Very high | weak verifier story | Careful | sample receipt tests | JSON report, bundle mode | Add machine-readable output. |
| `infra/cdk/**` | AWS app stacks | High | spend/security | Approval for deploy | synth/build | IAM diff snapshots | Add least-privilege snapshots. |
| `infra/terraform/**` | bootstrap/account infra | High | IAM/account drift | Careful | terraform validate/fmt | plan snapshots | Add no-apply runbook. |
| `.github/workflows/**` | CI/deploy | High | secret exposure/live deploy | Careful | CI itself | permission audit | Document workflow permissions. |
| `evidence/live-aws-validation/**` | checked validation evidence | High | stale or leaked evidence | Approval only | docs | schema validation | Add sanitized templates. |
| `services/signing/kms/**` | KMS signer/verifier | Very high | key confusion | Careful | signing tests | key manifest rotation negatives | Add Key ID immutability tests. |
| `apps/api/src/**` | tenant-facing API handlers | High | auth/tenant bugs | Careful | integration tests | fuzz/negative auth | Add path/body mismatch cases. |
| `docs/research/**` | research boundaries | High | aspiration leak | Safe-careful | claim scan | source freshness note | Keep dated audit here. |

### CC-Framework Identity

CC-Framework is actually Python. Its stack is `pyproject.toml`, pytest, Ruff, Pydantic, NumPy/SciPy, Hypothesis, optional enterprise extras. Implemented: finite-atom Frechet bounds, metrics, evidence governance, reporting, claim manifest tests. Aspirational/weak: enterprise reference and dashboard can blur the paper core; dirty local tree makes current baseline non-release-clean.

## SECTION 4 - Brutal Gap Analysis

| Gap | Severity | Evidence | Exact fix | Files | Exact test | Commit | Rollback | DoD |
|---|---|---|---|---|---|---|---|---|
| No root agent contract | High | `AGENTS.md` absent | Add concise stack/safety guide | `AGENTS.md` | `npm run claims:check` | `docs: add root agent operating contract` | Delete file | Agents know safe zones/tests. |
| Claim scanner not in validate | High | package lacked script | Add `claims:check` and chain into validate | `package.json` | `npm run validate` | `ci: run forbidden claim scanner in validate` | Revert package change | Local/CI gates overclaims. |
| PRs do not force claim status | Medium | no template | Add PR template | `.github/PULL_REQUEST_TEMPLATE.md` | `npm run docs:check` | `docs: add claim-boundary pr template` | Delete template | Reviewers see implemented/mock/doc boundary. |
| External verifier story fragmented | High | verifier exists, bundle verifier absent | Add local receipt bundle verifier | `tools/scripts/verifyReceiptBundle.ts` | receipt-schema tests | `verifier: add local receipt bundle cli` | Revert commit | 5-minute offline evidence bundle passes/fails. |
| Merkle primitive lacks inclusion proof | Medium | root only | Add proof generation/verification | `packages/research-frontier/src/merkle.ts` | research-frontier tests | `transparency: verify merkle inclusion proofs` | Revert module/test | Inclusion failure cases pass. |
| Nitro layer is manifest/policy only | High | no COSE/CBOR parser or live enclave | Add fail-closed parser stub and live plan | `nitroAttestationDocument.ts`, docs | nitro tests | `attestation: add fail-closed attestation document parser stub` | Revert files | No enclave claim beyond L2/L3. |
| zk layer is mock only | High | `MockZkReceiptVerifier` only | Canonicalize public journals; add fail-closed adapters | `zkReceipt.ts` | zk tests | `zk: canonicalize public journals` | Revert files | Mock cannot be read as crypto proof. |
| Formal layer is a stub | Medium | TLA files exist, no run docs | Add TLC runbook and traceability | `proofs/tla/README.md` | docs/claim checks | `proofs: add tla run instructions` | Delete runbook | Reviewer sees exact formal boundary. |
| README is too dense | Medium | first screen long | Rewrite opening, diagram, quickstart | `README.md` | docs/claim checks | `docs: sharpen readme opening` | Revert README | 30-second comprehension improves. |
| Agent supply-chain risk undocumented | High | no dedicated doc | Add threat model for malicious setup and egress | `docs/security/AGENT_SUPPLY_CHAIN.md` | docs/claim checks | `security: add agent supply-chain threat model` | Delete doc | Agent onboarding names this risk. |

Example Codex prompt for any row:

```text
Implement <issue title> on branch <branch>. Only edit <files>. Do not edit <forbidden files>. Keep claims bounded under AGENTS.md. Run <exact tests>. Commit as "<commit>". PR body must include implemented vs documented vs mocked, tests, security impact, rollback, and non-claims.
```

## SECTION 5 - Corrected Codex Revival Plan

The first nine requested commits are already real:

1. `a0a47f0 research: add frontier claim control plane`
2. `a09a370 proofs: add tenant isolation TLA+ model stub`
3. `5e12ebc research: document frontier threat model and non-claims`
4. `2688e84 transparency: add deterministic Merkle checkpoint primitive`
5. `ae9fd02 attestation: model Nitro PCR-bound KMS release conditions`
6. `8e6114c attestation: generate KMS policy conditions from Nitro measurements`
7. `a15d383 zk: add execution receipt interface and mock verifier`
8. `c40f92d research: add assurance claim maturity ladder`
9. `309147f ci: add forbidden assurance overclaim scanner`

Corrected plan from current HEAD:

- Root agent guide: done in `AGENTS.md`.
- Backlog: done in `CODEX_TASKS.md` with 50 task cards.
- Safe edit zones: root `AGENTS.md`.
- Forbidden edit zones: root `AGENTS.md`.
- Branch format: `codex/<area>-<slug>`.
- Commit format: `<area>: <imperative summary>`.
- PR template: `.github/PULL_REQUEST_TEMPLATE.md`.
- Test-before-commit: focused tests plus `npm run validate` for security/docs/claim/public artifacts.
- No-fake-research rule: classify claims by `ASSURANCE_MATURITY_LADDER.md`.
- Stop and ask: live AWS spend, prod deploy, secrets, destructive data ops, IAM/KMS trust changes, new proof/security claims.

## SECTION 6 - AGENTS.md Draft

The complete root-level draft has been installed at `AGENTS.md`. It covers mission, stack, safety rules, forbidden and allowed claims, testing commands, directory edit zones, AWS/no-spend/secrets/KMS/IAM rules, documentation honesty, commit/PR format, and rollback expectations.

## SECTION 7 - CODEX_TASKS.md Draft

The complete backlog has been installed at `CODEX_TASKS.md`, grouped by immediate safety/agent readiness, research control plane, transparency/Merkle, Nitro attestation, formal methods, zk receipt interface, external verifier CLI, README/GitHub traction, CI/security, and AWS live validation later.

## SECTION 8 - Immediate Next 20 Commits

| # | Commit | Branch | Purpose | Files | Tests | Credibility gain | Must not claim |
|---:|---|---|---|---|---|---|---|
| 1-9 | Already merged | `research-frontier-control-plane` | Baseline frontier plane | listed above | existing tests | Research skeleton exists | Production assurance. |
| 10 | `docs: add root agent operating contract` | `codex/agent-root-agents-md` | Agent safety | `AGENTS.md` | `npm run claims:check` | Codex readiness | Agent safety is solved. |
| 11 | `docs: add codex execution backlog` | `codex/agent-codex-tasks` | Executable plan | `CODEX_TASKS.md` | `npm run claims:check` | Agent throughput | Tasks are done. |
| 12 | `docs: add claim-boundary pr template` | `codex/agent-pr-template` | Review discipline | `.github/PULL_REQUEST_TEMPLATE.md` | `npm run docs:check` | Maintainer hygiene | Review guarantees correctness. |
| 13 | `ci: run forbidden claim scanner in validate` | `codex/ci-claims-check-validate` | CI gate | `package.json` | `npm run validate` | Overclaim prevention | Scanner catches all bad claims. |
| 14 | `security: add agent supply-chain threat model` | `codex/security-agent-supply-chain` | Agent RCE risk | `docs/security/AGENT_SUPPLY_CHAIN.md` | docs checks | Workstation safety | Zero risk from agents. |
| 15 | `verifier: add local receipt bundle cli` | `codex/verifier-bundle-cli` | External verification | `tools/scripts/**` | build + receipt tests | Demo credibility | Full transparency log. |
| 16 | `verifier: add negative receipt fixtures` | `codex/verifier-negative-fixtures` | Tamper evidence | examples/tests | receipt tests | Cryptographic rigor | Truth of payload. |
| 17 | `transparency: verify merkle inclusion proofs` | `codex/transparency-verify-inclusion` | Merkle proof | `merkle.ts` | research tests | External audit path | Witness decentralization. |
| 18 | `attestation: add nitro manifest goldens` | `codex/attestation-manifest-goldens` | PCR checks | attestations/tests | nitro tests | Attestation precision | Real enclave runtime. |
| 19 | `zk: canonicalize public journals` | `codex/zk-journal-canonicalization` | zk interface rigor | `zkReceipt.ts` | zk tests | Future prover readiness | Real zk verification. |
| 20 | `docs: sharpen readme opening` | `codex/readme-opening-clarity` | Traction | `README.md` | docs/claim checks | First-screen clarity | Safety/compliance certification. |

## SECTION 9 - Exact Terminal Execution Plan

```bash
cd ~/Documents/GitHub/ghost-ark
git status --short --branch
git checkout -b codex/agent-readiness-control-plane

# File order used in this pass:
# 1. package.json
# 2. AGENTS.md
# 3. .github/PULL_REQUEST_TEMPLATE.md
# 4. CODEX_TASKS.md
# 5. docs/research/AGENT_RESEARCH_AUDIT_2026-07-08.md
# 6. tools/research/check-forbidden-claims.mjs

npm run claims:check
npm run docs:check
npm run lint
npx vitest run tests/unit/research-frontier
npm run validate

git add package.json AGENTS.md CODEX_TASKS.md .github/PULL_REQUEST_TEMPLATE.md docs/research/AGENT_RESEARCH_AUDIT_2026-07-08.md tools/research/check-forbidden-claims.mjs
git commit -m "docs: add agent execution control plane"
git push -u origin codex/agent-readiness-control-plane

# PR title:
# docs: add agent execution control plane
```

## SECTION 10 - README And GitHub Traction Rewrite

New opening paragraph:

> Ghost-Ark is an AWS-native reference implementation for evidence-bearing AI execution: tenant-scoped policy decisions, canonical receipts, KMS-backed signatures, replayable evidence bundles, and research-stage hooks for Nitro attestation, formal policy checks, zk execution receipts, and witness transparency. It verifies recorded bindings; it does not certify model safety, compliance, or truth.

Taglines:

- Infrastructure for bounded AI claims.
- Receipts for governed AI execution.
- Verify what ran, not what you wish were true.
- Evidence-bearing AI governance on AWS.
- Cryptographic audit trails for policy-governed LLMs.

Repo descriptions:

- AWS-native governed AI receipts and external verification.
- Evidence-bearing execution envelopes for LLM governance.
- Tenant-scoped policy, receipts, KMS signing, and verifier tooling.
- Reference architecture for bounded, auditable AI infrastructure claims.
- Ghost-Ark: make AI governance claims checkable.

Social preview ideas:

- Receipt bundle diagram with tenant, policy hash, signature, checkpoint.
- Before/after: broad claim rejected, bounded claim verified.
- AWS-native control plane flow: invoke, evaluate, sign, checkpoint, verify.
- Four frontier pillars with maturity ladder labels.
- Terminal verifier PASS/FAIL against tampered receipt.

Demo GIF: run `ghost-verify` on a valid receipt, tamper tenant, show FAIL, restore and show PASS.

5-minute quickstart: `npm ci`; run offline verifier; run `npm test -- tests/unit/research-frontier`; inspect receipt fields.

Example bundle: receipt JSON, key manifest, checkpoint JSON, witness manifest, expected verifier report.

Issue titles: Add receipt bundle CLI; Add Merkle inclusion proof; Add Nitro manifest goldens; Add zk journal canonicalization; Add TLA runbook; Add prompt-injection negative fixtures; Add workflow permissions audit; Add README diagram; Add verifier JSON report; Add witness key manifest.

Good first issues: Clarify non-claims; Add glossary; Add docs links to tests; Add sample invalid receipt; Add Mermaid diagram; Add issue labels doc; Add Semgrep runbook; Add local gitleaks doc; Add schema examples; Add PR checklist examples.

Blog titles: "Cryptographic Receipts Are Not AI Safety"; "Bounded Claims for Governed LLMs"; "Why Agent Governance Needs Evidence Bundles"; "Nitro, Merkle, and zkVMs as AI Audit Primitives"; "Guardrail Composition Needs Dependence-Aware Evidence."

LinkedIn post drafts:

- "The claim boundary matters: Ghost-Ark verifies recorded policy/receipt bindings, not model truth."
- "AI governance needs artifacts that fail closed. I am building Ghost-Ark around receipts, policies, signatures, and non-claims."
- "The fastest way to lose credibility in AI safety infrastructure is to overclaim. The second fastest is to skip reproducibility."
- "CC-Framework asks whether guardrail failures are dependent. Ghost-Ark asks whether the execution evidence is verifiable."
- "Agentic development needs CI that rejects unsupported assurance language."

HN titles: "Show HN: Ghost-Ark, AWS-native receipts for governed AI execution"; "Cryptographic receipts are not AI safety, but they help"; "Building an evidence envelope for LLM governance"; "A local verifier for AI governance receipts"; "Making AI infrastructure claims falsifiable."

Community angles: AWS - KMS/Nitro/Bedrock/Lake Formation receipts; AI safety - bounded evidence not broad safety; security - agent audit trails and non-repudiation; formal methods - tenant isolation invariants; zk - public journals for policy execution.

## SECTION 11 - Research Thesis Reframing

Thesis titles:

1. Evidence-Bearing AI Execution
2. Bounded Truth Claims for Governed AI Systems
3. Verifiable Envelopes for Policy-Governed LLM Invocation
4. Receipt-Based AI Infrastructure
5. From Guardrail Scores to Auditable Execution
6. Dependence-Aware Safety Evidence and Cryptographic Receipts
7. Transparency Logs for AI Agent Accountability
8. Formal Tenant Isolation for AI Governance
9. Attested Policy Runtimes for AI Systems
10. Reproducible AI Safety Evidence Pipelines

Central research questions:

1. What can an external verifier check without trusting the runtime?
2. How should AI governance systems bind tenant, policy, model, and evidence context?
3. Which guardrail-composition claims survive unknown dependence?
4. How should non-claims be enforced in public artifacts?
5. Can policy execution be attested without leaking prompts?
6. Which tenant isolation invariants can be model checked?
7. What is the minimum useful receipt bundle?
8. When do transparency witnesses add real assurance?
9. How do agent action logs support accountability?
10. How do zk and TEE evidence complement each other?

Falsifiable hypotheses:

1. Receipt bundle verification catches tenant tampering with zero AWS calls.
2. Claim scanning prevents a defined forbidden phrase class in docs.
3. Merkle inclusion proofs detect receipt omission for fixed checkpoints.
4. Nitro KMS policies reject mismatched PCR manifests.
5. zk journal canonicalization detects commitment drift.
6. Formal counterexamples catch cross-tenant policy mistakes.
7. CC intervals widen under unknown dependence versus independence baselines.
8. README quickstart completion under five minutes increases contributor activation.
9. PR claim templates reduce unsupported assurance language in merged docs.
10. Agent-safe issue cards reduce review rework.

Non-claims:

- Not a proof of model truth.
- Not a compliance certificate.
- Not a substitute for evals/red teaming.
- Not a production enclave today.
- Not a production zk verifier today.
- Not decentralized transparency until independent witnesses exist.
- Not full IAM formal verification.
- Not side-channel elimination.
- Not dataset validity proof.
- Not a deployment approval system.

## SECTION 12 - 100-Star Plan

Positioning: "AWS-native verifiable AI governance receipts, with strict non-claims."  
README: first screen must show problem, bounded claim, offline verifier, diagram.  
Diagram: request to receipt to KMS signature to checkpoint to external verifier.  
Demo: terminal verifier PASS/FAIL GIF.  
Quickstart: no AWS credentials.  
Artifacts: sample receipt bundle with tampered negatives.  
Issues: 10 `good first issue`, 10 `research`, 10 `security-sensitive`, 5 `aws-manual`.  
Launch post: lead with what it refuses to claim.  
Blog: compare cryptographic integrity vs empirical truth.  
LinkedIn: serious build log, not hype.  
Outreach: AWS security, AI safety governance, formal methods, zkVM, Sigstore communities.  
Do not post: "solves AI safety", "trustless AI", "compliance-ready", "production enclave", "zk-proven AI."  
Screenshots/GIFs: verifier terminal, receipt JSON annotated, Mermaid diagram, failed overclaim scanner.  
First-time contributor view: clear install, tests, safe tasks, labels, PR template.

## SECTION 13 - Red Team Attack

| Attack | Fair? | Severity | Exact fix | File | Test | Wording to remove | Replacement | Commit |
|---|---|---:|---|---|---|---|---|---|
| Overclaims AI safety | Partly | 10 | Scanner + README rewrite | `README.md`, scanner | `npm run claims:check` | "safe AI" | "bounded receipt verification" | `docs: sharpen readme opening` |
| Fake cryptographic rigor | Partly | 8 | Golden vectors and negative fixtures | examples/tests | receipt tests | "secure receipts" alone | "canonical payload plus signature checks under verifier rules" | `verifier: add negative receipt fixtures` |
| Fake formal methods | Fair | 7 | TLA runbook and traceability | `proofs/tla/README.md` | docs check | "formal verification" | "TLA+ model stub until TLC output exists" | `proofs: add tla run instructions` |
| AWS security theater | Partly | 8 | Live validation preflight and evidence templates | docs/evidence templates | docs check | "AWS-native secure" | "AWS-native reference, validation gated" | `aws: add validation preflight checklist` |
| Toy zk | Fair | 8 | Keep mock labels; add canonical journal | `zkReceipt.ts` | zk tests | "zk verified" | "mock verifier, real verifier deferred" | `zk: canonicalize public journals` |
| Toy Nitro | Fair | 8 | Parser stub, PCR docs, live plan | nitro files | nitro tests | "enclave protected" | "manifest-modeled attestation conditions" | `attestation: add nitro manifest goldens` |
| Toy transparency log | Partly | 7 | Inclusion/consistency proofs, witnesses | Merkle files | research tests | "transparency log" | "deterministic checkpoint primitive" | `transparency: verify merkle inclusion proofs` |
| Bad DX | Fair | 6 | offline verifier quickstart | README/examples | docs checks | Dense first screen | Five-minute verifier path | `verifier: improve offline quickstart` |
| Agent-generated slop | Fair risk | 7 | AGENTS, tasks, PR template | root docs | validate | broad mega tasks | small typed tasks with tests | `docs: add agent execution control plane` |
| No empirical evidence | Partly | 7 | validation matrix and live evidence templates | docs/evidence | docs check | "validated" | "locally tested; live AWS optional/manual" | `aws: add kms signing evidence template` |

## SECTION 14 - Final Ruthless Verdict

Strongest thing: the claim boundary is unusually honest for an AI governance repo.

Weakest thing: the frontier pillars can look like a shopping list unless each one has a verifier, fixture, negative test, and maturity label.

Most dangerous overclaim: any wording that implies Ghost-Ark proves AI outputs are safe, true, compliant, or trustworthy.

Most underexploited asset: the offline verifier plus CC-Framework's dependence-aware guardrail thesis. Together, they are a credible "evidence-bound AI assurance" story.

Fastest path to credibility: ship one external verifier bundle with negative fixtures and a README GIF.

Fastest path to traction: make the first five minutes work without AWS credentials.

Fastest path to research legitimacy: publish a claim/evidence matrix mapping each paper-style claim to source, test, schema, fixture, and non-claim.

Stop doing: adding frontier nouns faster than verifier artifacts.

Do every day: remove or downgrade one unsupported claim, or add one negative test.

One commit to make next: `ci: run forbidden claim scanner in validate`.

One Codex task to run next:

```text
On branch codex/verifier-negative-fixtures, add invalid sample receipt fixtures for tenant mismatch, altered payload digest, wrong public key, and unsupported algorithm. Only edit examples/sample-receipts/** and tests/unit/receipt-schema/**. Run npm test -- tests/unit/receipt-schema and npm run claims:check. Commit "verifier: add negative receipt fixtures". Do not claim semantic truth or compliance.
```

One Gemini research task to run next:

```text
Research current external-verifier patterns in Sigstore/Rekor, AWS Nitro attestation verification, RISC Zero receipts, and SP1 public values. Produce a source-cited table with practical-now versus research-only recommendations for Ghost-Ark. Do not propose live AWS actions. Do not infer implementation files without checking the repo.
```
