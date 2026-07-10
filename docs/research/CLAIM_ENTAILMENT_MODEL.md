# Claim Entailment Model

## Status

Research doctrine with an executable checker. This document describes a decidable way
to detect overclaiming. It is not a semantic-truth oracle and does not establish that
any claim is true — only that a claim does not assert a higher assurance rung than its
bound evidence supports.

## One-sentence thesis

"Does the evidence entail the claim?" becomes decidable when a claim is structured as
an assurance-level assertion bound to cryptographically-pinned artifacts, reducing
entailment to an integer comparison rather than natural-language inference.

## The gap the lexical scanner leaves

`tools/research/check-forbidden-claims.mjs` enforces vocabulary: it blocks known
phrases. It cannot tell whether a sentence asserts more than its cited evidence
supports. A sentence that avoids the blocked phrases but still asserts far more than
the evidence carries passes untouched. Vocabulary is not the same as warranted
assertion.

## Why not natural-language entailment

The tempting upgrade is to check `E ⊨ C`, where `C` is a README sentence parsed into a
proposition and `E` is an evidence graph. Two problems make this the wrong gate:

- Sound provers operate on formal statements, not English prose; open-domain natural
  language entailment is not decidable in general.
- A model asked to judge entailment is unsound — it can be confidently wrong. Putting
  such a judge on the gate rebuilds the "trust the model" posture this project is
  built to reject. A non-reproducible oracle at the point of enforcement is the
  confidence-without-truth failure in a new place.

## The decidable reformulation

Structure the claim instead of trying to understand the sentence:

- A claim asserts an assurance level `L_c`, a rung on the Receipt Truth Ladder
  (0..10). See [[receipt-truth-ladder]].
- Each citation binds an artifact by `path` and expected `sha256`, and declares the
  level `L_a` that artifact supports.
- The claim is admissible iff, for every citation, the artifact exists and its bytes
  hash to the recorded digest, and `L_c <= min(L_a)` over the citations.

The digest binding is what makes this adversary-resistant: you cannot cite an artifact
and then quietly change it, because the recorded digest would no longer match. The
level comparison is what makes "the claim asserts more than its evidence" a decidable
integer test rather than a judgment call.

## Executable checker

`tools/claims/claimRegistry.mjs`

- `checkClaim` verifies existence, digest binding, and the level ceiling, and fails
  closed when a citation is missing, mutated, or malformed.
- `checkRegistry` runs a whole registry; the CLI exits non-zero on any inadmissible
  claim.
- `tools/claims/registry.sample.json` binds two claims to fixture artifacts.

Tests in `tests/unit/tools/test_claimRegistry.test.ts` show an admissible claim, an
overclaim rejected (asserted level exceeds supported), a cite-then-mutate rejected via
digest mismatch, a missing artifact failing closed, and the minimum-level rule across
multiple citations.

## How the two layers compose

The lexical scanner remains a cheap pre-filter over free prose. The claim registry is
the binding gate for assertions that carry an assurance level. The scanner catches
careless wording; the registry catches assertions that outrun their evidence. Neither
establishes semantic truth, and this document does not claim they do.

## Non-claims

- Admissibility means a claim's asserted assurance level does not exceed the minimum
  supported level of its cryptographically-bound citations. It does not establish that
  the claim is true, that the artifact is correct, or that the assigned support level
  is itself warranted.
- The support level of an artifact is a human-assigned input, and remains a review
  responsibility. The checker verifies the binding and the ceiling, not the judgment
  behind the assigned level.

## Open problems

- Deriving an artifact's support level from checkable properties rather than a human
  input.
- A registry entry that binds to a test result or a verifier report rather than a
  static file.
- Extending the ceiling check to composite claims that combine several sub-claims.

Related: [[temporal-trust-model]], [[witness-mechanism-design]].
