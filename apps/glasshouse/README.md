# The Cryptographic Glasshouse (frontend)

Surfaces for auditing Ghost-Ark receipts where the browser re-derives the
verdict itself — "no unproven pixels." A green badge here is not a static
asset; it renders only when `crypto.subtle.verify` returns true on the
viewer's machine.

## Surface 2 — Adversarial Mutation Workbench (built)

- `lib/webReceiptVerifier.ts` — isomorphic, browser-native verifier for Ghost-Ark
  receipt **records** (canonical identity, digest binding, tenant/key expectation,
  RSA-PSS/`digest-as-message` signature). A faithful port of the record path in
  [`verifiers/node/ghost_receipt_verify.mjs`](../../verifiers/node/ghost_receipt_verify.mjs).
  Runs on the Web Crypto API, so the same source executes in the browser and in
  Node ≥ 18. **Not** WASM — the Node verifier is JavaScript, so readable,
  devtools-auditable source is both sufficient and more honest than an opaque
  binary. Canonicalization is Ghost-Ark canonical JSON, **not** RFC 8785.
- `lib/mutations.ts` — real corpus-mapped tampers (MAL-001…MAL-025 subset), each a
  pure transform the verifier must reject at a named step. Mutations requiring the
  signing private key to forge a valid-but-lying signature (e.g. MAL-016) are
  **not** synthesized here; they live in the server-side corpus test. Nothing is
  faked to appear caught.
- `MutationWorkbench.tsx` — framework-agnostic React component over the verifier.

### The pixel is earned, not asserted

[`tests/differential/webVerifierAgreement.test.ts`](../../tests/differential/webVerifierAgreement.test.ts)
exercises the exact engine the UI ships (Web Crypto runs in Node too): the real
sample receipt verifies end to end, every mutation fails closed at its expected
step, and the verifier fails closed with no public key. If that test fails, the
badge is unearned and must not render.

```bash
npx vitest run tests/differential/webVerifierAgreement.test.ts
```

A published, self-contained interactive build of this surface (embedding the
public sample receipt + key, running live Web Crypto) is generated from
`scratchpad/glasshouse.html`.

## Surface 2 (deepened) — decision receipts, chain, AST fuzzer

- `lib/decisionVerifier.ts` — decision-receipt (`grct_`) + chain engine, a port of
  `verifyDecisionReceipt` + `verifyDecisionReceiptChain`
  ([verifier.mjs](../../verifiers/node/ghost_receipt_verify.mjs),
  [chain.ts](../../packages/enforcement-runtime/src/receipts/chain.ts)). **Three
  signature modes → three honest verdicts:**
  - `LOCAL_HMAC_SHA256_DEV_ONLY` → verified via `subtle` HMAC with the published dev
    vector. **Dev-only, symmetric** — consistency under a shared key, not KMS custody.
    Never rendered as full "VERIFIED".
  - KMS RSASSA_PSS_SHA_256, `digest-as-message` → verifiable via `subtle` → **PASS**.
  - KMS `digest-as-mhash` (true AWS KMS DIGEST semantics) → **UNVERIFIABLE**, never
    PASS/FAIL. `crypto.subtle` always hashes the message, so it cannot check a
    pre-hashed signature; the Node verifier uses a raw RSA-PSS primitive this browser
    build does not ship. Reporting it either way would be the laundering this surface
    exists to prevent.
- Chain edges use the runtime's **actual** rule — `prev_receipt_hash ===
  sha256(canonical(signed parent))` (`signedDecisionReceiptHash`), empirically
  confirmed against the `hmac-baseline → hmac-chained` fixtures — plus tenant
  continuity, no-duplicate, and timestamp monotonicity. The user's proposed
  `prevReceiptHash ≡ SHA256(Canonical(V_i))` was **falsified** (that is the payload
  digest, a different preimage) and corrected here.
- CI: [`tests/differential/decisionVerifierAgreement.test.ts`](../../tests/differential/decisionVerifierAgreement.test.ts)
  (11/11) over the real reproducibility fixtures.

## KMS DIGEST mode — resolving UNVERIFIABLE with a BigInt engine

- `lib/emsaPssBigInt.ts` — a pure-`BigInt` RSA-PSS / EMSA-PSS-VERIFY (RFC 8017
  §9.1.2) over a **pre-computed digest**. Web Crypto's `subtle.verify` always
  hashes the message, so it verifies against `SHA-256(d)` and can never check a
  KMS DIGEST-mode signature (RSA-PSS over `d` directly). This engine does the RSA
  math itself (modular exponentiation + EMSA-PSS decode) with `mHash = d` — no
  double hash — turning the honest **UNVERIFIABLE** into a real **PROVED**.
  - Corrected a bug in the source spec: `emBits = modBits − 1` (RFC 8017), so the
    top **1** bit of `EM[0]` must be checked — the spec's `8*k − bitLength`
    yields 0 for a 2048-bit key and would wrongly accept malformed encodings.
  - CI: [`emsaPssBigIntAgreement.test.ts`](../../tests/differential/emsaPssBigIntAgreement.test.ts)
    (6/6) — verifies the real `kms-digest-mode` fixture, **agrees with OpenSSL**
    RSA-PSS-over-digest at 2048 and 3072 bits, and rejects flipped signature /
    digest / salt length. `decisionVerifier` now uses it for digest-as-mhash.

## Multi-node lineage DAG (`lib/lineageDagEngine.ts`)

- Every NODE carries a cryptographic verdict (`PROVED_HMAC_DEV` /
  `PROVED_KMS_MSG` / `PROVED_KMS_MHASH` / `INVALID_SIGNATURE` / `UNVERIFIABLE_MODE`)
  from the single-sourced decision verifier; every EDGE carries a causal verdict
  (`VERIFIED_LINK` / `BROKEN_LINK` / `TEMPORAL_ANOMALY` / `FORK_DETECTED` /
  `MISSING_PARENT` / `ROOT`) using the real signed-hash rule. A graph is valid
  only if every node is PROVED and every edge VERIFIED_LINK/ROOT.
- CI: [`lineageDagAgreement.test.ts`](../../tests/differential/lineageDagAgreement.test.ts)
  (10/10) over the real 2-node chain plus **genuinely dev-HMAC-signed** 3-node
  chains, forks, temporal anomalies, and orphans (nodes really PROVED, so an edge
  failure is isolated to the edge). Note: `prev_receipt_hash` is a signed field,
  so re-pointing it without re-signing breaks the node's own signature —
  tamper-evident at both the node and edge layers.

The published artifact has tabs for record receipts, an AST fuzzer (live
re-derivation on every keystroke), decision receipts (with the mhash node now
PROVED via the BigInt engine), and a real 3-node verified lineage DAG with a
break toggle.

## Scope / non-claims

A PASS proves internal receipt consistency (and, for chains, hash/tenant/time
continuity) under this verifier's rules. It does not prove model safety, semantic
truth, compliance, chain completeness, AWS execution, KMS custody, or runtime
integrity. HMAC verification is dev-only and symmetric. The Fréchet co-failure
radar (Surface 3) is **not built**; do not represent it as present.
