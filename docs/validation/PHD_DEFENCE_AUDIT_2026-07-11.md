# Ghost-Ark + CC-Framework — Hostile PhD-Defence Audit (2026-07-11)

**Reviewer stance:** distributed-systems + cryptography + PL-theory + AWS-security + formal-methods +
hostile publication referee. **Executable evidence is preferred over author intent.** Naming never implies a
property. Where evidence is insufficient the verdict is `UNVERIFIABLE`, `MISLABELED`, or `NOT IMPLEMENTED`.

Scope: `ghost-ark` (TS/AWS evidence + receipt control plane) and its sibling `cc-framework`
(`/Users/pranavbhave/Documents/GitHub/cc-framework`, Python measurement science). This supersedes and deepens
`docs/validation/ADVERSARIAL_CHECKLIST_AUDIT_2026-07-11.md` with proof obligations, severity, and **run**
exploits.

## Executable evidence run this session

| ID | What | Command | Result |
|---|---|---|---|
| T-neg | receipt negative corpus + taint + scanner + tenant + canonicalization | `npx vitest run …` | 75 passed |
| T-ledger | ledger-anchored revocation | `npx vitest run …test_ledgerAnchoredRevocation…` | 8 passed |
| T-chain | receipt hash chain | `npx vitest run …test_hash_chain…` | 4 passed |
| **E1** | **fabricated-ledger revocation bypass** | `tsx` against real `checkpoint.ts`+`ledgerAnchoredRevocation.ts` | **`verdict:true, standing:valid_pre_revocation` — bypass succeeded** |
| **E2** | **homoglyph taint bypass** | `tsx` against real `sanitizer.ts` | **`taint:[], matches:0` — injection undetected** |
| **E3** | **claim-scanner bypass** | `node` against real `check-forbidden-claims.mjs` | **allowlist-marker + line-split both → 0 violations** |
| C-fh | CC Fréchet special cases + monotone tightening | `pytest tests/unit/kernel/…` (cc `.venv`) | 7 passed |
| P1 | canonicalizer `__proto__`/`toString` | node probe | included as data, **no prototype pollution** |

---

## 1. Checklist results (strict schema)

Severity = impact **if the item's stated guarantee is relied upon in production**.
`VERIFIED` means code + passing local tests exercise the claim; it never means "AWS-live" or "safe".

### Item 1 — Non-malleable canonicalization
- **STATUS:** VERIFIED (bespoke) · **not** JCS/RFC 8785 (correctly never claimed).
- **CLAIM:** Prototype-pollution vectors are neutralized; post-sign mutation faults.
- **IMPLEMENTATION:** `assertPlainObject` prototype gate; `Object.entries`+`hasOwnProperty`; UTF-16 key sort; verifier recomputes digest+id.
- **FILES/LINES:** `packages/receipt-schema/src/hashCanonicalization.ts:17-24,44-138`; `packages/enforcement-runtime/src/receipts/verifier.ts:67-78,142-151`.
- **EXECUTABLE EVIDENCE:** P1 — `canonicalize(JSON.parse('{"a":1,"__proto__":{"x":9},"toString":"evil"}'))` → `{"__proto__":{"x":9},"a":1,"toString":"evil"}`, `Object.prototype.x===undefined`. T-neg (hashCanonicalization tests) passed.
- **ATTACK MODEL:** Adversary submits polymorphic JSON to shift digest between sign and verify.
- **COUNTEREXAMPLE:** none found; `JSON.parse` sets an *own* `__proto__` key (no setter), serialized deterministically.
- **PROOF OBLIGATION:** Formal statement that `canonicalize` is injective on the JSON-value quotient and total on the accepted domain (currently: tested, not proved).
- **MISSING ASSUMPTIONS:** number formatting equals JSON.stringify, not JCS; consumers must not expect JCS interop.
- **MINIMAL FIX:** state "not JCS" in the module doc (already implicit); add a property test for key-order stability under `Object.create(null)` inputs.
- **SEVERITY:** INFO.

### Item 2 — Cross-tenant KMS "AAD" collusion
- **STATUS:** MISLABELED (AAD does not exist for KMS Sign/Verify) → underlying control PARTIAL.
- **CLAIM:** Tenant+account bound into key-mediated AAD to block cross-tenant signature replay.
- **IMPLEMENTATION:** Tenant identity is inside the *signed payload* (`tenant_id_hash`); verifier pinned to one immutable key id; mutable alias rejected.
- **FILES/LINES:** `packages/enforcement-runtime/src/receipts/kmsVerifier.ts:28,38,52-97`; fixture `examples/malicious-receipts/receipts/MAL-014…`.
- **EXECUTABLE EVIDENCE:** T-neg (tenantBoundary + negative corpus incl. MAL-014) passed.
- **ATTACK MODEL:** Two tenants share one KMS root key; attacker replays tenant A's signature under tenant B.
- **COUNTEREXAMPLE:** If a deployment provisions a shared key, the crypto layer does **not** distinguish tenants — separation rests entirely on the app-layer tenant check + per-tenant key provisioning.
- **PROOF OBLIGATION:** Show the CDK provisions a distinct immutable key ARN per tenant, and that no verifier is ever constructed with a shared key. Not demonstrated.
- **MISSING ASSUMPTIONS:** key-per-tenant provisioning; verifier keyId pinned from config not receipt.
- **MINIMAL FIX:** bind `tenant_id_hash` into the verifier's required-field set (reject if the pinned tenant ≠ receipt tenant), so shared-key deployments still isolate.
- **SEVERITY:** MEDIUM.

### Item 3 — Multi-epoch ledger fork reconciliation
- **STATUS:** PARTIAL (local pure function) — **EXPLOITED**.
- **CLAIM:** Reconstruct prior epoch roots under replication/forks; reject fabricated indices; lock down tenant.
- **IMPLEMENTATION:** `enforceLedgerAnchoredRevocation` decides by ledger order over a **caller-supplied** `LedgerSequence`; monotonicity + inclusion-proof checks; fail-closed to `rejected_unprovable`.
- **FILES/LINES:** `packages/enforcement-runtime/src/receipts/ledgerAnchoredRevocation.ts:116-178,209-296`; not re-exported into any barrel (verified).
- **EXECUTABLE EVIDENCE:** **E1** — a revoked key with an attacker-built single-leaf Merkle tree and a fabricated 2-epoch sequence returns `verdict:true, standing:valid_pre_revocation`; T-ledger (8 tests) passes but never supplies a consistent fabricated sequence.
- **ATTACK MODEL:** Holder of a revoked key controls the `sequence`/`inclusionProof` inputs.
- **COUNTEREXAMPLE (E1, runnable):** `buildMerkleInclusionProof([leaf],leaf)` → root `R`; `epochs=[{index:0,root:R},{index:1,root:00…}]`, revocation at index 1 → accepted as pre-revocation.
- **PROOF OBLIGATION:** The `LedgerSequence` must be the output of an authenticated append-only log (signed checkpoints, witnessed). Absent that, the ordering argument is vacuous.
- **MISSING ASSUMPTIONS:** authenticated replicated ledger; signed epoch roots; fork model; tenant-scoped lockdown state.
- **MINIMAL FIX:** require each `LedgerEpochRef` to carry a witnessed `SignedEpochCheckpoint`, verify its signature + witness set before trusting `index`/`merkleRoot`; only then order.
- **SEVERITY:** HIGH (CRITICAL if ever wired into the live decision path).

### Item 4 — Anti-backdating TOCTOU vs streaming
- **STATUS:** NOT IMPLEMENTED (demand moot).
- **CLAIM:** A revocation at block N halts an in-flight Bedrock stream mid-token.
- **IMPLEMENTATION:** `governedInvoke` is non-streaming (`await modelInvoker.invoke`), and never calls the revocation function.
- **FILES/LINES:** `packages/enforcement-runtime/src/runtime/governedInvoke.ts:834-846`; revocation module unused (grep).
- **EXECUTABLE EVIDENCE:** absence — no streaming code path; T-chain/ledger tests never exercise a stream.
- **ATTACK MODEL:** N/A — no concurrent stream/revocation interaction exists.
- **COUNTEREXAMPLE:** N/A (nothing to break; nothing to rely on).
- **PROOF OBLIGATION:** would require a streaming invoker + a revocation check between chunks with a happens-before argument.
- **MISSING ASSUMPTIONS:** streaming inference; a live revocation feed.
- **MINIMAL FIX:** do not claim TOCTOU handling; if streaming is added, insert a per-chunk revocation gate.
- **SEVERITY:** HIGH as **claim inflation** (functionally N/A).

### Item 5 — Per-chunk Bedrock "sequence token" binding
- **STATUS:** NOT IMPLEMENTED · MISLABELED ("sequence token" is a CloudWatch Logs term).
- **CLAIM:** Each streamed chunk inherits the prior chunk digest and binds to `receiptId`.
- **IMPLEMENTATION:** `InvokeModelCommand` (non-streaming); one `rawOutputDigest` over the whole output; `chain.ts` is receipt-to-receipt.
- **FILES/LINES:** `packages/enforcement-runtime/src/bedrock/awsBedrockInvoker.ts:28-60`; `receipts/chain.ts:34-77`; dead IAM grant `infra/cdk/lib/api-stack.ts:225`.
- **EXECUTABLE EVIDENCE:** T-chain passes but asserts only receipt-level continuity.
- **ATTACK MODEL:** In-path proxy rewrites the middle of a decoded response.
- **COUNTEREXAMPLE:** single digest over final string ⇒ substitution undetectable; no per-chunk structure exists.
- **PROOF OBLIGATION:** streaming transcript with a hash chain rooted at `receiptId`.
- **MISSING ASSUMPTIONS:** streaming; chunk ordering metadata.
- **MINIMAL FIX:** remove the "sequence token" claim; if streamed, Merkle-chain chunks under `request_id`.
- **SEVERITY:** HIGH as claim inflation (functionally N/A).

### Item 6 — IAM PrincipalTag / malformed-JWT spoofing
- **STATUS:** PARTIAL.
- **CLAIM:** Client headers / malformed Cognito JWT cannot bypass `${aws:PrincipalTag/slug}`; mismatch fails closed pre-resource.
- **IMPLEMENTATION:** runtime rejects client-declared identity, enforces path==token tenant, zod-validates slug, fails closed; PrincipalTag lives in CDK IAM (synth); JWT signature verification is delegated to the API-GW authorizer (not in repo).
- **FILES/LINES:** `apps/api/src/lib/auth.ts:25-27,46-73`; `runtime/governedInvoke.ts:98-103,220`; `infra/cdk/lib/api-stack.ts`.
- **EXECUTABLE EVIDENCE:** T-neg (tenantBoundary, auth) passed.
- **ATTACK MODEL:** Forged/unsigned JWT claims, or PrincipalTag drift.
- **COUNTEREXAMPLE:** `auth.ts` trusts `requestContext.authorizer` — if the upstream authorizer is misconfigured to not verify signatures, arbitrary claims flow in; unverifiable in-repo.
- **PROOF OBLIGATION:** integration test with a real JWT authorizer rejecting a forged token; CDK assertion that PrincipalTag condition is attached to every tenant-scoped policy.
- **MISSING ASSUMPTIONS:** correctly-configured Cognito/Lambda authorizer verifying signatures.
- **MINIMAL FIX:** add a CDK assertion test for the PrincipalTag condition; document that JWT signature trust is upstream.
- **SEVERITY:** MEDIUM (HIGH if the authorizer is misconfigured).

### Item 7 — Toxic retrieval-taint escape
- **STATUS:** PARTIAL — **EXPLOITED** (detector), receipt-side MET.
- **CLAIM:** Deterministic boundary catches verbatim taint; no raw context leaks into the signed receipt.
- **IMPLEMENTATION:** receipt stores `retrievedContextDigests` only (met); ASCII denylist classifier; strict blocking opt-in.
- **FILES/LINES:** `retrieval/sanitizer.ts:27-45`; `runtime/governedInvoke.ts:567,189,625-681`.
- **EXECUTABLE EVIDENCE:** **E2** — homoglyph injection → `taint:[]`.
- **ATTACK MODEL:** Malicious retrieved doc with obfuscated instructions; or verbatim copy into output.
- **COUNTEREXAMPLE:** Cyrillic-homoglyph "ignore previous instructions" is not detected; no output-side verbatim-leak detector exists (arguably undecidable).
- **PROOF OBLIGATION:** verbatim-leak detection is undecidable in general; only digest-containment is provable.
- **MISSING ASSUMPTIONS:** callers enable strict mode; upstream normalizes Unicode.
- **MINIMAL FIX:** NFKC-normalize + confusable-fold before matching; relabel as best-effort heuristic.
- **SEVERITY:** MEDIUM.

### Item 8 — Single-witness split-view fraud proof
- **STATUS:** RESEARCH ONLY (correct, narrow).
- **CLAIM:** Detect a witness serving two roots; emit an offline fraud proof.
- **IMPLEMENTATION:** `detectSplitView` groups by `(log_id,witness_id,tree_size)`; verifies both signatures.
- **FILES/LINES:** `packages/research-frontier/src/witnessFraudProof.ts:105-191`.
- **EXECUTABLE EVIDENCE:** unit test present (`witnessFraudProof.test.ts`).
- **ATTACK MODEL:** Equivocating log.
- **COUNTEREXAMPLE (scope):** the checklist's "two distinct **tree sizes**" case is **explicitly out of scope** (`:29-30`); handled by consistency proofs, not here.
- **PROOF OBLIGATION:** liveness (someone holds both heads) + a witness key registry bound to identity.
- **MISSING ASSUMPTIONS:** log_id non-reuse; a live gossip layer.
- **MINIMAL FIX:** none for correctness; wire to a live witness feed to leave research status.
- **SEVERITY:** LOW.

### Item 9 — Evidence-staleness total order
- **STATUS:** VERIFIED (research) · "deadlock" is a category error (pure function).
- **CLAIM:** Deterministic, deadlock-free total-order downgrade lattice.
- **IMPLEMENTATION:** severity-rank join; total sort `(rank,kind,source,reason,ledgerIndex)`; ledger-position not wall-clock; `hasOwnProperty` guard.
- **FILES/LINES:** `packages/research-frontier/src/evidenceStaleness.ts:40-47,99-101,143-197`.
- **EXECUTABLE EVIDENCE:** `evidenceStaleness.test.ts` present (asserts non-claim, determinism).
- **ATTACK MODEL:** Out-of-order events reorder the standing.
- **COUNTEREXAMPLE:** none — sort is a total order; fold is order-independent.
- **PROOF OBLIGATION:** prove the sort key is a strict total order on the event type (currently tested).
- **MISSING ASSUMPTIONS:** callers supply ledger indices from an authenticated log.
- **MINIMAL FIX:** none.
- **SEVERITY:** INFO.

### Item 10 — Deterministic runtime isolation
- **STATUS:** PARTIAL · MISLABELED ("hypervisor" — there is none).
- **CLAIM:** Zero nondeterministic native features; variance ⇒ verifier fault.
- **IMPLEMENTATION:** no `Math.random` in the runtime; canonical/digest/policy paths deterministic; time injectable.
- **FILES/LINES:** `governedInvoke.ts:210`, `runtime/metrics.ts:49`, `bedrock/awsBedrockInvoker.ts:27,61` (`Date.now()`/`new Date()`); grep: no `Math.random`.
- **EXECUTABLE EVIDENCE:** grep output (no RNG); determinism of canonicalization in P1/T-neg.
- **ATTACK MODEL:** Nondeterministic evaluation yields divergent receipts for identical evidence.
- **COUNTEREXAMPLE:** `latency_ms` (from `Date.now()`) is nondeterministic and is a signed field; identical inputs → different receipts.
- **PROOF OBLIGATION:** a "no ambient nondeterminism in the signed-field closure" lint + a re-execution equality test.
- **MISSING ASSUMPTIONS:** callers inject `now`.
- **MINIMAL FIX:** exclude latency from the signed digest or bucket it; add a determinism replay test.
- **SEVERITY:** LOW.

### Item 11 — Tuple-key injection disruption
- **STATUS:** VERIFIED (research).
- **CLAIM:** Witness group keys immune to delimiter injection.
- **IMPLEMENTATION:** `JSON.stringify([log_id,witness_id,tree_size])`; parsed identity stored, never re-split.
- **FILES/LINES:** `witnessFraudProof.ts:151-166`.
- **EXECUTABLE EVIDENCE:** `witnessFraudProof.test.ts` / `witnessCheckpoint.test.ts`.
- **ATTACK MODEL:** `log_id` containing `","` collides identities.
- **COUNTEREXAMPLE:** none — JSON escaping makes the encoding injective; group stores components.
- **PROOF OBLIGATION:** injectivity of `JSON.stringify` array encoding on the identity tuple (holds).
- **MISSING ASSUMPTIONS:** none material.
- **MINIMAL FIX:** none.
- **SEVERITY:** INFO.

### Item 12 — Memory-exhaustion fail-closed
- **STATUS:** PARTIAL.
- **CLAIM:** OOM mid-redaction aborts and invalidates the pending receipt.
- **IMPLEMENTATION:** every failure branch → `failed_closed`; vault stores digests, not raw content.
- **FILES/LINES:** `governedInvoke.ts:968-1053`; `runtime/test_failClosed.test.ts`.
- **EXECUTABLE EVIDENCE:** `test_failClosed` (within suite).
- **ATTACK MODEL:** Lambda heap exhaustion during redaction.
- **COUNTEREXAMPLE:** a true `JavaScript heap out of memory` kills the process; it is not a catchable exception, so orderly fail-closed cannot be guaranteed under real OOM.
- **PROOF OBLIGATION:** OS/isolate-level guarantee (separate redaction process with a killed-child ⇒ no emit) — not present.
- **MISSING ASSUMPTIONS:** errors surface as rejections, not process death.
- **MINIMAL FIX:** state the OOM limitation; consider a memory-bounded child process for redaction.
- **SEVERITY:** MEDIUM.

### Item 13 — Differential encoded-string verification
- **STATUS:** VERIFIED (bounded corpus).
- **CLAIM:** Total behavioral equivalence across UTF-8/UTF-16 edge cases.
- **IMPLEMENTATION:** production ↔ independent-Node ↔ Python verifiers agree over a corpus incl. one Unicode case.
- **FILES/LINES:** `tests/differential/nodeIndependentVerifier.test.ts:221`, `pythonVerifierCorpus.test.ts:182`; `verifiers/{node,python}`.
- **EXECUTABLE EVIDENCE:** differential suites (present); T-neg canonicalization.
- **ATTACK MODEL:** UTF-16 surrogate / NFC-vs-NFD receipt causing verifier disagreement.
- **COUNTEREXAMPLE (latent):** no surrogate/astral/NFC-NFD case is tested; native JSON parsers do not normalize, so an NFC/NFD pair is a plausible untested divergence.
- **PROOF OBLIGATION:** enumerated corpus over surrogate/astral/normalization classes with cross-verifier equality.
- **MISSING ASSUMPTIONS:** inputs are already NFC.
- **MINIMAL FIX:** add surrogate/astral/NFC-NFD fixtures or document the normalization boundary.
- **SEVERITY:** LOW.

### Item 14 — S3 Object Lock teardown
- **STATUS:** SYNTH-ONLY.
- **CLAIM:** WORM active in dev; sandbox teardown still possible.
- **IMPLEMENTATION:** `objectLockEnabled:true`, `GOVERNANCE`, 365d; CDK template asserted.
- **FILES/LINES:** `infra/cdk/lib/api-stack.ts:93-94`; `services/ledger/lambda/publishReceiptCheckpoint/index.ts:37-81`; `infra/cdk/test/api-stack-governed-invoke.test.ts:46,55`.
- **EXECUTABLE EVIDENCE:** CDK assertion test (template-level).
- **ATTACK MODEL:** privileged deletion of "immutable" evidence.
- **COUNTEREXAMPLE:** GOVERNANCE allows `s3:BypassGovernanceRetention` ⇒ not true immutability; also no live-AWS proof Object Lock is active.
- **PROOF OBLIGATION:** live-AWS evidence that a PUT is retained and a delete is refused without bypass.
- **MISSING ASSUMPTIONS:** deployment does not grant bypass broadly.
- **MINIMAL FIX:** COMPLIANCE mode for the checkpoint bucket in prod stages; document GOVERNANCE for sandboxes.
- **SEVERITY:** MEDIUM.

### Item 15 — Lake Formation query-boundary escapes
- **STATUS:** SYNTH-ONLY / aspirational · UNVERIFIABLE in-repo.
- **CLAIM:** Row/column filters resist nested-JSON and window-function bypass.
- **IMPLEMENTATION:** static grants + tag taxonomy JSON only; enforcement is inside AWS.
- **FILES/LINES:** `services/governance/lakeformation/grants/example-tenant-grants.json`, `…/tag-taxonomy/core-tags.json`; no enforcement code, no test.
- **EXECUTABLE EVIDENCE:** none.
- **ATTACK MODEL:** tenant crafts an Athena query exploiting row-filter optimization.
- **COUNTEREXAMPLE:** cannot be demonstrated or refuted from this repo — the enforcement plane is not here.
- **PROOF OBLIGATION:** live Lake Formation + Athena red-team with cross-tenant row-filter probes.
- **MISSING ASSUMPTIONS:** Lake Formation enforces as configured (an AWS-behavior assumption the audit is told not to make).
- **MINIMAL FIX:** mark as AWS-live-only; add a live red-team harness.
- **SEVERITY:** HIGH (if relied on for tenant data isolation).

### Item 16 — "AST" phrase interception
- **STATUS:** PARTIAL · MISLABELED (regex line scan, not AST) — **EXPLOITED**.
- **CLAIM:** AST checker blocks unvouched assurance phrases in code/markdown/comments.
- **IMPLEMENTATION:** per-line regex + keyword-based allowance; fail-closed CI gate.
- **FILES/LINES:** `tools/research/check-forbidden-claims.mjs:77-249,346-367`.
- **EXECUTABLE EVIDENCE:** **E3** — `"…guarantees safe model behavior (this is not a formal proof)."` → 0 violations (the substring `not a` whitelists the line); `"production"+"\n"+"-ready…"` → 0 violations (line split).
- **ATTACK MODEL:** author (or a compromised doc) smuggles an overclaim past CI.
- **COUNTEREXAMPLE (E3, runnable):** two independent bypasses, both 0 violations.
- **PROOF OBLIGATION:** a real parser over a normalized token stream, with multi-line joins and concatenation folding.
- **MISSING ASSUMPTIONS:** overclaims appear intact on a single line without an allow marker.
- **MINIMAL FIX:** join wrapped lines; strip the per-line allow-marker escape or require the marker to negate the specific phrase; fold string concatenation in code.
- **SEVERITY:** MEDIUM.

### Item 17 — Loose type-coercion authorizer defense
- **STATUS:** VERIFIED.
- **CLAIM:** Strict comparisons; null/undefined status ⇒ hard FAIL.
- **IMPLEMENTATION:** `typeof===string`, `===`, `checks.every`; malformed envelope → `{}` → fail; default deny.
- **FILES/LINES:** `apps/api/src/lib/auth.ts:25-27,58-65`; `receipts/verifier.ts:43-49,163-190`.
- **EXECUTABLE EVIDENCE:** T-neg (26-fixture negative corpus) passed — all malicious receipts rejected.
- **ATTACK MODEL:** truthy-coercion or default-allow on an uninitialized status.
- **COUNTEREXAMPLE:** none found.
- **PROOF OBLIGATION:** exhaustive branch test that every non-`true` status denies (corpus approximates this).
- **MISSING ASSUMPTIONS:** none material.
- **MINIMAL FIX:** none.
- **SEVERITY:** INFO.

### Item 18 — Signature downgrade interception
- **STATUS:** VERIFIED (with a pin-by-config caveat).
- **CLAIM:** Reject fallback to dev HMAC / down-leveled suite before parsing payload.
- **IMPLEMENTATION:** algorithm pinned by injected verifier (readonly const); envelope-alg must match; immutable keyId; KMS response alg/keyId re-checked.
- **FILES/LINES:** `receipts/verifier.ts:82-98`; `receipts/kmsVerifier.ts:28,52-97`; fixtures MAL-005/006/010.
- **EXECUTABLE EVIDENCE:** T-neg negative corpus passed (alias/alg-mismatch/base64 rejected).
- **ATTACK MODEL:** attacker sets `signature_alg` to dev HMAC to force weaker verification.
- **COUNTEREXAMPLE:** only if an integrator selects the verifier *from the receipt's* `signature_alg` — then downgrade returns. In-repo the verifier is config-pinned.
- **PROOF OBLIGATION:** a test asserting verifier selection never derives from the receipt.
- **MISSING ASSUMPTIONS:** deployment pins KMS verifier; `LOCAL_HMAC_*_DEV_ONLY` never accepted in AWS.
- **MINIMAL FIX:** add the selection-invariant test.
- **SEVERITY:** INFO (LOW if integrators pick verifier by receipt).

### Item 19 — Human-review lineage (SQS/Kinesis, NO_EVIDENCE)
- **STATUS:** RESEARCH ONLY · NOT as written.
- **CLAIM:** Bind review artifacts to an immutable SQS/Kinesis sequence; flag `NO_EVIDENCE` absent a live trace.
- **IMPLEMENTATION:** zod schema hash-chain over `audit_` string ids + receipt carry-forward.
- **FILES/LINES:** `packages/research-frontier/src/humanReview.ts:38-44,376,414`; not re-exported.
- **EXECUTABLE EVIDENCE:** `humanReview.test.ts`.
- **ATTACK MODEL:** forge a review lineage.
- **COUNTEREXAMPLE:** `event_id` is a regex-validated string (`/^audit_…/`) — synthetic and forgeable; no sequence number; no `NO_EVIDENCE` state.
- **PROOF OBLIGATION:** bind to an AWS message sequence (SQS `SequenceNumber`/Kinesis) verified against a live trace.
- **MISSING ASSUMPTIONS:** a live queue exists.
- **MINIMAL FIX:** add a required `cloud_sequence` field validated against a trace, and emit `NO_EVIDENCE` when absent.
- **SEVERITY:** MEDIUM.

### Item 20 — Level-ceiling claim aggregation
- **STATUS:** VERIFIED (tool) · PARTIAL (wiring).
- **CLAIM:** Deployment-level claim without a `LIVE_OBSERVED` link breaks CI.
- **IMPLEMENTATION:** `claimRegistry.mjs` enforces `L_c ≤ min(L_a)` with sha256-bound artifacts + path containment; honest about lying-author limit.
- **FILES/LINES:** `tools/claims/claimRegistry.mjs:38-128`.
- **EXECUTABLE EVIDENCE:** runs against `registry.sample.json` via `claims:registry`.
- **ATTACK MODEL:** aggregate local metrics into an enterprise-readiness claim.
- **COUNTEREXAMPLE:** only **registered** claims are level-checked, and the registry is **not** in `npm run validate`; unregistered prose is caught only by the (bypassable) lexical scanner (item 16).
- **PROOF OBLIGATION:** every public deployment claim is registered and gated.
- **MISSING ASSUMPTIONS:** authors register their claims honestly.
- **MINIMAL FIX:** add `claims:registry` to `validate`; register README/product claims.
- **SEVERITY:** MEDIUM.

### Item 21 — Adversarial-Unicode smuggling redaction
- **STATUS:** NOT IMPLEMENTED — **EXPLOITED**.
- **CLAIM:** Strip zero-width/tag/homoglyph content; fail closed on un-tokenizable input.
- **IMPLEMENTATION:** classifier only tags; strips nothing; no fail-closed on un-tokenizable input.
- **FILES/LINES:** `retrieval/sanitizer.ts:27-63`.
- **EXECUTABLE EVIDENCE:** **E2** — homoglyph payload → `taint:[]`.
- **ATTACK MODEL:** hidden instructions via confusables / zero-width intra-token.
- **COUNTEREXAMPLE (E2):** Cyrillic homoglyphs pass through unredacted and undetected.
- **PROOF OBLIGATION:** NFKC + confusable-fold + zero-width strip, with a fail-closed on residual undecodable bytes.
- **MISSING ASSUMPTIONS:** upstream normalization.
- **MINIMAL FIX:** normalize+fold before matching; redact stripped ranges; relabel as heuristic.
- **SEVERITY:** MEDIUM.

### Item 22 — Witness Sybil resiliency (IAM-role-bound)
- **STATUS:** RESEARCH ONLY · NOT MET.
- **CLAIM:** Every witness signature traces to a registered active IAM execution role.
- **IMPLEMENTATION:** witness verified against a supplied key manifest (`public_key_pem`) — no IAM binding.
- **FILES/LINES:** `witnessFraudProof.ts:83-98`; `witnessCheckpoint.ts`.
- **EXECUTABLE EVIDENCE:** `witnessCheckpoint.test.ts`.
- **ATTACK MODEL:** Sybil witnesses over a long archive window.
- **COUNTEREXAMPLE:** an attacker whose key is in the manifest is a valid witness; nothing ties keys to IAM roles or an authorized infra block.
- **PROOF OBLIGATION:** a signed witness registry bound to IAM role ARNs, refreshed from a live source.
- **MISSING ASSUMPTIONS:** trusted manifest distribution.
- **MINIMAL FIX:** bind manifest entries to IAM role ARNs + an attestation of active status.
- **SEVERITY:** MEDIUM.

### Item 23 — Observatory alert-saturation defense
- **STATUS:** SYNTH-ONLY · NOT MET.
- **CLAIM:** Independent rate-limit so spam cannot saturate the panic loop or hide real failures.
- **IMPLEMENTATION:** two threshold-1 CloudWatch alarms → one SNS topic; no rate limit.
- **FILES/LINES:** `infra/cdk/lib/observatory-stack.ts:14-44`.
- **EXECUTABLE EVIDENCE:** CDK source (synth).
- **ATTACK MODEL:** flood invalid invocations to bury a real receipt gap.
- **COUNTEREXAMPLE:** error-spam latches `ReceiptGapAlarm` in ALARM; a subsequent real gap produces no new signal (state-based dedup ≠ rate limiting) — the exact masking the item forbids.
- **PROOF OBLIGATION:** independent high-severity channel + anomaly/M-of-N alarm with a masking test.
- **MISSING ASSUMPTIONS:** operators watch state transitions, not counts.
- **MINIMAL FIX:** add a separate sev-1 topic + composite/anomaly alarm decoupled from volume.
- **SEVERITY:** MEDIUM.

### Item 24 — Static evidence path containment
- **STATUS:** VERIFIED.
- **CLAIM:** Block absolute paths / `../` / symlink escapes; reproducible relative roots.
- **IMPLEMENTATION:** `resolve` + `absolute===root || startsWith(root+sep)`; symlink + non-file rejected.
- **FILES/LINES:** `tools/claims/claimRegistry.mjs:68-91`; `check-forbidden-claims.mjs:386-388`.
- **EXECUTABLE EVIDENCE:** `checkForbiddenClaims.test.ts` (within T-neg family).
- **ATTACK MODEL:** cite `../../etc/…` or a symlink to escape the tree.
- **COUNTEREXAMPLE:** none — `sep` guard avoids the sibling-prefix bug; symlinks refused.
- **PROOF OBLIGATION:** none material.
- **MISSING ASSUMPTIONS:** none.
- **MINIMAL FIX:** none.
- **SEVERITY:** INFO.

### Item 25 — Executable "entropy boundary" non-claim
- **STATUS:** MISLABELED (no entropy quantity) · spirit VERIFIED.
- **CLAIM:** PASS ⇒ no entropy decrease; document inability to deduce factual correctness.
- **IMPLEMENTATION:** no entropy computed; but every verifier PASS report **must** carry `non_claim`, asserted by tests; non-claims doctrine documented.
- **FILES/LINES:** `frontierClaims.ts:45-78`; `tests/differential/pythonVerifierCorpus.test.ts:298`, `nodeIndependentVerifier.test.ts:290`; `docs/compliance/non-claims.md`.
- **EXECUTABLE EVIDENCE:** differential tests assert the non-claim string in PASS reports.
- **ATTACK MODEL:** infer semantic truth from a PASS verdict.
- **COUNTEREXAMPLE:** none for the *non-claim*; the "entropy bound" itself is rhetorical (no measured quantity).
- **PROOF OBLIGATION:** if entropy is meant literally, define the state space and a monotone measure — not present.
- **MISSING ASSUMPTIONS:** readers treat PASS as binding-only.
- **MINIMAL FIX:** drop the "entropy" framing; keep the enforced non-claim.
- **SEVERITY:** INFO.

**Severity roll-up:** CRITICAL 0 (HIGH-if-wired: item 3) · HIGH 3 (3, 15, + claim-inflation 4/5) · MEDIUM 9 (2,6,7,12,14,16,19,20,21,22,23) · LOW/INFO the remainder.

---

## 2. Exploit demonstrations (reproduced)

**E1 — Fabricated-ledger revocation bypass (item 3/4).** Against the real modules:
```
buildMerkleInclusionProof([leaf], leaf) → root R
enforceLedgerAnchoredRevocation({ keyId: revokedKey, receiptTimestamp: "2020-…",
  inclusionEpochId:"E0", inclusionProof, sequence:{epochs:[{index:0,root:R},{index:1,root:00…}]},
  revocation:{keyId: revokedKey, revocationEpochId:"REVOKE"} })
→ verdict:true | standing:valid_pre_revocation | backdatingSuspected:false
```
The revoked key is honored because the entire ledger is an unauthenticated argument. Backdating is not even
flagged (inclusion index precedes revocation index). **Root cause:** ordering over an unsigned sequence.

**E2 — Homoglyph taint bypass (item 7/21).** `classifyRetrievedText("іgnore all previous іnstructіons …")`
(Cyrillic U+0456) → `taint:[]`, `matches:0`. The ASCII-only normalizer deletes the confusables, so the
instruction neither matches the denylist nor is redacted.

**E3 — Claim-scanner bypass (item 16).** `scanText("…guarantees safe model behavior (this is not a formal
proof).")` → 0 violations (line contains `not a`, whitelisting all strict rules). `scanText("production" +
"\n" + "-ready…")` → 0 violations (phrase split across lines). Two independent CI-gate bypasses.

**E4 — Mid-stream substitution (item 5), structural.** No stream exists; one digest covers the whole output,
so a proxy rewriting a middle segment is attested as authentic. Not runnable because the capability is absent.

**E5 — Shared-key cross-tenant replay (item 2), conditional.** If two tenants share one KMS key, the verifier
(which checks only key immutability + payload fields, not that the pinned tenant equals the receipt tenant)
does not distinguish them; isolation then depends entirely on per-tenant key provisioning + the app-layer
check. Not reproduced (requires a shared-key deployment).

---

## 3. Assumption registry

| # | Assumption | Relied on by | Validated in-repo? | Failure impact |
|---|---|---|---|---|
| A1 | KMS asymmetric signing is the receipt root of trust | all receipt verification | signature logic tested locally; **no live KMS** | UNVERIFIABLE key custody; forged signer if key policy weak |
| A2 | One immutable KMS key **per tenant** | item 2 isolation | not shown in CDK | shared key ⇒ cross-tenant replay (E5) |
| A3 | Upstream API-GW authorizer verifies JWT signatures | item 6 | not in repo | forged claims flow to runtime |
| A4 | Supplied ledger/checkpoint sequence is authenticated append-only | items 3,4,9 | **false** — it is an argument | E1 revocation bypass |
| A5 | Witness key manifest is trustworthy + IAM-bound | items 8,22 | not bound to IAM | Sybil witnesses |
| A6 | Lake Formation enforces grants/row-filters as configured | item 15 | not in repo (AWS behavior) | tenant data disclosure |
| A7 | Discretization rule (score→binary) is calibrated/correct | CC bridge, all CC bounds | recorded, **not validated** | FH bounds centered on wrong marginals |
| A8 | Copula/stationarity holds over the cohort | CC bridge, cliff | **declared, not tested** | dependence estimates invalid |
| A9 | Sampling is iid, query fixed before sampling, no adaptive post-selection | CC T6 outer CI | assumption of the theorem | CI coverage lost |
| A10 | Object Lock is active and bypass not broadly granted | item 14 | template-only | evidence deletable |
| A11 | `now`/latency injected; no ambient nondeterminism in signed fields | item 10 | partially false (`latency_ms`) | non-reproducible receipts |

---

## 4. Research-vs-production boundary map

| Subsystem | Ghost-Ark | CC-Framework | Layer |
|---|---|---|---|
| Canonicalization / receipt digest | `hashCanonicalization.ts`, `receipts/canonical.ts` | `reporting/canonical.py` | **LOCAL, verified** |
| Signature verify (HMAC dev / KMS) | `verifier.ts`, `kmsVerifier.ts` | — | LOCAL verified; KMS UNVERIFIABLE live |
| Differential independent verifier | `verifiers/{node,python}` | — | LOCAL verified (bounded corpus) |
| Claim entailment / lexical scan | `claimRegistry.mjs`, `check-forbidden-claims.mjs` | `evidence/claim_governance.py`, `claim_envelope.py` | LOCAL; scanner bypassable |
| Partial-identification LP / Fréchet bounds | `ccCorrelation.ts` (m=2 closed form only) | `kernel/sensitivity.py`, `frechet_classes.py` | **CC: proved+witnessed; Ghost: weaker subset** |
| Correlation cliff / tail dependence | — | `kernel/cliff.py` (copula fits, bootstrap CIs) | **RESEARCH (estimation, not a ledger theorem)** |
| Finite-sample outer CI | Wilson on marginals/joint only | `kernel/sample_complexity.py` (T6) | CC: documented + smoke-tested; Ghost: plug-in only |
| Merkle/transparency log, witnesses | `research-frontier/*` (not wired) | `evidence/merkle_log.py`, `anchoring.py` | RESEARCH both sides |
| Ledger-anchored revocation | `ledgerAnchoredRevocation.ts` (unsound on unsigned input) | — | RESEARCH, EXPLOITED |
| Runtime governed invoke | `runtime/governedInvoke.ts` | `core/audit_runner.py`, adapters | LOCAL; non-streaming |
| IAM / API-GW / PrincipalTag | `infra/cdk` | `infra/` (own CDK) | SYNTH-only both |
| Object Lock / Lake Formation | `api-stack.ts`, `services/governance/*` | — | SYNTH / AWS-live-unverifiable |
| Observatory / alarms | `observatory-stack.ts` | dashboards | SYNTH-only |

---

## 5. Claim-inflation analysis

1. **Checklist self-mislabels (6):** "KMS AAD" (Sign/Verify has none), "sequence token" (CloudWatch term),
   "hypervisor isolation" (no hypervisor), "AST" (regex line scan — E3 bypassed), "deadlock" (pure function),
   "entropy bound" (no measured quantity). Accepting any would itself inflate.
2. **Research primitives read as controls.** Items 3, 8, 9, 11, 19, 22 are in `research-frontier` and **not
   re-exported into any runtime barrel** (verified). Item 3's primitive is additionally *unsound* on the
   inputs it accepts (E1). Presenting these as production controls is the primary inflation risk.
3. **Fréchet-bounds inflation across the seam.** Ghost-Ark's `ccCorrelation.ts` computes only the **m=2
   closed-form** FH bound from **point** marginals + Wilson CIs on individual proportions. It is **not** the
   CC kernel's LP identification, witness distributions, or finite-sample **outer** CI (T6). Do not let
   "Ghost-Ark computes Fréchet bounds on correlated failure" imply CC's identification guarantees — Ghost's
   bounds are plug-in, not confidence bounds. (The module's own `interpretation`/`non_claims` are accurate;
   the risk is downstream summarization.)
4. **"Correlation cliff" as headline.** `cliff.py` is copula tail-dependence **estimation** (fit + bootstrap
   CI), absent from the proved `theorem_ledger.md`. It is a research phenomenon/instrument, not a theorem.
5. **AWS path.** Items 14/15/23 and live KMS are SYNTH-only or AWS-behavior assumptions; no live evidence.

---

## 6. Strongest verified guarantees

- **Deterministic canonical digest + tamper-evident verify** (item 1, P1, T-neg): prototype-safe, mutation
  changes the digest, three independent verifiers agree on the corpus (item 13).
- **Fail-closed signature verification with algorithm/key pinning** (items 17, 18; 26-fixture negative corpus
  passes): alias/alg-mismatch/base64/downgrade fixtures rejected; default path denies.
- **Reproducible claim-entailment level ceiling with sha256-bound artifacts + path containment** (items 20,
  24): cite-then-mutate resistant; honest about the lying-author limit.
- **CC-Framework partial-identification core (T1–T5)**: sharp LP bounds with **constructive witness
  distributions**, classical Fréchet recovery, monotone tightening — `pytest` green (C-fh). This is the
  publishable mathematical spine.
- **Symmetric epistemic non-claim across both repos** (Ghost item 25 / CC T7): "cryptographic consistency ⇒
  not statistical/semantic validity," test-enforced on the Ghost side.

## 7. Weakest guarantees

- **Ledger-anchored revocation is unsound on its accepted inputs** (item 3, E1) — HIGH.
- **Prompt-injection / Unicode defenses are an evadable ASCII denylist** (items 7, 21, E2) — MEDIUM.
- **Governance CI gate (claim scanner) is bypassable** (item 16, E3) — MEDIUM.
- **Alert saturation can mask real failures** (item 23) — MEDIUM.
- **AWS enforcement (Lake Formation, Object Lock immutability, PrincipalTag, live KMS) is unverifiable
  in-repo** (items 2, 6, 14, 15; A1, A6, A10) — MEDIUM/HIGH.
- **Human-review lineage is a chain of forgeable strings** (item 19) — MEDIUM.

## 8. Highest-leverage fixes (ranked)

1. **Authenticate the ledger sequence** (item 3): require witnessed `SignedEpochCheckpoint`s and verify before
   ordering. Kills E1. *Highest leverage — turns an unsound primitive into a sound one.*
2. **Bind tenant into the verifier** (item 2/E5): reject when the pinned tenant ≠ receipt `tenant_id_hash`, so
   shared-key deployments still isolate.
3. **Harden the claim gate** (item 16/E3): line-join + concatenation-fold + remove the per-line allow-marker
   escape; add `claims:registry` to `npm run validate` (item 20).
4. **Independent alert channel** (item 23): sev-1 topic + composite/anomaly alarm decoupled from volume, with
   a masking regression test.
5. **Normalize before matching** (items 7/21/E2): NFKC + confusable-fold + zero-width strip; relabel as
   best-effort; add a determinism replay test excluding `latency_ms` (item 10).
6. **State the boundaries** (items 4, 5, 14, 15): drop "TOCTOU/sequence-token/immutability" language; mark
   Lake Formation/Object Lock as AWS-live-only with a live red-team harness.

---

## 9. Cross-repo synthesis (overlap · divergence · shared assumptions · invalidation)

- **Overlap.** Both implement Merkle/transparency logs, claim envelopes/governance, assurance schemas,
  evidence anchoring, an explicit non-claims discipline, and their own AWS CDK. Both compute **Fréchet
  bounds** (CC via LP; Ghost via the m=2 closed form). Both assert the same epistemic boundary (integrity ≠
  validity: Ghost item 25, CC T7).
- **Divergence.** CC owns the **measurement science** (partial-identification LP, witness distributions,
  finite-sample outer CIs, copula tail-dependence, anytime-valid tooling). Ghost owns the **evidence/control
  plane** (signed receipts, KMS, tenant boundary, AWS infra). Ghost's `ccCorrelation.ts` is a **strict weaker
  subset** of CC's kernel — a reporting adapter, not the identification engine.
- **Shared assumptions (the joint risk surface).** A7 (discretization correctness), A8 (stationarity/copula),
  A9 (iid + pre-registered query). These are *statistical* assumptions neither repo validates — both only
  *record* them. The cryptographic layer cannot rescue a mis-calibrated binary variable.
- **Does one invalidate the other?** No direct contradiction. But the composition is only as strong as its
  weakest layer: a perfectly signed receipt (Ghost) over a mis-discretized guardrail score (A7) yields a
  cryptographically pristine, statistically meaningless CC bound. The seam contract (`ccCorrelation.ts`
  discretization receipt + `CC_GHOST_DISCRETIZATION_CONTRACT.md`) correctly *records* this dependency but
  cannot *discharge* it.

## 10. Publishability assessment (hostile referee)

- **Publishable now (with scoping):** CC-Framework's **partial-identification of composite guardrail-failure
  risk** — sharp LP bounds with constructive witnesses, classical Fréchet recovery, monotone tightening, and
  an honestly-caveated finite-sample outer CI. The `theorem_ledger.md` maps each claim to an
  implementation+test witness and grades proof status ("finite-dimensional convexity; computationally
  witnessed" vs "computational witness" vs "conceptual non-claim"). This is exactly the discipline a referee
  wants. **Referee attacks to pre-empt:** (a) T6 is a documented finite-dimensional argument that is only
  *smoke-tested* — a referee will demand a coverage simulation and a written proof, not a witness; (b) the
  "correlation cliff" headline is estimation, not theorem — separate the proved core from the phenomenon or a
  referee will conflate and reject; (c) all bounds inherit A7–A9, which must be foregrounded as the estimand's
  identifying assumptions.
- **Not yet publishable as security guarantees:** Ghost-Ark's AWS control-plane claims (items 2/6/14/15,
  live KMS) — no live evidence; and the revocation primitive (item 3) is unsound as written (E1). A
  systems-security venue would reject on E1 alone.
- **Publishable as an artifact/tools paper:** the **receipt + differential-verifier + claim-entailment**
  triad (items 1, 13, 18, 20, 24) is a clean, reproducible contribution *if* framed as "externally checkable
  evidence, not safety," and *if* the scanner bypass (E3) is fixed or disclosed as a known limitation.
- **Thesis framing that survives a committee:** "Verifiable *recording* and *bounded identification* of
  correlated guardrail failure, with an explicit integrity≠validity boundary" — strong. "Verifiable agent
  *governance* / *enforcement*" — overreaches given E1, E2, E3 and the AWS-live gaps.

## 11. Open problems (PhD-grade)

1. **Authenticated ordering under replication/forks.** Make Ghost's ledger-anchored revocation sound: a
   witnessed, gossip-checked append-only log with a formal split-view/rollback impossibility proof and a
   TOCTOU-free revocation-vs-execution happens-before. (Fixes E1; connects to CT/transparency theory.)
2. **Sound finite-sample identified regions.** Elevate CC's T6 from a smoke-tested argument to a proved,
   simulation-validated *outer confidence region* for LP-identified composite risk under adaptive/multiple
   queries (post-selection-valid partial identification). Port the *interval-propagated* bound back into
   Ghost's `ccCorrelation.ts` (replacing plug-in FH).
3. **Discretization as an identified nuisance.** Formalize A7: treat the score→binary rule and its calibration
   error as part of the estimand so the FH bounds account for threshold/calibration uncertainty rather than
   assuming it away.
4. **Adversarial semantics of prompt-injection detection.** Characterize the decidable core of "verbatim taint
   escape" and prove impossibility beyond it; design a normalization+provenance boundary with a formal evasion
   bound (generalizes E2 beyond homoglyphs).
5. **Copula-robust systemic-risk certificates.** Turn `cliff.py`'s tail-dependence estimates into
   distribution-free, anytime-valid "cliff certificates" with guaranteed coverage — moving the correlation
   cliff from phenomenon to theorem.
6. **Composable evidence semantics across integrity and validity layers.** A formal calculus in which a signed
   receipt (Ghost) and an identified bound (CC) compose to a *typed* assurance whose weakest-assumption is
   machine-derivable — so "cryptographically pristine, statistically meaningless" is a type error.

## Completion report
- **Files created:** `docs/validation/PHD_DEFENCE_AUDIT_2026-07-11.md`.
- **Files modified:** none (Ghost-Ark or CC-Framework).
- **Commands run:** vitest (75/8/4 passed), 3 executable exploits (E1/E2/E3 — all succeeded), CC kernel pytest
  (7 passed), node canonicalization probe. No AWS, no commit, no writes to cc-framework.
- **Security/claim impact:** none — read-only audit + additive doc. No canonicalization, signature, tenant,
  schema, or claim-boundary code changed.
- **Remaining gaps:** items 4,5,21,22 (not implemented / research vs the literal demand); 15,23 + live KMS
  (AWS-unverifiable); item 3 unsound-as-written (E1).
- **Next highest-leverage task:** authenticate the ledger sequence (fix #1) to eliminate E1.
