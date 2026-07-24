# Ghost-Ark Glossary

Short definitions for the repository's load-bearing terms, in dependency order.
Terms link to the artifact that defines them; if a term has no artifact, it is
labeled aspirational and must not be cited as capability.

**Ghost Protocol** — the doctrine and threat model layer. Ghost-Ark is one
implementation of it; the protocol itself ships no code.

**Ghost-Ark** — this repository: an AWS-native evidence/control-plane
implementation producing bounded governance receipts and deterministic
enforcement primitives around LLM/agentic applications.

**CC-Framework** — the measurement science for correlated guardrail failure:
turning guardrail outcomes into binary variables and computing co-failure tables,
Wilson intervals, phi, and Fréchet bounds per cohort. Local bridge:
`packages/research-frontier/src/ccCorrelation.ts`.

**Receipt** — a canonical JSON record of a decision or evidence event, signed so
that a third party can re-verify what was recorded. A receipt shows signing
authorization over its payload; it does not show the payload describes the world
correctly. Schemas: `packages/receipt-schema/`, `schemas/`.

**Canonicalization** — the deterministic byte serialization signed and verified.
Host-language non-JSON objects are rejected before signing. Implementations:
`packages/receipt-schema/src/hashCanonicalization.ts`,
`packages/enforcement-runtime/src/receipts/canonical.ts`. RFC 8785/JCS compliance
is not claimed.

**Governed invoke** — the runtime path that resolves identity from verified
context (never client fields), evaluates pre-model policy, invokes the model
through the custody layer, evaluates post-model policy, and emits a decision
receipt — failing closed at each gate.
`packages/enforcement-runtime/src/runtime/governedInvoke.ts`.

**Transit ledger / custody** — the recording layer around model egress; an
invocation that would leave no record fails closed instead.
`packages/enforcement-runtime/src/gateway/gatewayModelInvoker.ts`.

**Nonce / tombstone ledger** — the anti-replay store: a consumed nonce leaves a
tombstone, and re-submission is rejected. Implementation `dab/gateway/src/nonce.rs`;
bounded model `proofs/dab/artifacts/`. Bounded at 500k in-process entries — see
the threat model's B4 residual.

**DAB (Declarative Action Binding)** — the tier binding declared agent actions to
cryptographic receipts at a gateway, so an action and its evidence cannot drift
apart silently. Code under `dab/`.

**Evidence bundle** — a sanitized, schema-validated package of captured evidence
(local or from a bounded live AWS window) that a reviewer can validate offline:
`npm run validate:evidence-bundle`. Live bundles: not complete.

**Evidence classes** — every claim carries one: `local-only`,
`AWS-synth-only`, `AWS-live`, `research-only`, `aspirational`, `non-claim`.
Anything without a class defaults to unproven.

**Spine (A–H, + Compliance)** — the evidence maturity checklist in the README
appendix. A = claim discipline, B = receipt reproducibility/verification,
C = evidence bundles and deployment evidence, D = key lifecycle, E = guardrail
observation, F = CC correlation analysis, G = checkpoint/witness/Object Lock,
H = human review and incident workflow. "Complete locally" means artifacts and
tests exist here; it does not imply deployed-environment operation.

**Claim gate / non-claim scanner** — `npm run claims:check`
(`tools/research/check-forbidden-claims.mjs`): scans the repository for forbidden
assurance overclaims and fails the build on any hit.

**Assumption lattice** — the annotated capability ceiling per module
(`docs/architecture/ASSUMPTION_LATTICE.md`, checked by `npm run assumptions`):
research-only code cannot silently present itself above its class.

**Fréchet bounds** — for two events with known marginal probabilities, the exact
arithmetic minimum and maximum their joint probability can take. Used here as
worst-case/best-case envelopes on guardrail co-failure — no independence
assumption, no distributional model.

**Wilson interval** — the score-based binomial confidence interval used for
failure rates in CC reports; better behaved than the normal approximation at
small n and extreme rates.

**Impossibility spine** — the runnable set of negative results and bounds the
repository maintains: things shown unreachable or unavoidable within stated
models (e.g., nonzero Fréchet lower bounds, replay exclusion within ledger
bounds), each backed by a checkable artifact.

**Ghost replica / speculative collapse** — the execution-buffer model in which an
agent's speculative intent is validated by gates before commit, and discarded
(collapsed) with an alert on failure. Models:
`proofs/tla/SpeculativeCollapse.tla` (+ mutant showing the property is
load-bearing).

**Witness / checkpoint** — the transparency mechanism: receipts are checkpointed
(Merkle inclusion) so a later mutation of history is detectable by a verifier
holding an earlier checkpoint. Local mechanics exist; independent external
witnesses do not (Spine G partial). Taxonomy:
`docs/research/WITNESS_FORK_TAXONOMY.md`.

**Bounded live AWS evidence window** — the only sanctioned way to make an
`AWS-live` claim: preflight runbook → time-boxed capture → sanitization →
schema validation → reviewer inspection. Runbooks under
`docs/operations/runbooks/`.

**Fail closed** — on missing configuration, failed verification, or boundary
mismatch, the operation is refused and the refusal is auditable; absence of
evidence never upgrades to permission.
