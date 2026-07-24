# Ghost-Ark Threat Model

This document enumerates the adversaries Ghost-Ark is designed against, the trust
boundaries where they act, the controls at each boundary, and — with equal weight —
the residual gaps. Every control row cites the artifact (code, test, model-checking
log, or corpus) that is the evidence for it. A control with no artifact is listed as
a gap, not a control.

Method: adversary-by-boundary. A claim here is only as strong as the cited evidence,
and evidence classes follow the repository's ladder: local-only, AWS-synth-only,
AWS-live, research-only, aspirational, non-claim. Where a model-checking result is
cited, it is bounded model checking over the stated state space — not a proof about
unbounded executions or about the implementation itself, except where a conformance
test binds the implementation to the model.

Related documents: [TENANT_BOUNDARY.md](./TENANT_BOUNDARY.md) (release-blocking
isolation rules), [RECEIPT_ATTACK_CORPUS.md](./RECEIPT_ATTACK_CORPUS.md) (receipt
mutations that must fail closed), [THREAT_MODEL_FRONTIER.md](../research/THREAT_MODEL_FRONTIER.md)
(enclave/frontier research scope, weaker evidence class), and
[non-claims.md](../compliance/non-claims.md).

---

## 1. Assets

- Tenant-scoped policies and compiled policy hashes.
- Tenant, user, session, and request identity context.
- Memory records and memory-write decisions.
- Decision receipts, evidence receipts, and checkpoint artifacts.
- KMS signing keys (AWS mode) and local-dev HMAC secrets (dev-only).
- The nonce/tombstone anti-replay ledger state.
- Minimized audit metadata and redacted structured logs.
- Guardrail observation records and CC correlation reports.

## 2. Adversary catalog

| ID | Adversary | Capability assumed |
|:---|:---|:---|
| A1 | Malicious end user | Crafts prompts and request bodies; cannot alter server code |
| A2 | Cross-tenant insider | Valid credentials for tenant A; targets tenant B's state |
| A3 | Poisoned retrieval corpus | Controls documents the runtime retrieves as context |
| A4 | Malicious client application | Sends arbitrary field values, replays, malformed envelopes |
| A5 | Transport-level attacker | Observes, reorders, or re-submits wire messages |
| A6 | Partially compromised host | Reads process memory/disk on the runtime host; cannot break KMS key custody |
| A7 | Mistaken policy author | Ships a wrong-but-authorized policy; no malice required |
| A8 | Replay attacker | Re-submits previously valid requests, receipts, or measurements |
| A9 | Evidence-layer attacker | Forges, mutates, or re-canonicalizes receipts to launder a decision |
| A10 | Correlated guardrail failure | Not a person: the systemic event where multiple guardrails fail together |
| A11 | Log observer | Reads emitted logs and telemetry |
| A12 | Signing-key attacker | Attempts key substitution, alias re-pointing, or dev-secret theft |

Out of scope (declared, not defended): a fully compromised cloud provider, hardware
implants, compromise of the KMS service itself, and model-internal deception that
produces policy-compliant text. See non-claims.

## 3. Trust boundaries and controls

### B1 — Client ↔ Governed invoke (identity and input)

Threats: A1, A2, A4. Client-declared `tenant_id`/`user_id`/`session_id`; cross-tenant
path/auth mismatch; malformed request shapes.

Controls (evidence):
- Identity derives from JWT/authorizer context only; client-declared identity fields
  are rejected — `packages/enforcement-runtime/src/runtime/governedInvoke.ts`,
  exercised by `tests/integration/test_governedInvokeLifecycle.test.ts`.
- Tenant slugs are canonical-validated; IAM policy variables render as
  `${aws:PrincipalTag/slug}` with HCL escaping (Terraform) — see README security
  defaults and `infra/terraform`.
- Tenant-isolation invariants model-checked within bounds: `proofs/tla/TenantIsolation.tla`.
- Cross-tenant access rules are release-blocking: [TENANT_BOUNDARY.md](./TENANT_BOUNDARY.md).

Residual: live multi-tenant isolation in a deployed account has no live evidence
bundle (Spine C: not complete). TLA scope is bounded state spaces, not the deployed
IAM graph.

### B2 — Runtime ↔ Model (Bedrock adapter and custody)

Threats: A1, A3, A6. Un-governed egress to a model; model output treated as trusted;
invocation of un-allowlisted models.

Controls (evidence):
- Model invocation flows through the gateway custody path
  (`packages/enforcement-runtime/src/gateway/gatewayModelInvoker.ts` with the
  transit-ledger recording layer); an egress that is not recorded fails closed
  rather than proceeding silently.
- AWS governed-invoke mode requires a configured Bedrock model allowlist;
  unconfigured invocation fails closed before Bedrock (README security defaults).
- Model output is untrusted until post-model policy evaluation completes
  (`packages/enforcement-runtime/src/runtime/`).
- Transport-boundary reconciliation is load-bearing, not incidental:
  `proofs/tla/TransportBoundary.tla` with `TransportBoundaryMutant.tla` showing the
  property fails when the reconciler is removed.

Residual: custody evidence is local/simulated; no live Bedrock evidence bundle.
A6 reading process memory during an invocation window is not prevented — the design
goal is that the invocation leaves a signed record, not that the host is opaque.

### B3 — Runtime ↔ Retrieval and memory

Threats: A3, A1. Retrieved text asserting instruction authority; memory persisting
restricted content.

Controls (evidence):
- Retrieved context is data, never instruction authority; retrieval is tenant- and
  taint-filtered (`packages/enforcement-runtime/src/retrieval/`).
- Memory-write gates: `MEMORY_SUPPRESS` blocks persistence; restricted memory
  without explicit consent is not written (`packages/enforcement-runtime/src/runtime/`,
  unit lanes under `tests/unit/enforcement-runtime/`).

Residual: taint filtering is rule-based; a poisoned document that satisfies the
rules still reaches the prompt. This boundary reduces authority, it does not
classify truth.

### B4 — Anti-replay (nonce/tombstone ledger)

Threats: A8, A4.

Controls (evidence):
- DAB gateway tombstone ledger: `dab/gateway/src/nonce.rs`, wired into the binary
  (`main.rs`), with the replay path exercised over a real socket
  (`dab/roundtrip/`, recorded second-submission → `REPLAY_REJECTED`).
- Model-checked within bounds: `proofs/dab/artifacts/DAB_NonceLedger.tlc.txt`
  (`NoReplays` + `EventualGC`, complete bounded space) and the mutant counterexample
  `DAB_NonceLedger_Mutant.tlc.txt` reproducing the TOCTOU failure the design excludes.

Residual (do not drop this caveat): the in-process `spent` set is bounded at
500,000 entries; pruning at capacity reopens a theoretical replay window for
nonces older than TTL+capacity. Durable conditional-write storage is the named,
not-implemented production posture. Replay statements must carry this bound.

### B5 — Receipt production ↔ verification (evidence layer)

Threats: A9, A4. Non-canonical JSON accepted; tampered fields; signature envelope
confusion; a validly signed receipt that lies about scope.

Controls (evidence):
- Deterministic canonical JSON with host-language non-JSON objects rejected before
  signing: `packages/receipt-schema/src/hashCanonicalization.ts`,
  `packages/enforcement-runtime/src/receipts/canonical.ts`.
- Verifier and negative corpus: `packages/enforcement-runtime/src/receipts/verifier.ts`,
  `npm run receipt:verify:corpus` (malicious receipt corpus,
  [RECEIPT_ATTACK_CORPUS.md](./RECEIPT_ATTACK_CORPUS.md)), independent Node verifier
  with differential agreement (`npm run receipt:verify:agreement`), replay of
  manifests (`npm run receipt:verify:replay`).
- What a signature means is constrained in writing: signing shows signing
  authorization over the payload; it does not show the content is true or safe
  (CLAUDE.md signature rules; README claim discipline).

Residual: no external cryptographic audit; checkpoint/witness model has no
independent witness (Spine G partial); Object Lock retention/denial evidence is
not complete (requires a live window).

### B6 — Signing boundary (KMS / local HMAC)

Threats: A12, A6.

Controls (evidence):
- AWS mode signs with an asymmetric KMS key (`SIGN_VERIFY`); verification-critical
  paths use immutable key ARNs, not mutable aliases (CLAUDE.md signature rules;
  `infra/cdk/lib/api-stack.ts` assertions).
- Local HMAC is dev-only and stated as such everywhere it appears; key lifecycle
  and rotation protocol exist locally (Spine D: epoch/signing policy + runbook
  tests).
- Plaintext secrets are never injected into CDK Lambda environment variables
  (README security defaults; CDK stack tests).

Residual: live KMS rotation evidence is AWS-required and absent; KMS custody is
assumed, not demonstrated, against A6.

### B7 — Logging and observability

Threats: A11.

Controls (evidence): structured logs redact prompts, completions, memory, raw
bodies, and credential-like fields by default (enforcement-runtime logging;
README security defaults).

Residual: redaction is deny-list-shaped; novel sensitive field names can leak
until added. Log transport/retention posture in a deployed account is unproven
here.

## 4. Correlated guardrail failure (A10) — why the Fréchet bounds exist

The failure mode that motivates the CC-Framework bridge is not one guardrail
failing; it is several failing together, at the same inputs, under a shared cause
(shared model, shared prompt distribution, shared misconfiguration). Independence
assumptions silently understate this joint risk.

What the repository actually computes (`packages/research-frontier/src/ccCorrelation.ts`,
contract in [CC_CORRELATION_ANALYSIS.md](../research/CC_CORRELATION_ANALYSIS.md)):
per-variable failure rates with 95% Wilson intervals, full `n00/n01/n10/n11`
co-failure tables, empirical phi where defined, and pairwise Fréchet lower/upper
bounds computed from observed marginals. The adapter fails closed on unbound
observations, wrong guardrail names, out-of-domain scores, non-rectangular grids,
mixed cohorts, or a missing stationarity declaration — silent pairwise deletion is
structurally excluded.

Failure scenarios this instruments:
- Two "independent" guardrails whose observed co-failure rate sits at the Fréchet
  upper bound — evidence they share a cause; treat them as one control, not two.
- A cohort whose joint-failure Wilson interval excludes the product of marginals —
  the independence assumption in a risk calculation is empirically wrong for that
  cohort.
- A declared marginal that makes the Fréchet lower bound on joint failure nonzero —
  some co-failure is then arithmetically unavoidable no matter how the guardrails
  are wired, and the only fix is improving a marginal.

Boundary: the analysis is complete locally with synthetic fixtures; there is no
live fleet integration. The bounds are exact arithmetic over declared/observed
marginals; they say nothing about unobserved cohorts or non-stationary drift
beyond the declared scope.

## 5. Evidence index (claims → commands)

| Claim (narrow) | Command | Artifact class |
|:---|:---|:---|
| Receipt verification rejects the attack corpus | `npm run receipt:verify:corpus` | local |
| Independent verifier agrees differentially | `npm run receipt:verify:agreement` | local |
| Reproducibility manifest replays | `npm run receipt:verify:repro` | local |
| Claim language stays inside the boundary | `npm run claims:check` | local |
| Assumption lattice holds | `npm run assumptions` | local |
| Nonce ledger excludes replays in bounded model | see `proofs/dab/artifacts/` | local (bounded model) |
| Tenant-isolation invariants (bounded) | `proofs/tla/TenantIsolation.tla` + TLC | local (bounded model) |
| Infrastructure synthesizes | `npm run infra:synth` | AWS-synth-only |
| Live evidence bundles | — | not complete |

## 6. Non-claims

This threat model does not claim to prove AI safety, legal compliance, clinical or
emotional safety, semantic correctness, complete tenant isolation, deployed-account
hardening, or production readiness. Model-checking citations are bounded-state
results, not statements about unbounded executions. A signature shows signing
authorization over bytes, never that the bytes describe the world correctly.
Adversaries listed as out-of-scope are unmitigated by design and must be covered
by controls outside this repository.
