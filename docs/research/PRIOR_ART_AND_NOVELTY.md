# Ghost-Ark — Prior Art and Architectural Novelty

Status: research positioning note, 2026-07-17. External frameworks are
characterized from their public documentation as retrieved on this date —
these are literature positions, not audits of third-party code. Ghost-Ark's
own claims below are each bound to committed, replayable artifacts in this
repository.

Claim boundary up front: this document claims (a) a runnable impossibility
spine, (b) dependence-free bounding plus cohort-scoped measurement of
correlated guardrail failure, and (c) mechanically enforced claim discipline.
It does not claim post-quantum cryptography, enterprise directory scale,
production readiness, or any form of semantic agent safety.

## 1. The receipt layer has commoditized — we concede it

"Cryptographic receipts for AI agents" is now a category, not a novelty:
the [VERA protocol](https://berlinailabs.de/blog/vera-protocol-launch.html)
(Berlin AI Labs; Ed25519 and ML-DSA-65 signing sidecar, nonce-bound tool
outputs), [AgentReceipts.ai](https://agentreceipts.ai/),
[Meridian Verity](https://meridianverity.com/ai-agent-verification-receipts/),
[PipeLab AAR](https://pipelab.org/learn/agent-action-receipts/), a proposed
[AutoGen action-receipt feature](https://github.com/microsoft/autogen/issues/7353),
and [Notarized Agents (arXiv:2606.04193)](https://arxiv.org/pdf/2606.04193).

Ghost-Ark explicitly concedes this layer. Producing a signed envelope over an
agent action is sound engineering and no longer a differentiator. In this
repository, receipts are the *utility layer* that records the outputs of the
actual contributions: decidable enforcement, epistemic bounding, and
correlated-failure analysis. A signature authenticates a record; it cannot say
how likely that record is to be a well-signed failure. Everything defensible
here lives in that gap.

## 2. Differentiation matrix

| Framework | Primary form | Trust primitive | Failure treatment | Impossibility grounding |
| :--- | :--- | :--- | :--- | :--- |
| [ATF](https://github.com/massivescale-ai/agentic-trust-framework) (MassiveScale/CSA) | Governance rubric (markdown spec; no code) | Asserted conformance (checklist, RFC 2119) | Alerting required ("60 seconds"); enforcement not required; no correlation treatment | None |
| [VERA](https://berlinailabs.de/blog/vera-protocol-launch.html) / receipt-layer cluster | Signing sidecars / notarization protocols | Cryptographic signature over actions | Not addressed | None |
| Enterprise guardrail stacks (e.g., [Microsoft ZT4AI](https://learn.microsoft.com/en-us/entra/fundamentals/zero-trust-ai) + Prompt Shields + Purview) | Identity plane + stacked probabilistic filters | Conditional access + classifier verdicts | Stacked filters; no published treatment of inter-filter failure correlation | None |
| **Ghost-Ark** | Transactional control plane (ghost replica; ledger + semantic gates enforced; OCC gate specified, not yet runtime-enforced) | Decidable gates + independently replayable evidence, including refutation witnesses | Dependence-free Fréchet bounds at the gate; cohort-scoped correlation measurement via [CC-Framework](https://github.com/Cubits11/cc-framework) | Runnable: Löbian countermodels (GL decision procedure) + Chaitin one-sided comprehension budget |

Statuses in the Ghost-Ark row are the manuscript's own labels (implemented /
TLC-checked / specified) and inherit its non-claims (docs/paper/main.tex §
Limitations).

## 3. Positioning against each class

### A. ATF (the governance rubric)

ATF's Behavior element requires that security events be logged and anomalies
alert within 60 seconds; it does not require signing, tamper-evidence,
independent verification, replay protection, or enforcement (blocking) —
detection suffices for conformance. Ghost-Ark is therefore not a competitor
but a candidate *evidence and enforcement substrate* for ATF's upper maturity
tiers: where ATF prescribes segmentation and incident response, this
repository implements fail-closed admission, speculative collapse (effects do
not exist until commit), and abort receipts minted at refusal time. ATF's
promotion gates ("zero critical incidents", sign-offs) are attestations as
specified; receipts make the underlying record independently checkable —
trust that is earned needs trustworthy records of the earning.

### B. VERA and the receipt cluster

These systems authenticate *what an agent did*, and some do so with stronger
cryptography than this repository ships (ML-DSA-65 post-quantum signatures;
we run Ed25519/KMS and a dev-only HMAC in research modules). What their public
documentation does not address is what a signature cannot: whether the
evaluator that approved the action was in a position to evaluate it at all,
and how the record layer behaves when it cannot decide. Ghost-Ark's additions
at exactly that seam: the comprehension gate refuses payloads it cannot
certify simple (`EVALUATION_UNDECIDABLE`, one-sided by construction, with the
one-sided error itself measured and committed — a ~306-byte generator whose
stream certifies no lower than 4100 bytes), and the licensing engine records
Kripke countermodel witnesses when a proof obligation is refuted
(`LICENSE_REFUTED`). A receipt here can carry *evidence of undecidability and
refutation*, not only evidence of execution.

### C. Enterprise guardrail stacks

Stacked probabilistic filters compose; their published guidance does not
treat the failure correlation between layers, and an independence assumption
is the optimistic default. The frontier-lab adaptive-attack results (defenses
reported near 0% attack success later bypassed at >90%) indicate the
correlated regime is the operative one. Ghost-Ark's semantic gate triggers on
the Fréchet upper bound — the unique dependence-free envelope — and the
CC-Framework provides the measurement side: cohort-scoped co-failure tables,
phi correlation, and Fréchet intervals over observed guardrail behavior, with
its own stated non-claims. We bound what composition can hide, and measure
what it did.

## 4. The defensible contributions

1. **A runnable impossibility spine.** Same-strength proof-based licensing is
   refuted with committed countermodels (naive soundness `□φ→φ`, consistency
   `¬□⊥`), Löb self-trust is certified as provability-only, and evaluator
   comprehension is bounded one-sidedly with the error measured
   (docs/research/LOBIAN_BOUNDARY.md; packages/research-frontier/src/lobian,
   /chaitin; recorded demos committed). This is the *why* of the entire
   receipt category, in executable form.
2. **Correlated-failure treatment with honest semantics.** Dependence-free
   Fréchet bounding at the enforcement gate; partial-identification
   measurement in CC-Framework. No independence assumption anywhere on the
   claim path.
3. **Mechanically enforced non-claims.** A claim-language scanner gates the
   repository's own documentation — including the manuscript and this file —
   and the reproduction pipeline publishes its own failures. In a category
   whose branding runs ahead of its evidence, the refusal is the credential.

## 5. Honest gaps (what the prior art has that we do not)

- **Cryptography:** no post-quantum signatures (VERA ships ML-DSA-65);
  research receipts use dev-only HMAC, annotated SYNTH_ONLY.
- **Identity and scale:** no directory-scale identity lifecycle (Entra Agent
  ID class), no conditional-access analogue; the intended posture is to
  consume such identity planes, not rebuild them.
- **Adoption:** ATF has CSA stewardship and independent implementations;
  Microsoft has enterprise distribution; this repository is a single-author
  research artifact with recorded evidence and no deployments.
- **Runtime completeness:** the OCC gate is specified with a tested receipt
  schema but not enforced at runtime; live-cloud evidence is absent by
  declared boundary.
