# Ghost-Ark / CC-Framework Infrastructure Roadmap 2026–2030

Status: engineering and research roadmap. Every item in this document is
aspirational unless its evidence-status label says otherwise. A roadmap item is
not evidence. A schema is not implementation. A design is not a deployed
system. A benchmark plan is not a result.

Claim boundary: Ghost-Ark provides cryptographic receipts and bounded
governance evidence. It verifies what was recorded, signed, policy-bounded, and
replayable under Ghost-Ark verifier rules. It makes no AI-safety proof claim,
no semantic-truth claim, no alignment claim, and no deployment-correctness
claim.

Related documents:

- docs/research/RESEARCH_FRONTIER_ROADMAP.md (assurance-maturity staging)
- docs/research/CC_GHOST_DISCRETIZATION_CONTRACT.md (CC-Framework bridge)
- docs/architecture/CLAIM_BOUNDARIES.md
- docs/research/ASSURANCE_MATURITY_LADDER.md
- docs/product/roadmap.md (AWS product surface roadmap)

## Evidence-Status Legend

| Label | Meaning |
|---|---|
| local-only | Implemented and tested in this repository; no live AWS evidence |
| AWS-synth-only | CDK wiring synthesizes and is asserted in tests; not validated against live AWS |
| AWS-live | Validated in a supervised live AWS window with recorded evidence |
| research-only | Formal, schema-level, or experimental construct; no runtime implementation |
| aspirational | Planned; no artifact exists yet |
| non-claim | Explicitly not claimed |

Every section below carries one of these labels. Where a section mixes states,
each element is labeled individually.

---

## 1. Position

### 1.1 Research thesis [research-only]

Autonomous agents require transactional execution semantics because agent
actions create two hazards that classical transactions, inline blockers, and
admission gates do not model:

1. **Irreversible external effects.** An agent's tool call can release an
   effect into a third-party system (an email, a payment, a deletion) that no
   database-style abort can retract. Classical ACID rollback assumes the
   transaction manager owns all mutated state. Agents do not.
2. **Cognitive contamination.** Even when external state is restored, the
   agent's context, memory, and subsequent reasoning trajectory may retain
   influence from the rolled-back exploration. Classical isolation levels have
   no analogue for this.

### 1.2 Surviving contribution [research-only]

Ghost-Ark, as a speculative execution substrate in which agents:

1. explore actions inside isolated ghost replicas,
2. generate evidence receipts,
3. evaluate commit predicates,
4. commit trajectories that satisfy policy,
5. roll back trajectories that do not,
6. quantify residual contamination within stated measurement bounds.

Step 6 is the least mature and the most scientifically exposed. Section 6 and
Section 16 treat it as a falsifiable research bet, not a capability.

### 1.3 Scope filter (hard constraint)

No feature enters this roadmap unless it strengthens the five-layer
architecture and answers yes to at least one of:

- Does this improve safety-relevant enforcement or containment?
- Does this improve evidence quality or verifiability?
- Does this improve deployability?
- Does this create a durable moat?

Each layer section ends with **Rejected extensions** — features considered and
excluded under this filter.

### 1.4 What exists today (2026-07 baseline)

The current repository is an evidence and enforcement kernel, not a
speculative execution runtime. Recorded passing baseline: `npm run lint`
passes, 63/63 test files, 335/335 tests (re-run at head before relying on it).

| Capability | Where | Status |
|---|---|---|
| Deterministic canonical JSON + digest | packages/receipt-schema/src/hashCanonicalization.ts, receipt.ts | local-only |
| Receipt canonical payload, emission, verification | packages/enforcement-runtime/src/receipts/ | local-only |
| Signature envelope validation, base64 hardening | packages/enforcement-runtime/src/receipts/ | local-only |
| HMAC signing (dev) / KMS signing boundary | packages/enforcement-runtime/src/receipts/signer.ts, infra/cdk | local-only / AWS-synth-only |
| Independent built-ins-only verifier + replay | verifiers/node/ | local-only |
| Receipt checkpointing, Merkle mechanics, inclusion proofs | packages/research-frontier/src/merkle.ts, witnessCheckpoint.ts, schemas/receipt-checkpoint.json | local-only |
| Governed Bedrock invoke: fail-closed, execution-nonce idempotency | packages/enforcement-runtime/src/runtime/ | local-only, AWS wiring AWS-synth-only |
| Retrieval taint filtering | packages/enforcement-runtime/src/retrieval/ | local-only |
| Privacy vault with expiry | packages/enforcement-runtime/src/vault/ | local-only |
| Memory-write gates | packages/enforcement-runtime/src/runtime/ | local-only |
| Tenant-scoped policy loading, counterexample search | packages/policy-compiler, tools/scripts/verifyTenantPolicyCounterexamples.ts | local-only |
| Forbidden-claim scanner with quarantine and hardening | tools/research/check-forbidden-claims.mjs | local-only |
| CC-Framework correlation adapter and discretization contract | packages/research-frontier/src/ccCorrelation.ts, schemas/ghost_discretization_rule_receipt.v1.json | local-only |
| Witness checkpoint / fraud-proof mechanics | packages/research-frontier/src/witnessCheckpoint.ts, witnessFraudProof.ts | local-only, no external witness |
| zk receipt object | packages/research-frontier/src/zkReceipt.ts | research-only, mock-level, no prover |
| Nitro manifest / attestation policy objects | packages/research-frontier/src/nitroManifest.ts | research-only, no live enclave |

### 1.5 What does not exist [non-claim]

Named explicitly so vocabulary does not outrun evidence. The repository today
contains **no**:

- ghost replica runtime, fork/snapshot/rollback engine, or effect-deferral buffer
- contamination score, residual-influence measurement, or any Layer 4 trust lifecycle beyond taint labels and vault expiry
- speculative-transaction receipt types
- delegation, capability transfer, or any multi-agent mechanism
- Python SDK, or any SDK beyond internal TypeScript packages
- AWS-live evidence for the governed invoke path (a standing release blocker)
- external witness, external anchor, or independent third-party audit

---

## 2. Foundational Primitives [research-only]

These are definitions, not implementations.

**Execution trace.** τ = ⟨a₁ … aₙ⟩, an ordered sequence of agent actions:
model invocations, tool calls, memory reads/writes, and control decisions.
Each aᵢ is representable as a canonical JSON event admissible to the existing
canonicalization rules (host-language non-JSON objects rejected before
signing).

**Ghost replica.** An execution environment G(σ₀) forked from base state σ₀ in
which (a) tools are simulated, stubbed, or sandboxed; (b) state mutations are
journaled and reversible; (c) outbound external effects are captured in a
deferred-effect buffer instead of being released. Defining property: nothing
leaves G before a commit decision, except receipts.

**Commit predicate.** Π(τ, E, P) → {ALLOW, ROLLBACK, ESCALATE}, where E is the
evidence set (receipts, provenance, guardrail observations, contamination
estimate) and P is the tenant policy. Π must be deterministic over recorded
artifacts: same (τ, E, P) digests, same verdict. Π evaluates recorded
evidence; it does not evaluate the world. This is the same claim boundary the
receipt verifier already enforces.

**Contamination model.** Split by reversibility mechanism:

- *External contamination* — writes, API calls, file changes. Reversible only
  when the effect was deferred inside the ghost; a released effect is at best
  compensable, never retroactively unreleased. The engine's core discipline is
  therefore effect **deferral**, not undo.
- *Cognitive contamination* — influence on context, reasoning trajectory, and
  learned preference. Potentially irreversible. Handled by bounded residual
  measurement: define ρ(τ_ghost) as observed behavioral divergence between
  matched agents with and without exposure to the rolled-back trajectory,
  under a pre-registered protocol. ρ is an estimate with stated error bounds,
  never a proof of absence. [research-only; measurement validity is an open
  problem — see Section 16.]

---

## 3. Layer 1 — Evidence Kernel

The one layer with substantial existing implementation.

### 3.1 Scientific objective

Give every agent action the evidentiary standing that a Git commit gives a
code change: content-addressed, signed, chained, independently checkable.

**What exactly does an agent prove after every action?** Precisely this, and
no more: *"An execution identified by this nonce, under this tenant, bound to
this policy digest, produced this canonical payload digest, which was signed
by a key authorized in this key manifest epoch, and is included in this
checkpoint."* It does not prove the action was correct, the output true, or
the behavior safe. Signing proves signing authorization over the payload —
nothing about the world.

### 3.2 Engineering architecture

Emission pipeline (stages 1–5 exist today, local-only):

```
event → schema validation → canonicalization → digest → sign (HMAC dev / KMS)
      → ledger append → checkpoint (Merkle) → [future] external anchor/witness
```

### 3.3 APIs

Existing (local-only): `receiptDigest`, canonical payload validation, signer,
verifier, checkpoint tooling (`npm run receipt:checkpoint`,
`receipt:verify:*`). Planned additions (aspirational): `emitSpeculationReceipt`,
`composeReceiptChain`, `proveInclusion`, `verifyChain` in a stable public
surface.

### 3.4 Data structures — improved receipt design

The prompt's draft receipt:

```
Receipt { execution_id, parent_receipt, agent_identity, policy_hash,
          evidence_hash, action_trace_hash, commit_predicate_result,
          contamination_score, rollback_status }
```

has four defects:

1. **Mutable status field.** `rollback_status` changes after emission; a
   signed artifact must never be updated in place. Receipt v1 semantics here
   are append-only and must stay so.
2. **Conflated concerns.** A measurement (`contamination_score`) and a
   decision (`commit_predicate_result`) are separate events with separate
   signers and separate failure modes.
3. **Missing envelope fields.** No schema version, tenant, timestamp, key
   epoch, canonicalization identifier, or nonce — all of which the existing
   receipt kernel already requires for replay and tenant-boundary checks.
4. **Unqualified score.** A bare float invites false precision. Every
   estimate must carry its method digest and bounds.

Improved design: an **event-sourced receipt family** (draft
`ghostark.speculation.*.v1`, research-only, not yet implemented), each member
a standard receipt payload chained by parent digest:

```
speculation_opened.v1   { schema_version, tenant_slug, execution_nonce,
                          parent_receipt_digest, agent_identity_digest,
                          base_state_digest, policy_digest, replica_config_digest,
                          opened_at, key_epoch }
action_observed.v1      { …, action_index, action_trace_digest,
                          deferred_effect_digests[], evidence_digests[] }
contamination_estimate.v1 { …, estimator_id, estimator_version_digest,
                          estimate, bounds: {lower, upper, method},
                          inputs_digest }        # measurement, not decision
commit_decision.v1      { …, predicate_digest, inputs: {trace_digest,
                          evidence_root, policy_digest}, verdict:
                          ALLOW|ROLLBACK|ESCALATE, decision_basis[] }
effects_released.v1     { …, released_effect_digests[],
                          idempotency_keys[] }   # only after ALLOW
rollback_completed.v1   { …, journal_digest, restored_state_digest,
                          unreleased_effect_digests[] }
residual_report.v1      { …, rho_estimate, protocol_digest, caveats[] }
```

Rollback is thus a new signed event, not a mutation — the chain itself is the
lifecycle.

### 3.5 Storage model

Per current target architecture: DynamoDB receipt ledger (append-only access
patterns per docs/architecture/DYNAMODB_ACCESS_PATTERNS.md), S3 Object Lock
checkpoint bundles for archival, per-tenant partitioning under the existing
tenancy model. Status: schemas and access patterns local-only; Object Lock
retention evidence requires an approved live AWS window (standing gap).

**Merkle structure.** Per-tenant append-only receipt log → periodic signed
checkpoint over the Merkle root (exists local-only) → inclusion proofs per
receipt (schema exists) → consistency proofs between checkpoints (aspirational)
→ external anchoring / independent witness co-signing (aspirational; witness
mechanics exist locally with no external witness — see
docs/architecture/transparency-witness-model.md).

**Receipt composition.** A trajectory receipt is the Merkle root over its
ordered event receipts; a session composes trajectories; a delegation (Layer
5) composes sessions across agents. Composition must be associative over
digests so a verifier can check any subtree without the whole history.

**Long-term archival.** Checkpoint bundles with key-manifest epochs
(docs/architecture/ADR-0002) so signatures remain checkable after rotation;
algorithm-agility field reserved in the envelope for future signature-scheme
migration. [aspirational beyond current manifest mechanics]

### 3.6 Security model

Tenant-boundary checks on every verification path (do not weaken); KMS key
identification by immutable key ARN in verification-critical paths, never
mutable alias; local HMAC is dev-only; canonicalization rejects host-language
objects before signing. Threats tracked in docs/security/THREAT_MODEL.md and
the receipt attack corpus.

### 3.7 Failure modes

| Failure | Behavior |
|---|---|
| Signer unavailable | Fail closed: no receipt, no effect release |
| Canonicalization drift between emitter and verifier | Digest mismatch — surfaces as verification failure, by design |
| Key compromise | Epoch rotation via key manifest; old receipts verify against the epoch that signed them |
| Ledger tamper | Checkpoint divergence detectable by any holder of a prior root; detection, not prevention |
| Clock skew | Timestamps are claims by the emitter, never verification inputs |

### 3.8 MVP

Already exists (local-only): canonical receipts, signing, independent
verification, negative corpus, checkpoint mechanics, replay. The Layer 1 MVP
gap is the speculative receipt family above plus consistency proofs.

### 3.9 Research paper opportunity

"Receipts for Agent Actions: An Append-Only Evidence Kernel with Independent
Verification." Contribution: canonical receipt algebra, composition rules,
and a negative corpus methodology. Venue: USENIX Security or ACM CCS.

### 3.10 2030 mature version

Receipt format is a published open specification with ≥2 independent verifier
implementations outside this repository, cross-organization checkpoint
witnessing, and selective-disclosure proofs (below).

**Could another party verify an agent's behavior without seeing private
data?** Bounded yes, for recorded bindings: (a) digests-only verification —
signatures, chains, and inclusion check without payload disclosure; (b)
selective disclosure — Merkle-ize the payload itself with per-field salted
commitments so a verifier sees only opened fields (the evidence-bundle
sanitizer is the existing local precedent); (c) zero-knowledge receipt
predicates remain research-only future work with no prover implemented — the
current zk artifact is mock-level, and no zk claim is made. Semantic content
of the action is never provable this way — only what was recorded and bound.
[a: local-only mechanics; b, c: research-only]

**Rejected extensions:** blockchain settlement of every receipt (anchoring a
checkpoint digest is sufficient and cheaper); receipt-level encryption DRM;
general-purpose provenance for non-agent workloads.

---

## 4. Layer 2 — Ghost Execution Engine

Status: research-only design. Nothing in this layer exists in the repository.

### 4.1 Scientific objective

Establish transactional execution semantics for agents: speculation is free
of external consequence until an explicit, evidence-bound commit.

**How does an AI agent execute without releasing unvetted effects?** By
construction: inside a ghost, every tool call routes through an effect
interceptor that either simulates, sandboxes, or defers. The dangerous path
(release) exists only in the commit controller, behind Π.

### 4.2 Engineering architecture

```
            ┌────────────────────────────────────────────┐
            │              Ghost Manager                  │
            │  fork / lifecycle / quota / teardown        │
            └───────┬────────────────────────┬───────────┘
                    │                        │
        ┌───────────▼──────────┐  ┌──────────▼───────────┐
        │   Ghost Replica G(σ₀)│  │  Checkpoint Engine    │
        │  agent loop          │  │  CoW snapshots of σ    │
        │  effect interceptor  │  │  journal + restore     │
        │  deferred-effect buf │  └──────────┬───────────┘
        └───────────┬──────────┘             │
                    │ receipts               │
        ┌───────────▼──────────┐  ┌──────────▼───────────┐
        │   Evidence Kernel    │  │  Rollback Controller  │
        │      (Layer 1)       │  │  restore σ₀, emit      │
        └───────────┬──────────┘  │  rollback_completed    │
                    │             └──────────────────────┘
        ┌───────────▼──────────┐
        │  Commit Controller   │──ALLOW──▶ Effect Releaser (idempotent, receipted)
        │   evaluates Π (L3)   │──ROLLBACK▶ Rollback Controller
        └──────────────────────┘──ESCALATE▶ Human review queue (L3/H spine)
```

Agent transaction lifecycle (each transition emits a Layer 1 receipt):

```
CREATE → FORK GHOST → EXECUTE (defer effects) → OBSERVE (evidence, estimates)
       → EVALUATE Π → COMMIT (release deferred effects idempotently)
                    | ROLLBACK (restore σ₀, discard buffer, emit journal receipt)
                    | ESCALATE (freeze ghost, hand to human review)
```

### 4.3 APIs (aspirational surface)

`ghost.fork(baseState, replicaConfig)`, `ghost.intercept(toolCall)`,
`ghost.observe()`, `ghost.evaluate(policy)`, `ghost.commit()`,
`ghost.rollback(reason)`, `ghost.escalate(route)` — every call returning a
receipt handle.

### 4.4 Data structures

Deferred-effect buffer entries: `{effect_class, target_digest, payload_digest,
idempotency_key, reversibility: deferred|compensable|irreversible}`.
State journal: ordered CoW page/record deltas with digests, enabling both
restore and replay. Determinism record: tool responses and model outputs
captured for replayable re-execution (the existing replay-manifest mechanics
are the precedent, local-only).

### 4.5 Storage model

Local dev: in-process state + SQLite journal. AWS: DynamoDB transactional
writes for journals, S3 versioned objects for snapshots, Step Functions for
the lifecycle state machine, Firecracker-class micro-VMs (or Lambda for pure
tool-stub mode) for replica isolation. Kubernetes: pod-per-replica with
gVisor/Kata runtime class and CSI volume snapshots. [all aspirational]

### 4.6 Security model

The interceptor is the enforcement point: a ghost gets no raw network egress,
only brokered tool endpoints (consistent with the existing read-only tool
gateway boundary). Replica escape is the primary threat; isolation strength is
whatever the chosen sandbox provides and must be stated per deployment, not
asserted globally. No enclave or attestation claim is made without a live,
tested AWS attestation flow.

### 4.7 Failure modes

- Ghost crash mid-speculation → nothing was released; teardown emits an
  aborted-speculation receipt. Fail-closed by construction.
- Commit crash mid-release → idempotency keys make release resumable without
  duplication; `effects_released` receipts record exactly what escaped.
- Simulation divergence (stub ≠ real API) → commit-time revalidation against
  live preconditions; divergence forces ESCALATE, never silent ALLOW.
- Buffer exhaustion / runaway ghost → quotas in Ghost Manager; kill = rollback.

### 4.8 Comparison — what is uniquely agent-specific

| Substrate | Isolates | Cannot model |
|---|---|---|
| Containers/VMs | processes, filesystems | outbound third-party effects; agent memory |
| DB transactions | data the DBMS owns | effects outside the database; reasoning state |
| Serverless sandboxes | compute | statefulness across steps; commit semantics |
| **Ghost-Ark** | **effects + evidence + memory influence** | semantic correctness (non-claim) |

Uniquely agent-specific: (1) the mutation surface is the *world*, so the
primitive is effect deferral, not memory isolation; (2) the transaction
carries *cognitive* state whose contamination outlives rollback; (3) commit is
policy-and-evidence-based, not conflict-based — Π replaces serializability;
(4) partial trajectory commit (keep steps 1–4, discard 5–7) has no classical
analogue.

### 4.9 MVP (Phase 1 target)

Local-only TypeScript module: in-process ghost with recorded tool stubs,
deferred-effect buffer, journal-based rollback, receipts through the existing
signer path. No new isolation technology — process-level only, stated plainly.

### 4.10 Research paper opportunity

"Ghost-Ark: Speculative Transactional Execution for LLM Agents." Contribution:
lifecycle semantics, effect-deferral taxonomy
(deferred/compensable/irreversible), and the GhostBench containment benchmark.
Venue: OSDI, SOSP, or EuroSys.

### 4.11 2030 mature version

Multi-cloud replica backends behind one lifecycle API; sub-second fork for
tool-stub ghosts; TLA+ model of the lifecycle state machine with
machine-checked invariants (planned formal modeling — no formal-verification
claim until it exists and is tested).

**Rejected extensions:** full-fidelity internet simulation (unbounded scope);
speculative execution of *other agents'* infrastructure; GPU-state
snapshotting (cost without evidence value at this stage).

---

## 5. Layer 3 — Commit Intelligence Engine

Status: policy evaluation, fail-closed decisions, and counterexample search
exist (local-only). The predicate DSL and risk budgets are research-only.

### 5.1 Scientific objective

Make commit decisions reproducible and contestable: any verdict must be
re-derivable by a third party from (τ, E, P) digests alone.

### 5.2 Engineering architecture

Pipeline: evidence assembly → evidence-quality scoring → predicate evaluation
(deterministic, compiled from policy) → verdict receipt → routing
(release / rollback / human queue). The existing governed-invoke decision path
(fail-closed, deterministic policy evaluation, decision receipts) is the
embryo of this engine. [local-only]

### 5.3 The policy language — improved

The prompt's sketch:

```yaml
commit_policy:
  max_contamination: 0.05
  require:
    provenance_score: 0.95
    reversible_effects: true
```

is untyped, unversioned, silent on unknown effect classes, and treats scores
as free-floating numbers. Improved draft (research-only):

```yaml
schema: ghostark.commit_policy.v1
tenant: acme-lab
policy_id: payments-agent-2026-07
default_verdict: ROLLBACK            # deny by default; unknown ⇒ not ALLOW
effect_classes:
  read_only:        { verdict: ALLOW }
  reversible_write: { require: { evidence_completeness: ">= 1.0" } }
  compensable:
    require:
      provenance: { min_tier: signed_chain }   # tiers, not bare floats
      human_approval: false
    escalate_if: { compensation_untested: true }
  irreversible:
    verdict: ESCALATE               # never auto-ALLOW irreversible effects
contamination:
  estimator: ghostark.residual.v0    # bound to estimator version digest
  max_estimate_upper_bound: 0.05     # bound the upper CI, not the point value
risk_budget:
  window: 24h
  max_committed_irreversible: 0
  max_escalations: 10                # budget exhaustion ⇒ ROLLBACK, not queue growth
predicate_tests:                      # policies ship with counterexamples
  - expect: ROLLBACK
    when: { effect_class: irreversible, human_approval: false }
```

Design rules: versioned schema; deny-by-default; verdicts per effect class;
thresholds bind to estimator version digests so a number is meaningless
without its method; policies carry their own counterexample tests (the
existing policy counterexample tooling extends naturally here); every policy
compiles to a deterministic evaluator whose digest goes into the decision
receipt.

### 5.4–5.7 Data, storage, security, failure modes

Policies stored in the existing tenant-scoped policy repository (DynamoDB
wiring AWS-synth-only); policy digest bound into every decision receipt
(exists for governed invoke, local-only). Security: policy write access is
itself a governed, receipted action; predicate evaluation runs with no network
access. Failure modes: missing evidence ⇒ not ALLOW (fail closed, exists);
estimator unavailable ⇒ treat contamination bound as exceeded; conflicting
policies ⇒ most restrictive verdict wins; budget exhaustion ⇒ ROLLBACK.

### 5.8 MVP

Map Π v0 onto the existing policy engine: effect-class rules + evidence
completeness only, no contamination input (honest about what the estimator
can't yet provide). [Phase 1 target]

### 5.9 Research paper opportunity

"Commit Predicates: Deterministic, Contestable Admission of Agent Effects."
Contribution: predicate DSL semantics, counterexample-carrying policies, and
reproducible-verdict evaluation. Venue: NDSS or IEEE S&P; the
predicate-verification pipeline is a plausible CAV/TACAS artifact.

### 5.10 2030 mature version

**Can organizations write safety rules for agents like firewall rules today?**
Bounded answer: yes for *syntactic* rules — effect classes, provenance tiers,
evidence thresholds, budgets — which is exactly the firewall analogy: port
filters, not intent detection. No for *semantic* rules ("is this action
harmful?"), which require evaluators whose failures correlate — precisely what
CC-Framework measures. The mature engine consumes CC-Framework co-failure
estimates to discount correlated evaluator agreement instead of naively
counting votes. By 2030: a policy standard library, organization-level policy
inheritance, and a public corpus of predicate counterexamples.

**Rejected extensions:** natural-language policies compiled by an LLM at
decision time (reintroduces the unverified judge inside the verifier); global
cross-tenant reputation scores (tenant-boundary violation).

---

## 6. Layer 4 — Memory Integrity System

Status: three primitives exist locally — retrieval taint filtering, privacy
vault with expiry, memory-write gates. The trust lifecycle, admission receipts,
quarantine, and any contamination measurement are research-only.

### 6.1 Scientific objective

Control how information becomes durable influence. Agents learn, remember, and
accumulate contamination; memory is where a rolled-back trajectory can still
leak into the future.

**How does an agent know whether something it remembers should influence
future decisions?** Design answer: it checks the memory's admission receipt
chain against *current* policy at **read time**, not only at write time. A
memory admitted under yesterday's policy or an expired estimator is
re-quarantined on read. Trust is never a property of content; it is a property
of the evidence chain attached to the content, re-evaluated on every use.

### 6.2 The memory object — improved

The prompt's sketch (`content, origin, evidence_chain, trust_score,
contamination_budget, expiry`) stores content inline and a scalar trust score.
Improved draft (`ghostark.memory_object.v1`, research-only):

```
MemoryObject {
  schema_version
  tenant_slug
  content_digest              # content by reference; vault holds the bytes
  origin_receipt_digest       # the action that produced it
  admission_receipt_digest    # the gate decision that admitted it (L3 verdict)
  provenance_tier             # signed_chain | attested_tool | model_output | external_untrusted
  taint_labels[]              # extends existing retrieval taint mechanics
  contamination_estimate      # {value, bounds, estimator_digest} or ABSENT
  budget_charged              # what admitting this cost the tenant's budget
  state                       # quarantined | admitted | expired | revoked
  expires_at                  # extends existing vault expiry
  revalidate_on_read: true
}
```

State machine: `proposed → quarantined → admitted → (expired | revoked)`, with
every transition emitted as a Layer 1 receipt. Ghost writes land in a
speculative memory namespace and are admitted only on trajectory commit — this
is how Layers 2 and 4 interlock. Memory rollback = revocation receipt +
exclusion from retrieval (the taint filter is the existing enforcement point),
plus the honest caveat that influence already exercised on past decisions is
not retracted — only measured, within protocol bounds.

### 6.3–6.7 Architecture, storage, security, failure modes

Admission gate extends the existing memory-write gates; retrieval-side
enforcement extends the existing taint filter; bytes live in the vault
(expiry exists). Storage: memory index in DynamoDB, content in vault
namespaces, receipts in the ledger. Security: quarantined content is never
retrievable into prompts — prompt-injection payloads ride on memory, so the
quarantine boundary is a primary injection defense (a control, not a proof of
immunity). Failure modes: index/receipt divergence ⇒ memory unreadable (fail
closed); estimator retired ⇒ affected memories revert to quarantined;
budget exhausted ⇒ admissions stop.

### 6.8 MVP

Extend the existing gates: admission receipts + read-time state check +
speculative namespace. No trust scores at first — provenance tiers only.
[Phase 2 target]

### 6.9 Research paper opportunity

"Memory Integrity for LLM Agents: Provenance-Gated Influence." Contribution:
the read-time revalidation model and quarantine semantics evaluated against
injection-via-memory corpora. Venue: USENIX Security or NDSS; measurement
companion at NeurIPS/ICML.

### 6.10 2030 mature version — and the moat argument

By 2030: memory objects portable across agent frameworks with receipts intact,
organization-wide memory policy, quarantine analytics. This layer is a
plausible durable moat because it accumulates *structured evidence about
information flow over time* — switching away means abandoning the provenance
history that makes an agent fleet auditable. That is a hypothesis about
markets, not a fact. [aspirational]

**Rejected extensions:** cross-tenant memory sharing (boundary violation);
automatic "trust decay" curves without an estimator behind them
(false precision); storing raw content in the receipt ledger (privacy and
size).

---

## 7. Layer 5 — Multi-Agent Trust Fabric

Status: aspirational. Nothing exists. Designed last, deliberately: it composes
Layers 1–4 rather than adding new trust machinery.

### 7.1 Scientific objective

Make delegation an evidence-bound operation: when Agent A delegates to Agent
B, the authority transferred, the work returned, and the evidence chain
between them are all receipted and independently checkable.

**How does Agent A safely delegate to Agent B?** Bounded answer:

```
Agent A
  │ delegation receipt: {capability_digest, attenuated_scope, policy_digest,
  │                      budget_slice, expiry, nonce}
  ▼
Capability token (attenuation-only, macaroon-style: B can narrow, never widen)
  │
Agent B executes inside its own ghost (L2), under A's policy ∧ B's policy (L3)
  │
  ▼
Result + receipt chain rooted at the delegation receipt (receipt inheritance)
  │
Agent A's commit predicate treats B's work as one speculative sub-trajectory:
ALLOW / ROLLBACK / ESCALATE applies to the whole delegated subtree.
```

Non-claim: this verifies recorded bindings of delegated execution. It does not
prove B's outputs are correct or that B's model behaved as intended.

### 7.2–7.7 Design essentials

Trust propagation is non-transitive by default: a delegation chain A→B→C
carries explicit per-hop attenuation, and C's receipts must chain to both
delegation receipts. Collusion detection reuses CC-Framework machinery on the
cross-agent receipt graph: correlated verdict patterns among supposedly
independent agents are a measurable statistic, reported with the same
dependence-assumption discipline as guardrail co-failure. Storage: delegation
receipts in the same ledger; capability tokens are short-lived and never
stored decrypted. Failure modes: expired capability ⇒ B's effects
undeliverable (fail closed); missing inheritance link ⇒ subtree rejected at
A's commit.

### 7.8 MVP

Two-agent, single-tenant delegation with receipt inheritance, in Phase 3. Not
before: multi-agent semantics built on an unvalidated single-agent substrate
would be scope inflation.

### 7.9 Research paper opportunity

"Receipt-Bound Delegation: Attenuated Capabilities for Agent-to-Agent Trust."
Contribution: inheritance semantics + collusion statistics on receipt graphs.
Venue: ACM CCS; collusion measurement companion at SaTML.

### 7.10 2030 mature version

Enterprise workflows (agent org-charts with budget trees), autonomous
organizations (policy-rooted, human-escalation-terminated), agent marketplaces
where a listing is a capability schema plus a verifiable receipt history.
[aspirational]

**Rejected extensions:** global agent reputation network (tenant boundaries,
gaming); token-incentive mechanisms (adds cryptoeconomic attack surface with
no evidence benefit); federated learning across tenants.

---

## 8. Target System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ L5  TRUST FABRIC          delegation · capability attenuation ·      │
│     [aspirational]        receipt inheritance · collusion stats      │
├──────────────────────────────────────────────────────────────────────┤
│ L4  MEMORY INTEGRITY      admission gates · quarantine · read-time   │
│     [3 primitives local]  revalidation · speculative namespaces      │
├──────────────────────────────────────────────────────────────────────┤
│ L3  COMMIT INTELLIGENCE   policy DSL · deterministic Π · budgets ·   │
│     [decision path local] counterexamples · CC co-failure discount   │
├──────────────────────────────────────────────────────────────────────┤
│ L2  GHOST EXECUTION       ghost manager · effect interceptor ·       │
│     [research-only]       deferral buffer · snapshots · rollback     │
├──────────────────────────────────────────────────────────────────────┤
│ L1  EVIDENCE KERNEL       canonical receipts · signing · ledger ·    │
│     [largely local-only]  checkpoints · inclusion · indep. verify    │
├──────────────────────────────────────────────────────────────────────┤
│     CC-FRAMEWORK (side-car science): discretization receipts →       │
│     co-failure estimation → feeds L3 discounting  [adapter local]    │
└──────────────────────────────────────────────────────────────────────┘
Data flow: agent action → L2 intercept → L1 receipt → L3 verdict
         → (release + L4 admission) | (rollback + residual report)
         → observations exported to CC-Framework via discretization receipts
```

Interfaces between layers are receipt digests — a layer consumes the one
below only through signed artifacts, never shared mutable state. That single
rule is what keeps independent verification possible end-to-end.

## 9. Repository Architecture

Evolve the existing workspace; do not rewrite it. The prompt's proposed
`core/execution|receipts|policy|rollback` layout would discard working,
hardened code paths. Planned mapping:

```
ghost-ark/
  packages/
    receipt-schema/        # L1 (exists — hardened; do not destabilize)
    enforcement-runtime/   # L1 emission/verify + L3 decision path + L4 gates (exists)
    policy-compiler/       # L3 policy → evaluator (exists; grows the DSL)
    ghost-engine/          # L2: manager, interceptor, buffer, journal   [new, Phase 1]
    memory-integrity/      # L4 lifecycle over existing gates/vault/taint [new, Phase 2]
    trust-fabric/          # L5                                          [new, Phase 3]
    research-frontier/     # merkle, witness, CC adapter, estimator protocols (exists)
  benchmarks/ghostbench/   # containment + overhead + residual suites    [new, Phase 1]
  sdk/typescript/  sdk/python/                                           [new, Phase 2]
  services/  infra/  schemas/  verifiers/  tools/  docs/  tests/         # as today
```

Hardened paths under packages/receipt-schema, enforcement-runtime receipts/
runtime/retrieval/vault, and infra/cdk/lib/api-stack.ts change only with
migration-grade care, per repository rules.

## 10. SDK and API Design

Reference implementation stays TypeScript (the entire codebase and test
baseline are TS). Python SDK is a Phase 2 deliverable over the same wire
protocol. Design sketch (aspirational — no SDK exists today):

```python
from ghostark import GhostClient, Verdict, EffectClass

client = GhostClient(tenant="acme-lab", policy="payments-agent-2026-07")

# Context manager: abandonment == rollback. No path leaks effects.
with client.transaction(agent=my_agent) as tx:
    result = tx.execute(task)              # runs inside a ghost replica
    decision = tx.evaluate()               # deterministic Π over recorded evidence

    if decision.verdict is Verdict.ALLOW:
        release = tx.commit()              # idempotent effect release
        print(release.receipt.digest)
    elif decision.verdict is Verdict.ESCALATE:
        tx.escalate(route="human-review", context=decision.basis)
    else:
        tx.rollback(reason=decision.basis) # explicit; __exit__ does this anyway

# Every handle carries receipts; verification needs no SDK:
assert client.verify_chain(release.receipt.digest).ok
```

Design rules: the unsafe path does not exist in the API (there is no
`tx.execute_without_ghost()`); every method returns a receipt handle; verdicts
are a closed enum with `basis` always populated; errors are fail-closed
(exception ⇒ rollback); `verify_chain` works offline against public keys, so
consumers never have to trust the SDK that emitted the receipts.

## 11. Implementation Roadmap

Gate discipline: a phase does not begin until the prior phase's evidence gate
is met and recorded under docs/validation/. Deliverables are labeled with the
status they will have when done — building them does not upgrade any claim
retroactively.

**Phase 1 — Research prototype (0–3 months).**
Deliver: `packages/ghost-engine` local-only MVP (process-level ghost, recorded
tool stubs, deferral buffer, journal rollback); `ghostark.speculation.*.v1`
draft schemas + tests; Π v0 on the existing policy engine emitting commit
receipts through the existing signer; GhostBench v0 (≈10 scripted tasks with
irreversible-effect traps; metrics: containment rate, rollback completeness by
state diff, decision reproducibility, latency/cost overhead). Also: close the
standing release blocker with one supervised live AWS validation window for
the existing governed-invoke path — evidence before expansion.
Evidence gate: all new tests pass; benchmark numbers published local-only;
zero regressions in the 335-test baseline.

**Phase 2 — Developer platform (3–12 months).**
Deliver: TypeScript SDK, then Python SDK over the same protocol; ghost
lifecycle deployed on AWS (Step Functions + Lambda/micro-VM backends),
AWS-synth-only first, then one AWS-live validation window; memory-integrity
MVP (admission receipts, read-time revalidation, speculative namespaces);
dashboards in apps/console (receipt explorer exists as product surface);
residual-influence measurement protocol pre-registered and piloted
[research-only].
Evidence gate: an external developer reproduces a full
speculate→rollback→verify cycle from public docs alone.

**Phase 3 — Enterprise infrastructure (year 2).**
Deliver: audit/evidence export built on the existing evidence-pack and
sanitizer tooling; control-mapping crosswalks extended (candidate evidence
for frameworks such as NIST AI RMF and ISO/IEC 42001 — evidence artifacts,
not certification, which only external bodies grant); two-agent delegation
MVP with receipt inheritance; multi-tenant hardening at fleet scale.
Evidence gate: one design-partner deployment with a signed evidence bundle
and an independent verifier run by the partner, not by us.

**Phase 4 — Industry standard (2028–2030).**
Deliver: open protocol spec for receipts + lifecycle + predicate interface;
conformance test suite (the GhostBench + negative-corpus lineage); ≥2
independent implementations; a certification-style conformance program run by
an external body, not by the project.
Evidence gate: a runtime we did not write passes conformance.

## 12. Research Publication Map

| Layer | Paper | Venue (target) | Contribution |
|---|---|---|---|
| L1 | Receipts for Agent Actions | USENIX Security / CCS | Receipt algebra, composition, negative-corpus method |
| L2 | Ghost-Ark: Speculative Transactional Execution for LLM Agents | OSDI / SOSP / EuroSys | Lifecycle semantics, effect-deferral taxonomy, GhostBench |
| L3 | Commit Predicates | NDSS / IEEE S&P (+ CAV artifact) | Deterministic contestable verdicts, counterexample-carrying policies |
| L4 | Cognitive Contamination: Measuring Residual Influence of Rolled-Back Trajectories | NeurIPS / ICML | Pre-registered divergence protocol; the riskiest and highest-value result |
| CC | Correlated Guardrail Failure under Explicit Dependence Assumptions | SaTML / IEEE S&P | Co-failure bounds; discretization receipts as the measurement interface |
| L5 | Receipt-Bound Delegation | CCS | Attenuated capabilities, inheritance, collusion statistics |

Sequencing: L2+L1 systems paper first (it defines the object of study), L4
measurement second (it is the make-or-break claim), L3/L5 after the substrate
is credible.

## 13. Strategy

**Why does this become infrastructure?** If agents take actions with real
consequences, some party — operator, counterparty, insurer, regulator — will
demand evidence of what happened and control over what commits. Evidence and
admission are horizontal concerns, like TLS or logging: badly duplicated per
app, natural as a substrate. [assumption: agent adoption in
consequence-bearing workflows continues]

**Who buys it?** In order: (1) platform teams running agent fleets in
consequence-bearing domains (finance ops, healthcare back-office, infra
automation) who need containment + audit trails; (2) agent-framework vendors
embedding a receipt/commit layer rather than building one; (3) auditors and
insurers who consume evidence bundles rather than produce them.

**Why can't OpenAI/Anthropic simply absorb it?** They can absorb the
*sandbox* — isolation is not the moat. Three things are harder to absorb:
(a) *neutrality* — self-attestation by a model vendor is structurally weaker
evidence than verification under an independent, open verifier; an evidence
layer owned by the party being evidenced loses exactly the property that makes
it valuable; (b) *cross-vendor scope* — enterprises run heterogeneous fleets,
and per-vendor evidence formats recreate the problem the layer solves;
(c) *the measurement science* — CC-Framework-style correlated-failure
analysis and residual-influence protocols are publishable, falsifiable
research assets, not features. Honest counterweight: if a frontier lab ships
"good enough" logging + sandbox defaults, the wedge narrows to regulated,
high-irreversibility deployments — see Section 16.

**What becomes the standard?** Not the runtime — the *formats*: the receipt
schema and composition rules, the lifecycle event vocabulary, the predicate
interface, and the conformance suite that lets anyone claim compatibility and
be checked. Standards win by being verifiable and boring.

## 14. The 2030 CC-Framework Architecture (one page)

By 2030, the intended shape of the system is:

An agent platform where every consequential action is born speculative.
Agents execute inside ghost replicas whose only exits are signed receipts.
External effects accumulate in deferral buffers, classified
deferred/compensable/irreversible. A deterministic commit predicate — written
in a typed, versioned policy language, carrying its own counterexamples,
discounted for correlated evaluator failure using CC-Framework estimates —
decides ALLOW, ROLLBACK, or ESCALATE. Verdicts, releases, rollbacks, and
memory admissions are all append-only receipts in per-tenant Merkle logs with
externally witnessed checkpoints. Memory is provenance-gated: nothing
influences future decisions without an admission chain that is revalidated at
read time, and rolled-back trajectories leave quantified, bounded residual
reports instead of silent influence. Delegation between agents transfers
attenuated, receipt-bound capability, and delegated work returns as a
speculative subtree under the delegator's own commit predicate. Around the
core: an open receipt and lifecycle specification, at least two independent
verifier implementations, a conformance suite descended from GhostBench and
the negative corpus, and a measurement literature — correlated guardrail
failure, residual influence — that exists independently of any one vendor.

What it still is not, in 2030, on this plan: a proof of semantic safety, a
truth oracle, a compliance certificate, or a substitute for red-teaming and
evaluation. The claim boundary of the first receipt is the claim boundary of
the whole architecture.

## 15. The Next 30 Days

Concrete, repo-specific, ordered:

1. Draft `schemas/research/ghostark.speculation.*.v1.json` (the receipt family
   in §3.4) with vitest schema tests. No runtime yet — schemas and negative
   fixtures first, matching how every other spine was built.
2. Scaffold `packages/ghost-engine` (local-only): transaction state machine,
   deferred-effect buffer, journal rollback, recorded tool stubs. Wire receipt
   emission through the existing signer path. Unit tests for every lifecycle
   transition including crash-mid-commit.
3. Implement Π v0 as a thin layer over the existing policy engine: effect
   classes + deny-by-default + decision receipts. Add counterexample tests via
   the existing `policy:counterexamples` tooling.
4. Build GhostBench v0: ten scripted agent tasks seeded with
   irreversible-effect traps; report containment rate, rollback completeness,
   verdict reproducibility, and overhead in docs/validation/ with local-only
   labels.
5. Write and pre-register the residual-influence measurement protocol
   (docs/research/, research-only): matched-agent behavioral divergence,
   estimator versioning, failure criteria stated in advance.
6. Execute the supervised live AWS validation window for the existing
   governed-invoke path (standing release blocker). New layers do not excuse
   old evidence debt.
7. Update the claim-evidence matrix and assumption registry for every artifact
   above; run `npm run validate` before each merge.

## 16. The Three Things That Could Kill This Project

1. **Residual influence may not be measurable in a defensible way.** Cognitive
   contamination is the thesis's novel object. If the pre-registered
   divergence protocol cannot separate signal from prompt-level noise — or
   reviewers show the metric is gameable or model-version-fragile — Layer 4's
   differentiator collapses into ordinary memory ACLs and Layer 2 loses its
   deepest justification. Mitigation: pre-registration, adversarial baselines,
   and a stated willingness to retract the construct. This is a real
   falsification risk, not a formality.
2. **The speculation tax may exceed the value for most workloads.** If
   ghosting doubles latency and cost while most agent actions are low-risk,
   buyers will choose inline filters and accept the residue. The project only
   clears the bar where irreversibility is expensive — payments, infra
   mutation, records. If GhostBench overhead numbers come back ugly and
   cannot be engineered down (tool-stub fast paths, effect-class-scoped
   ghosting), the honest conclusion is a niche product, not a substrate.
3. **Platform absorption before the formats are open.** If frontier labs ship
   integrated sandbox-plus-audit defaults before the receipt and lifecycle
   formats exist as an open, independently implemented standard, Ghost-Ark
   becomes a feature comparison it loses on distribution. The counter is
   sequencing: publish the spec and conformance suite early (Phase 2, not
   Phase 4) and recruit a second implementation even at the cost of
   short-term differentiation. A related self-inflicted variant: letting
   claims outrun evidence. The entire value of this project is that its
   statements survive skeptical review; one overclaimed capability spends
   that down faster than any competitor could.

## 17. Assumption Register (marked)

- A1: Agent adoption in consequence-bearing workflows continues through 2030.
- A2: Effect deferral is compatible with acceptable latency for a commercially
  meaningful subset of agent tasks. (Tested by GhostBench, Phase 1–2.)
- A3: Residual influence is operationalizable as bounded behavioral
  divergence. (Riskiest; see §16.1.)
- A4: Buyers value independent verification over vendor-integrated logging.
- A5: The existing local-only receipt kernel survives live AWS validation
  without semantic changes. (Standing release blocker; tested in Phase 1.)
- A6: CC-Framework co-failure estimates transfer from guardrail evaluation to
  commit-evaluator discounting. (Research question, not a given.)

## 18. Non-Claims for This Roadmap

This document does not claim: production readiness; safety of any agent or
model; that rollback removes all influence; that contamination estimates are
proofs of absence; that any AWS path is live-validated beyond what
docs/validation/ records; formal verification of any component; zero-knowledge
verification capability; hardware attestation or enclave integrity;
compliance status of any kind; certified status under any external framework. Every
future-tense system in this document is a plan. Plans are not evidence.
