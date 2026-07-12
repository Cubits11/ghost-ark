# Adversarial Engineering Checklist — Ghost-Ark Audit (2026-07-11)

**Author:** evidence-grounded code review (read-only; no source, schema, signature, tenant-boundary, or
claim-boundary changes were made).

**Method.** Each of the 25 checklist items was evaluated against the actual code and tests, citing
`file:line`. Where cheap and decisive, the relevant test file was executed and the pass/fail recorded.
Two adversarial holes were reproduced with standalone probes. Nothing below is asserted "proven": this
document verifies *what is recorded, signed, policy-bounded, and replayable under Ghost-Ark verifier
rules* — not semantic safety, truth, compliance, alignment, or production readiness.

**Reproduced command evidence (this session):**

- `npx vitest run tests/security/receipt-negative-corpus.test.ts tests/unit/enforcement-runtime/retrieval/test_taintFilter.test.ts tests/unit/research-frontier/checkForbiddenClaims.test.ts tests/security/tenantBoundary.test.ts tests/unit/receipt-schema/hashCanonicalization.test.ts` → **5 files / 75 tests passed**.
- `npx vitest run tests/unit/enforcement-runtime/receipts/test_ledgerAnchoredRevocation.test.ts` → **8 passed**.
- `npx vitest run tests/unit/enforcement-runtime/receipts/test_hash_chain.test.ts` → **4 passed**.
- Homoglyph taint-bypass probe and `__proto__`/`toString` canonicalization probe (both reproduced below).

## Status taxonomy

| Code | Meaning |
|---|---|
| `IMPLEMENTED_LOCAL` | Real code + passing local tests; no AWS runtime dependency. |
| `RESEARCH_ONLY` | Correct as a modeled primitive in `packages/research-frontier`; **not re-exported into any runtime barrel/service** (verified) and not wired to live infra. |
| `SYNTH_ONLY` | Exists only as CDK/synth output or static config; a template assertion at most, never exercised at runtime. |
| `PARTIAL` | Some of the demand met; material gaps remain. |
| `NOT_IMPLEMENTED` | No corresponding code; the demand has no implementation surface. |

"Demand as written" is judged strictly against the checklist wording, which in several items contains
a **mislabel** (a term that maps to no real artifact — e.g. "KMS AAD" on Sign/Verify, "AST" for a regex
scan, "hypervisor isolation", "sequence token", "entropy bound", "deadlock"). Those are named explicitly.

## Scoreboard

| # | Item | Status | Demand as written |
|---|---|---|---|
| 1 | Non-malleable canonicalization (`__proto__`/`toString`, JCS) | `IMPLEMENTED_LOCAL` | **MET** (bespoke, *not* JCS/RFC 8785 — correctly never claimed) |
| 2 | Cross-tenant KMS "AAD" collusion | `PARTIAL` | **NOT as written** (KMS Sign/Verify has no AAD); tenant binding is in the signed payload + pinned key |
| 3 | Multi-epoch ledger fork reconciliation | `PARTIAL` (local) | **PARTIAL**; no replicated store, no fork reconciliation, roots trusted, no tenant lockdown |
| 4 | Anti-backdating TOCTOU vs streaming | `NOT_IMPLEMENTED` | **NOT MET**; runtime is non-streaming and never checks revocation |
| 5 | Per-chunk Bedrock "sequence token" binding | `NOT_IMPLEMENTED` | **NOT MET**; mislabel; single digest over whole output |
| 6 | IAM PrincipalTag / JWT spoofing defense | `PARTIAL` | **PARTIAL**; runtime fails closed; JWT signature + PrincipalTag are upstream/synth |
| 7 | Toxic retrieval-taint escape | `PARTIAL` | **PARTIAL**; receipts store digests (met); verbatim-leak/semantic detection not implemented |
| 8 | Single-witness split-view fraud proof | `RESEARCH_ONLY` | **MET for same-size equivocation**; the literal "two distinct tree sizes" case is out of scope |
| 9 | Evidence-staleness total order | `IMPLEMENTED_LOCAL` (research) | **MET**; "deadlock" is a category error (pure function) |
| 10 | Deterministic "hypervisor" runtime isolation | `PARTIAL` | **PARTIAL**; no `Math.random`, but `Date.now()`/`new Date()` used; "hypervisor" is a mislabel |
| 11 | Tuple-key injection disruption | `IMPLEMENTED_LOCAL` (research) | **MET**; `JSON.stringify([...])` keys are injection-safe by construction |
| 12 | Memory-exhaustion fail-closed | `PARTIAL` | **PARTIAL**; fails closed on thrown errors; true OOM is uncatchable in Node |
| 13 | Differential encoded-string verification | `IMPLEMENTED_LOCAL` | **MET (strong)** for the corpus incl. one Unicode case; no surrogate/astral/NFC-NFD coverage |
| 14 | S3 Object Lock teardown | `SYNTH_ONLY` | **SYNTH**; GOVERNANCE 365d (template-asserted); GOVERNANCE ≠ true immutability |
| 15 | Lake Formation query-boundary escapes | `SYNTH_ONLY` / aspirational | **NOT provable here**; grants + tags only; enforcement is in AWS |
| 16 | "AST" phrase interception in CI | `PARTIAL` | **PARTIAL**; a line-based **regex** scanner (not AST); real bypass vectors |
| 17 | Loose type-coercion authorizer defense | `IMPLEMENTED_LOCAL` | **MET**; strict comparisons, default-deny, fail-closed |
| 18 | Signature downgrade interception | `IMPLEMENTED_LOCAL` | **MET**; alg pinned by verifier, immutable keyId, alias/base64/alg fixtures rejected |
| 19 | Human-review lineage (SQS/Kinesis, `NO_EVIDENCE`) | `RESEARCH_ONLY` | **NOT as written**; hash-chain of forgeable `audit_` strings; no sequence #, no `NO_EVIDENCE` |
| 20 | Level-ceiling claim aggregation | `IMPLEMENTED_LOCAL` | **PARTIAL**; correct entailment check, but only over *registered* claims; not in main `validate` |
| 21 | Adversarial-Unicode smuggling redaction | `NOT_IMPLEMENTED` | **NOT MET**; classifier strips nothing; homoglyphs undetected (reproduced) |
| 22 | Witness Sybil resiliency (IAM-role-bound) | `RESEARCH_ONLY` | **NOT MET**; witnesses are key-manifest entries, not IAM-role-bound |
| 23 | Observatory alert-saturation defense | `SYNTH_ONLY` | **NOT MET**; two threshold-1 alarms → 1 SNS topic; no independent rate limit |
| 24 | Static evidence path containment | `IMPLEMENTED_LOCAL` | **MET**; `resolve` + `startsWith(root+sep)`, symlink/abs/`..` rejected |
| 25 | Executable "entropy boundary" non-claim | `PARTIAL` | **Spirit MET, literal NOT**; no entropy quantity; but PASS reports must carry a machine-asserted non-claim |

**Tally (demand as written):** MET 7 · PARTIAL 8 · SYNTH-only 3 · NOT-MET/NOT-IMPLEMENTED 7.
The strongest work is the deterministic receipt/verifier/claim-tooling core (items 1, 9, 11, 13, 17, 18,
24). The weakest are the items that presuppose infrastructure Ghost-Ark does not run at runtime
(streaming — 4/5; live Lake Formation — 15; SNS rate limiting — 23) or IAM-bound identity (22).

---

## I. Cryptographic & ledger anchoring

### 1 — Non-malleable canonicalization under polymorphic injection · `IMPLEMENTED_LOCAL` · MET (bespoke)

**What exists.** `packages/receipt-schema/src/hashCanonicalization.ts` is a bespoke deterministic JSON
serializer. `assertPlainObject` (`:17-24`) accepts a value only if its prototype is `Object.prototype`
or `null`; anything with a custom prototype falls through to the terminal throw (`:134`). It rejects
`undefined`, non-finite numbers, `bigint`, functions, symbols, sparse arrays, `Date`, `Buffer`,
typed-array views, `Map`, `Set` (`:44-118`). Keys are sorted by UTF-16 code unit (`:26-28,:129`) and
serialized with `JSON.stringify` on both key and value (`:131`). The verifier recomputes the digest and
`receipt_id` and compares (`receipts/verifier.ts:67-78,:142-151`), so any post-signing key/value mutation
faults the receipt.

**Reproduced.** `canonicalize(JSON.parse('{"a":1,"__proto__":{"x":9},"toString":"evil"}'))` →
`{"__proto__":{"x":9},"a":1,"toString":"evil"}`, and `Object.prototype.x` stays `undefined`. `JSON.parse`
creates *own* enumerable keys named `__proto__`/`toString` (it does not invoke setters), and the serializer
treats them as ordinary sorted data — no prototype pollution, and both keys are bound into the digest.

**Cannot claim.** Not RFC 8785 / JCS — number formatting and string escaping follow `JSON.stringify`, not
the JCS spec. The code correctly never claims JCS (searched). "Neutralize" here means *deterministically
bind*, not *strip*.

### 2 — Cross-tenant KMS context collusion · `PARTIAL` · NOT as written (mislabel: AAD)

**Mislabel.** KMS *asymmetric Sign/Verify* does not take Additional Authenticated Data — AAD exists only
for symmetric encrypt / `GenerateDataKey`. There is therefore no "key-mediated AAD" layer to embed a
`tenant_slug` in, and none exists (`receipts/kmsSigner.ts`, `kmsVerifier.ts`).

**What actually binds tenants.** (a) The tenant identity is inside the *signed canonical payload* as
`tenant_id_hash` (an HMAC digest; see receipt fixture `MAL-014.cross-tenant-verifier-mismatch`), so mutating
it breaks the signature. (b) `KmsDecisionReceiptVerifier` is constructed with one **immutable** key id
(`assertImmutableKmsKeyId`, `kmsVerifier.ts:38`) and rejects any receipt whose embedded keyId is a mutable
alias or mismatches (`:52-59,:87-97`). The intended deployment is one key per tenant.

**Gap / hole.** If two tenants are *deliberately configured to share one root key*, the crypto layer alone
does **not** distinguish them — separation then rests entirely on the app-layer tenant check
(`apps/api/src/lib/tenancy.ts`, `identity/context.ts`) and on the verifier being pinned to the right key.
`tests/security/tenantBoundary.test.ts` passes and `MAL-014` is rejected, but that exercises the pinned-key
path, not a shared-key collusion. **Cannot claim** cryptographic cross-tenant isolation independent of key
provisioning.

### 3 — Multi-epoch ledger fork reconciliation · `PARTIAL` (local) · PARTIAL

**What exists.** `receipts/ledgerAnchoredRevocation.ts` — a pure, synchronous function
`enforceLedgerAnchoredRevocation` (`:209-296`) that decides revocation by **ledger order**, not by the
signer-controlled timestamp. It validates an append-only sequence (`assertMonotonicLedgerSequence`,
`:116-178`: strictly increasing indices and seal-times, unique epochIds, `sha256:`-prefixed roots), verifies
a supplied Merkle inclusion proof against a supplied root (`:236`), enforces `inclusionIndex < revocationIndex`,
fails closed to `rejected_unprovable` on any missing/tampered input, and runs a positive-only backdating
detector that never changes the verdict (`:253-272`). Test: **8/8 passed**. The module carries an explicit
non-claim (`:28-31,:105-107`) and is **not re-exported** into any runtime barrel (verified).

**Gaps.** No replicated store (the "ledger" is an unsigned function argument); no fork reconciliation (a
divergent branch is *rejected as malformed*, not reconciled); roots are trusted inputs, never reconstructed
in production code; **no tenant lockdown** — `tenantId` is never read here.

**Concrete hole (from the salvaged evaluation, matches the code).** A holder of a revoked key builds their
own Merkle tree containing their leaf, computes a valid inclusion proof against that tree's root `R`, and
supplies `epochs = [{index:0, root:R, ...}, {index:1, root:sha256:00…, ...}]` with the revocation at index 1.
Monotonicity passes, the proof reconstructs `R`, `0 < 1` → `valid_pre_revocation`. A *consistent fabricated
sequence* is accepted because nothing binds `epoch.index`/`epoch.merkleRoot` to a real signed append-only log.

### 4 — Anti-backdating temporal race / TOCTOU vs streaming · `NOT_IMPLEMENTED` · NOT MET

**Why the demand is moot in the current design.** `runtime/governedInvoke.ts` is **not streaming**: it
`await`s a single `deps.modelInvoker.invoke(...)` returning one `outputText` (`:834-846`), then emits one
receipt. There is no token stream, hence no "mid-token" to halt. Moreover, `enforceLedgerAnchoredRevocation`
is an offline verifier function and is **never called** from `governedInvoke` — the runtime does a
pre-model policy check and an execution-nonce reservation (`:726-828`, replay protection), but performs no
revocation check at all. There is no TOCTOU window to close because there is no concurrent revocation/stream
interaction to begin with.

### 5 — Per-chunk Bedrock "sequence token" binding · `NOT_IMPLEMENTED` · NOT MET (mislabel)

**Mislabel.** "Sequence token" is a CloudWatch Logs `PutLogEvents` concept; Bedrock stream events carry no
such token. **No per-chunk chaining exists.** `bedrock/awsBedrockInvoker.ts:28-60` uses the non-streaming
`InvokeModelCommand`, extracts one `outputText`, and computes exactly one `rawOutputDigest =
publicSha256Digest(outputText)`. `receipts/chain.ts` is a **receipt-to-receipt** hash chain (one signed
receipt per invoke; `:34-77`), unrelated to output chunks. `api-stack.ts:225` grants
`bedrock:InvokeModelWithResponseStream` in IAM, but **no runtime code calls streaming** — dead synth config.
Test: `test_hash_chain.test.ts` **4/4 passed**, and asserts only receipt-level continuity.

**Concrete hole.** An in-path proxy rewriting the middle of a decoded response is undetectable: one digest is
taken over whatever final string was decoded, and `chain.ts` only links whole receipts. The emitted receipt
faithfully attests the tampered output as authentic.

### (I. summary)
The receipt/canonicalization/verifier crypto core is strong and honestly bounded; the *streaming* and
*live-ledger* demands (4, 5, and the replicated-store half of 3) have **no runtime surface** in Ghost-Ark
today.

---

## II. State, memory & isolation

### 6 — IAM PrincipalTag / malformed-JWT spoofing · `PARTIAL` · PARTIAL

**What exists (runtime).** `governedInvoke` calls `assertNoClientDeclaredIdentity(request.body, {recursive:true})`
(`:220`) to reject client-supplied identity, resolves identity from the authorizer context via
`resolveVerifiedIdentity`, and throws `AuthorizationError` if `identity.tenantId !== request.pathTenantId`
(`:98-103`) — path-vs-token binding, fail-closed. `apps/api/src/lib/auth.ts` extracts the tenant from the
authorizer JWT/authorizer context and `zod`-validates the slug (`tenantSlugSchema.safeParse`, `:62-65`);
missing tenant → `AuthorizationError`.

**Gap.** `auth.ts` **trusts** `requestContext.authorizer` — it does **not** verify a JWT signature; that is
delegated to the API Gateway Cognito/Lambda authorizer, which is not in this repo's runtime code. The
`${aws:PrincipalTag/slug}` enforcement lives in the CDK IAM policy (`infra/cdk/lib/api-stack.ts`), i.e.
**synth-only**. So the "malformed Cognito JWT" defense depends on a correctly-configured upstream authorizer;
in-repo we can prove the runtime rejects client-declared identity and enforces path/tenant consistency, not
that a forged JWT is rejected.

### 7 — Toxic retrieval-taint escape · `PARTIAL` · PARTIAL

**Met.** The signed receipt records only `retrievedContextDigests` (sorted SHA-256 hashes), never raw
context text (`governedInvoke.ts:567,:189`) — so raw retrieval memory does **not** leak into the receipt.
Cross-tenant retrieval is blocked (`:569-614`), and an *opt-in* strict mode escalates on
`retrieval_untrusted_instruction` (`:625-681`, gated by `strictRetrievalTaintBlockingEnabled`).

**Gaps.** (a) There is **no output-side verbatim-leak detector** — nothing checks whether the completion
reproduces tainted retrieval text (this is essentially undecidable and should not be claimed). (b) Taint
detection (`retrieval/sanitizer.ts`) is an **ASCII denylist** of ~14 English phrases matched after
`normalizeForMatching` strips all non-`[a-z0-9]`. It is trivially evaded (paraphrase, translation, homoglyph).
(c) Strict blocking is off unless `deps.retrievalOptions` enable it; the default passes tainted-but-tagged
context to the model. Test `test_taintFilter.test.ts` passes (within the 75) but only over the ASCII corpus.

### 8 — Single-witness split-view fraud proof · `RESEARCH_ONLY` · MET (same-size) / out-of-scope (diff-size)

**What exists.** `research-frontier/src/witnessFraudProof.ts` — `detectSplitView` groups checkpoints by
`(log_id, witness_id, tree_size)` and, when a witness has two validly-signed heads with **different roots at
the same tree_size**, emits an offline-verifiable fraud proof; `verifySplitViewFraudProof` (`:105-133`) checks
schema, same-log, same-size, roots-differ, and both signatures under the witness key manifest. Correct and
honestly scoped.

**Against the literal demand.** The checklist says "two distinct **tree sizes** to the same witness." That is
**explicitly out of scope** here (`:29-30`: a fork at different tree sizes surfaces as a broken *consistency*
proof, handled by `witnessCheckpoint.ts`, not by this equivocation proof). `RESEARCH_ONLY`: not wired to a
live log; not re-exported into a runtime barrel (verified).

### 9 — Evidence-staleness total order · `IMPLEMENTED_LOCAL` (research) · MET

**What exists.** `research-frontier/src/evidenceStaleness.ts` — a monotone downgrade lattice with a strict
severity rank (`:40-47`). Events are sorted by a **total order** (rank, kind, source, reason, ledgerIndex;
`:163-170`) so the whole applied-downgrade trail — not just the final standing — is deterministic. Freshness
is measured in **ledger-epoch lag, never wall-clock** (`:119-141`), so the verdict does not drift with the
reader's clock. A `hasOwnProperty` guard (`:146`) is used *specifically* to avoid a prototype-chain
(`toString`/`__proto__`) fail-open. Bad input throws (fail-closed). Test `evidenceStaleness.test.ts` present
and asserts the non-claim.

**Mislabel.** "Deadlock-free" is trivially true and a category error — this is a pure linear fold with no
locks, threads, or concurrency primitives. There is no deadlock to resolve.

### 10 — Deterministic runtime isolation · `PARTIAL` · PARTIAL (mislabel: hypervisor)

**Positive.** `grep` finds **no `Math.random`** anywhere in `packages/enforcement-runtime/src` (only
`Math.max`/`Math.abs`). The canonicalization, digest, policy-evaluation, and execution-context-hash paths are
deterministic given fixed inputs, and time is *injectable* (`request.now`).

**Gaps.** The runtime is **not** globally deterministic: `governedInvoke.ts:210` uses `new Date()` as a
fallback, `runtime/metrics.ts:49` and `bedrock/awsBedrockInvoker.ts:27,61` use `Date.now()`, and vault stores
use `new Date()` fallbacks. `latency_ms` (nondeterministic) is a signed receipt field. There is **no
"verifier throws an execution fault on variance"** mechanism as the item demands. **Mislabel:** there is no
hypervisor — this is a Node/Lambda process; "hypervisor runtime isolation" maps to nothing.

---

## III. Injection & attack surface

### 11 — Tuple-key injection disruption · `IMPLEMENTED_LOCAL` (research) · MET

`witnessFraudProof.ts:151-166` builds group keys as `JSON.stringify([log_id, witness_id, tree_size])`. This is
injection-safe: any delimiter inside a component (`"`, `,`, `]`) is JSON-escaped, so two different identity
tuples cannot collide into one key. Critically, the parsed identity is stored in the `WitnessGroup` and
**never re-parsed out of the delimited string** (`:158-163`), so there is no string-splitting step to attack.
`witnessCheckpoint.ts`/`merkle.ts` follow the same discipline.

### 12 — Memory-exhaustion fail-closed · `PARTIAL` · PARTIAL

**Met (thrown-error path).** Every failure branch in `governedInvoke` (`vaultStore.write` throw, receipt-emit
failure, retrieval-provider failure) returns `status: "failed_closed"` and does not emit a "completed"
result (`:968-1053`). Test `runtime/test_failClosed.test.ts` exercises this. The vault stores a
`contentDigest`, not raw content (`vault/store.ts`), so there is no "unredacted string" to leak downstream by
design.

**Honest limit.** True Lambda OOM (`JavaScript heap out of memory`) **kills the process**; it is not a
catchable exception in Node. The design guarantees fail-closed under *thrown* errors and timeouts-as-rejections,
but **cannot** guarantee an orderly fail-closed under a real OOM kill. This should be stated as a limitation,
not claimed as coverage.

### 13 — Differential encoded-string verification · `IMPLEMENTED_LOCAL` · MET (strong, bounded corpus)

**What exists.** Three verifiers agree on a shared corpus: the production verifier, the independent Node
verifier (`verifiers/node/ghost_receipt_verify.mjs`, `tests/differential/nodeIndependentVerifier.test.ts`),
and a Python verifier (`verifiers/python`, `tests/differential/pythonVerifierCorpus.test.ts`). Both differential
suites include the `unicode-canonicalization-ambiguity` case (`nodeIndependentVerifier.test.ts:221`,
`pythonVerifierCorpus.test.ts:182`), and `MAL-022` carries a non-ASCII `request_id` (`request-repro-0001-café`).

**Gap.** The Unicode coverage is a single Latin-1 accented case. There is **no** UTF-16 surrogate-pair, no
astral/emoji codepoint, and **no NFC/NFD normalization-ambiguity** case — and since both verifiers use their
runtime's native JSON parsing (no Unicode normalization), an NFC-vs-NFD receipt is a *plausible* divergence
that is currently untested. "Total behavioral equivalence across UTF-8/UTF-16 edge cases" is broader than the
evidence.

### 14 — S3 Object Lock teardown · `SYNTH_ONLY` · SYNTH

`infra/cdk/lib/api-stack.ts:93-94` sets `objectLockEnabled: true` with
`ObjectLockRetention.governance(Duration.days(365))`; the checkpoint Lambda defaults to `GOVERNANCE`
(`services/ledger/lambda/publishReceiptCheckpoint/index.ts:37-81`). The CDK **template** is assertion-tested
(`infra/cdk/test/api-stack-governed-invoke.test.ts:46,:55`).

**Honest reading.** GOVERNANCE (not COMPLIANCE) is the *correct* choice for a sandbox: a principal with
`s3:BypassGovernanceRetention` can still clear the bucket, so the "preserve sandbox teardown" half is satisfied
— but that same bypass means GOVERNANCE is **not** true immutability. There is no live-AWS evidence that Object
Lock is active on a real bucket. The non-claims doc already concedes "AWS service-level immutability [≠] legal
immutability."

### 15 — Lake Formation query-boundary escapes · `SYNTH_ONLY` / aspirational · NOT provable here

`services/governance/lakeformation/` contains only `grants/example-tenant-grants.json` and
`tag-taxonomy/core-tags.json` — **static config, no enforcement code, no test**. Row/column filtering and
query-plan enforcement happen inside AWS Lake Formation + Athena, which this repo does not run. Nested-JSON or
window-function bypass resistance **cannot be demonstrated from this codebase**; it is an AWS-live claim with no
live evidence.

---

## IV. Non-claim & epistemological typechecking

### 16 — "AST" phrase interception in CI · `PARTIAL` · PARTIAL (mislabel: AST)

**Mislabel.** `tools/research/check-forbidden-claims.mjs` is a **line-based regex scanner**, not an AST parser:
`scanText` splits on newlines and runs `rule.pattern.test(line)` (`:346-367`). It is wired into CI via
`npm run validate:claims` and **fails closed** on read error (`:435-438`); it self-exempts policy/boundary docs
and the scanner itself (`:36-68`), and allows a line if it carries non-claim/research context markers
(`:259-336`). Test `checkForbiddenClaims.test.ts` passes (within the 75).

**Real false-negative surface.** (a) A forbidden phrase split across two lines evades a per-line regex.
(b) String concatenation in code evades it — `frontierClaims.ts` itself uses `["un","breakable"].join("")` and
`phrase("proves","ai","safety")` precisely to avoid tripping the scanner, which demonstrates the bypass is real.
(c) The per-line context allowance is keyword-based: appending an allow-listed marker such as `is not` to a line
suppresses `strict`-tier rules on that same line. This is a useful vocabulary gate, not semantic entailment.

### 17 — Loose type-coercion authorizer defense · `IMPLEMENTED_LOCAL` · MET

No "Ghost-Auditor" default-allow found. `auth.ts` uses `typeof value === "string" && value.length > 0`
(`:25-27`), `??` chaining, and throws on missing/invalid tenant (`:58-65`). `receipts/verifier.ts` computes a
boolean per check and returns `verdict = checks.every(e => e.passed)` (`:187`); a signature is verified **only**
when present, algorithm-matched, and key-matched, else a failed check is pushed (`:163-184`); a malformed
signature envelope parses to `{}` → empty fields → checks fail → `verdict:false` (`:43-49`). Default path is
deny. `tests/security/receipt-negative-corpus.test.ts` (26-fixture corpus) passes with all malicious receipts
rejected.

### 18 — Signature downgrade interception · `IMPLEMENTED_LOCAL` · MET

The algorithm is **pinned by the injected verifier** (`KmsDecisionReceiptVerifier.algorithm` is a `readonly`
constant, `kmsVerifier.ts:28`), not chosen from the receipt: `verifier.ts:82-88` fails if
`receipt.signature_alg !== verifier.algorithm`, and `:94-98` requires the envelope algorithm to match. For KMS,
the keyId must be an immutable ARN/UUID — a mutable **alias** is rejected fail-closed (`kmsVerifier.ts:52-97`;
fixture `MAL-005`), the KMS response `SigningAlgorithm`/`KeyId` are re-checked (`:75-84`), and `MAL-006`
(alg mismatch) / `MAL-010` (standard vs base64url) are in the passing negative corpus.

**Caveat to record.** This holds provided the *caller instantiates the KMS verifier* for a KMS-signed
deployment. If an integrator instead selects the verifier *from the receipt's own `signature_alg`*, they would
reintroduce the downgrade path. `LOCAL_HMAC_SHA256_DEV_ONLY` is dev-only and must never be an accepted verifier
in an AWS deployment.

### 19 — Human-review lineage linkage · `RESEARCH_ONLY` · NOT as written

`research-frontier/src/humanReview.ts` is rigorous **schema** linkage: a queue→decision→incident hash chain via
`audit.event_digest`/`previous_event_digest` (`:376,:414`), receipt carry-forward with digest equality
(`:321-340`), chronology and escalation-consistency refinements, and `reviewer_id_hash` HMAC + `digest_only`
notes.

**Against the demand.** There is **no SQS/Kinesis sequence number** field anywhere, and **no `NO_EVIDENCE`
maturity flag** emitted when a live cloud trace is absent. The `audit.event_id` is a regex-validated string
(`/^audit_[A-Za-z0-9_-]+$/`) — a synthetic/forgeable value, exactly what the item says must be replaced by an
immutable cloud sequence. Not wired to any live SQS/Kinesis path; not re-exported into a runtime barrel.

### 20 — Level-ceiling claim aggregation · `IMPLEMENTED_LOCAL` · PARTIAL

**What exists (correct core).** `tools/claims/claimRegistry.mjs` implements a decidable entailment check: a
claim's asserted Truth-Ladder level `L_c` is admissible iff every citation's artifact exists, hashes to its
recorded `expect_sha256`, and `L_c ≤ min(L_a)` (`:38-128`). It is cite-then-mutate resistant (sha256 binding)
and honestly documents that it is **not** resistant to a lying registry author and does **not** establish
semantic truth (`:6-29`).

**Gap.** It only checks **registered** claims (`registry.sample.json`); it does **not** auto-extract
deployment-level assertions from arbitrary markdown, and it is **not** part of the main `npm run validate`
gate (which runs the *lexical* scanner via `claims:check`, not the registry). So "a markdown doc asserting a
deployment-level capability without a `LIVE_OBSERVED` link breaks CI" is only true for claims someone chose to
register; an unregistered prose overclaim is caught only by the regex vocabulary scanner (item 16).

---

## V. Operational infrastructure & failure modes

### 21 — Adversarial-Unicode smuggling redaction · `NOT_IMPLEMENTED` · NOT MET

`retrieval/sanitizer.ts` **classifies** (adds taint tags) but **strips/redacts nothing** — the original text,
including any hidden codepoints, passes through to `buildPromptContext` unchanged. There is no fail-closed on
"input cannot be cleanly tokenized."

**Reproduced.** Feeding the classifier's own `normalizeForMatching` a homoglyph payload
(`іgnore prevіous іnstructіons`, Cyrillic `і`) yields `matched=false` — the ASCII-only strip deletes the
homoglyphs, so the malicious instruction is neither detected nor redacted. (Zero-width chars *between* tokens
are collapsed to a space and still match; a separator inserted *inside* a keyword splits it and evades.)
`MAL-022` tests canonical-digest stability under Unicode, which is a different property than redaction.

### 22 — Witness Sybil resiliency · `RESEARCH_ONLY` · NOT MET

Witness signatures are verified against a supplied `WitnessKeyManifest` (`entry.public_key_pem`,
`witnessFraudProof.ts:83-98`). There is **no binding to a registered, active IAM execution role** — a witness
is a key-bearing manifest entry, full stop. Nothing ties a witness identity "to an authorized infrastructure
block," so an attacker who can introduce a key into the manifest (or who controls manifest distribution) is not
resisted. The IAM-anchored identity the item demands does not exist.

### 23 — Observatory alert-saturation defense · `SYNTH_ONLY` · NOT MET

`infra/cdk/lib/observatory-stack.ts` defines one SNS topic and **two** CloudWatch alarms
(`LambdaErrorAlarm`, `ReceiptGapAlarm`), each `threshold: 1, evaluationPeriods: 1`, both wired to the same topic
(`:14-44`). There is **no independent rate-limiting boundary**. CloudWatch alarms are state-based (they notify on
ALARM/OK *transition*, not per event) — this provides *implicit dedup*, which the item's premise conflates with
rate-limiting but is not the same thing. Worse for the stated goal: an adversary spamming invalid invocations
keeps `ReceiptGapAlarm` latched in ALARM, so a *new, real* architectural gap produces **no new signal** — the
exact "hide real failures" outcome the item asks to prevent. No separate high-priority channel or anomaly
decoupling exists.

### 24 — Static evidence path containment · `IMPLEMENTED_LOCAL` · MET

`tools/claims/claimRegistry.mjs:68-91` resolves each cited path against the reviewed root and rejects it unless
`absolute === root || absolute.startsWith(root + sep)` — correctly using the path separator to avoid the
`/root-evil` sibling-prefix bug — then rejects symlinks (`lstatSync().isSymbolicLink()`) and non-regular files.
Absolute paths and `../` escapes are refused (`supported = -1`, claim inadmissible). The lexical scanner
independently skips symlinks during traversal (`check-forbidden-claims.mjs:386-388`). Reproducible, platform-
invariant containment.

### 25 — Executable "entropy boundary" non-claim · `PARTIAL` · spirit MET, literal NOT (mislabel: entropy)

**Mislabel.** No entropy is computed anywhere; "the entropy bound cannot decrease" has no corresponding
quantity. `frontierClaims.ts` enforces a claim-status lattice and "no verified claim without evidence"
(`:45-57`), and `assertNoForbiddenOverclaim` (`:59-78`), but nothing measures entropy.

**Spirit is machine-enforced, though.** The epistemic non-claim — *a PASS verdict does not imply semantic
truth/safety* — is executably asserted: every verifier report carries a `non_claim`, and tests require a PASS
report to contain it: `pythonVerifierCorpus.test.ts:298` (`"does not prove model safety"`, `"not AWS evidence"`),
`independentVerifierSmoke.test.ts:61,105`, `nodeIndependentVerifier.test.ts:290`. The non-claims doctrine
("That a PASS verdict means safe") is documented in `docs/compliance/non-claims.md`. So the *inability to deduce
factual correctness from cryptographic consistency* is both documented and test-enforced — the item's literal
"entropy" rule is not, and should not be claimed.

---

## Cross-cutting findings

1. **The checklist contains six mislabels that a rigorous audit must not silently ratify:** KMS "AAD" on
   Sign/Verify (2), "sequence token" (5), "hypervisor isolation" (10), "AST" scanner (16), "deadlock" on a pure
   function (9), and "entropy bound" (25). Accepting any of these framings would itself be an overclaim.

2. **Research-frontier ≠ runtime.** Items 3, 8, 9, 11, 19, 22 live in `packages/research-frontier` and are
   **not re-exported into any runtime barrel** (verified by grep). They are correct, well-tested *models*; they
   are not on the live `governedInvoke` path and must not be described as production controls.

3. **The honest-by-construction pattern is real and strong.** Every non-trivial module carries an explicit
   `nonClaim`/`non_claims`, fails closed on bad input, uses `hasOwnProperty`/plain-prototype guards against
   pollution, and measures freshness/ordering in ledger position rather than wall-clock. The verifier cannot
   emit a PASS report without attaching its own limitation — this directly serves the repo's North Star.

4. **The gap is uniformly at the AWS-live boundary.** Every "NOT MET" or "SYNTH_ONLY" item is one that requires
   infrastructure Ghost-Ark does not exercise at runtime: streaming inference (4, 5), Lake Formation
   enforcement (15), live Object Lock (14), SNS rate decoupling (23), or IAM-bound witness identity (22). This
   is consistent with the repo's own "AWS Reality Boundary."

## Highest-leverage next tasks (bounded, no overclaim)

1. **Item 23 (real, cheap, correct):** add an independent-boundary alarm design — a separate high-severity SNS
   path plus an anomaly/`M-of-N` alarm so error-spam cannot latch over a real receipt-gap signal. Pair with a
   CDK assertion test. This is the one "NOT MET" item that is genuinely fixable in-repo without new infra.
2. **Item 20 wiring:** add `claims:registry` to `npm run validate` and register the README/product-doc
   deployment-level claims so the entailment ceiling actually gates CI (today only the lexical scanner does).
3. **Item 13 corpus:** extend the differential corpus with UTF-16 surrogate, astral/emoji, and NFC/NFD
   normalization receipts to convert "MET (bounded)" into "MET (broad)" — or document the NFC/NFD divergence as
   a known verifier limitation.
4. **Item 18 guardrail:** add a test asserting that verifier *selection* never derives the algorithm from the
   receipt (pin-by-config), closing the only path back to a downgrade.
5. **Items 7/21 honesty:** relabel `sanitizer.ts` as a best-effort ASCII heuristic in code comments and docs;
   do **not** let any surface imply homoglyph/zero-width or verbatim-leak coverage (reproduced bypass above).

## Completion report

- **Files created:** `docs/validation/ADVERSARIAL_CHECKLIST_AUDIT_2026-07-11.md` (this file).
- **Files modified:** none.
- **Commands run:** targeted `npx vitest run` on the security/crypto/differential test files above
  (75 + 8 + 4 passed); two standalone reproduction probes (homoglyph taint bypass; `__proto__`/`toString`
  canonicalization). No AWS commands. No commit.
- **Tests:** all executed tests passed; no tests were added, weakened, or modified.
- **Security/claim impact:** none — read-only audit. No canonicalization, signature, tenant-boundary, schema, or
  claim-boundary code was touched.
- **Remaining gaps:** items 4, 5, 21, 22 (NOT_IMPLEMENTED / research-only against the literal demand); 15, 23
  (AWS-live, unprovable in-repo); partials at 2, 3, 6, 7, 10, 12, 16, 19, 20, 25.
- **Next highest-leverage task:** item 23 independent-rate-limit alarm boundary (only in-repo-fixable "NOT MET").
