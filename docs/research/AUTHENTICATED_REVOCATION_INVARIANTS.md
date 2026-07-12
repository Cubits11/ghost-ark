# Authenticated Ledger-Anchored Revocation — Invariants

Status: RESEARCH (maturity). Not yet a production authority — see Assumptions.

Scope: this document specifies the theorem, attack model, invariants, and proof
obligations for `packages/research-frontier/src/authenticatedRevocation.ts`
(`enforceAuthenticatedLedgerRevocation`). It is the ordering-safe replacement for
`packages/enforcement-runtime/src/receipts/ledgerAnchoredRevocation.ts`, which is
retained only as a backdating detector and is explicitly non-authoritative.

## 1. Theorem statement

Let `L` be an append-only transparency log identified by `log_id`, with leaves
committed in append order. Let `i` be the leaf index of the receipt's chain-head
payload and `r` the leaf index of the canonical `key_revocation` record for the
signing key. `enforceAuthenticatedLedgerRevocation` returns
`standing = valid_pre_revocation` **only if** all of the following hold:

1. Both `i` and `r` are proven by Merkle inclusion against checkpoint roots that
   each carry ≥ `witnessQuorum` distinct valid witness signatures under a
   `WitnessKeyManifest` trust root supplied out-of-band (not read from the
   receipt).
2. The two checkpoints are bound into one append-only log by a verified Merkle
   consistency proof (the smaller checkpoint's root is a prefix of the larger's).
3. The revocation leaf's committed payload is exactly the canonical
   `key_revocation` record for the signing key.
4. `i < r`.

Ordering is therefore the authenticated relative position of two leaves in a
witness-signed log. It is never read from a caller-supplied `index` field.

## 2. Attack model

The adversary may:

- choose the receipt content, its self-reported `timestamp`, and the receipt's
  own signing key (possibly since-revoked);
- submit arbitrary checkpoints, inclusion proofs, and consistency proofs;
- observe all public log state and honest checkpoints.

The adversary may **not**:

- forge a witness signature over a root the witnesses did not sign
  (`A_WITNESS_KEY_MANIFEST_AUTHENTIC`, `A_SHA256_COLLISION_RESISTANCE`);
- cause an honest witness quorum to sign a split/equivocating view of the log
  (`A_WITNESS_QUORUM_HONEST` — the boundary of this module; see §7).

## 3. Formal invariant

INV-1 (authenticated roots). Every `root_hash` used in an accept decision is
covered by ≥ `witnessQuorum` distinct manifest-valid witness signatures.

INV-2 (authenticated positions). Every leaf index used in an accept decision is
bound to an authenticated root by a verified Merkle inclusion proof whose
`root_hash` equals the checkpoint root.

INV-3 (single append-only log). The inclusion and revocation checkpoints are the
same `log_id` and are related by a verified consistency proof.

INV-4 (typed revocation). The revocation leaf equals
`canonicalRevocationRecordPayload({type:"key_revocation", key_id})` for the key
under evaluation.

INV-5 (order = verdict). `verdict ⇔ (i < r)` under INV-1..INV-4; absent any of
them the result is a rejection, never a permissive pass (fail-closed).

INV-6 (timestamp non-influence). The self-reported timestamp affects only
`backdatingSuspected`; removing it never changes `verdict` or `standing`.

## 4. API redesign (invalid states unrepresentable)

- The decision consumes `WitnessCheckpoint` values (which carry
  `witness_signatures`) plus Merkle proofs — **not** a bare `LedgerEpochRef` with
  a caller-set `index`/`merkleRoot`. There is no field through which a caller can
  assert order directly.
- `trustRoot` and `witnessQuorum` are required parameters; there is no default
  that admits an unauthenticated checkpoint.
- Rejections are typed (`rejected_unauthenticated`, `rejected_unprovable`,
  `rejected_post_revocation`) so callers cannot collapse "not authenticated" into
  a soft pass.

## 5. Migration strategy

1. `ledgerAnchoredRevocation.ts` is marked `MATURITY = "RESEARCH"` and banner-
   documented as non-authoritative; its logic is unchanged for compatibility.
2. No production code path may call it for a trust decision (it currently has no
   production callers — the safe moment to lock this in).
3. Wiring revocation into a live decision path must use
   `enforceAuthenticatedLedgerRevocation` with a real witness trust root.
4. Phase IV `npm run assumptions` will treat any PRODUCTION module that
   transitively imports `ledgerAnchoredRevocation` for a decision as a build
   failure.

## 6. Proof obligations & executable validation

| Obligation | Where discharged |
|---|---|
| INV-5 (order = verdict), exhaustive over positions | `tests/unit/research-frontier/authenticatedRevocation.test.ts` — exhaustive `i,r` enumeration |
| E1 closure: fabricated checkpoints fail closed | same file — "witness OUTSIDE the trust root" ⇒ `rejected_unauthenticated` |
| INV-2: forged inclusion proof fails closed | same file — forged `leaf_index` ⇒ `rejected_unprovable` |
| INV-1: sub-quorum fails closed | same file — sub-quorum case |
| INV-3: cross-log / broken consistency fail closed | same file — different-log and non-extension cases |
| INV-4: wrong-key revocation record fails closed | same file — other-key record case |
| INV-6: timestamp non-influence | same file — with/without backdated timestamp |
| Phase II: gossiped fork ⇒ `rejected_equivocation` + verifiable proof | same file — "Phase II equivocation detection" |
| Old path weakness is real (justifies deprecation) | `tests/unit/enforcement-runtime/receipts/test_ledgerAnchoredRevocation.test.ts` — E1 characterization |

## 7. Undefended cases and impossibility boundary (honest limits)

- `A_WITNESS_QUORUM_HONEST` is now **partially enforced** (Phase II). The decision
  runs `detectSplitView` (`witnessFraudProof.ts`) over the two decision
  checkpoints plus an optional gossip pool (`observedCheckpoints`) and fails
  closed with `rejected_equivocation` — attaching an offline-verifiable
  `SplitViewFraudProof` — when a **single witness** signed two different roots for
  the same `(log_id, tree_size)`. This checks, rather than assumes, the honest
  property for the detectable case.
- Still undefended (residual `A_WITNESS_QUORUM_HONEST`): a split view co-signed by
  **different** witnesses across the two views (disjoint signer sets), and a fork
  at **different** tree sizes. Closing these needs cross-witness gossip
  reconciliation and a broader fork taxonomy — remaining Phase II work.
- It does not prove key custody, semantic correctness of the model output, or the
  authenticity of the trust-root manifest itself (delivered out-of-band).

## 8. Non-claim

Binds revocation to authenticated append-only ledger position under the
honest-witness-quorum assumption. Does not prove key custody, semantic
correctness, safety, or that the configured witness set is honest.
