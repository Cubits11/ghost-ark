# Phase VI — Runtime Custody: Closing the Empty-Trace Gap

Status: local-only, draft, research artifact. Nothing in this document is a
deployment, isolation, or safety claim.

## What this phase closes

The v2 receipt prototype (`packages/enforcement-runtime/src/receipts/v2/emission.ts`)
made assertion-vs-record divergence receipt-detectable — but only for callers
that already possessed gateway transit records. The governed runtime itself
had none: `governedInvoke` called `deps.modelInvoker.invoke` directly, so a v2
receipt emitted there would have attested an **empty `execution_trace`** for
an invocation whose model egress genuinely happened. An empty trace that means
"nothing crossed the wire" and an empty trace that means "something crossed
the wire and nobody recorded it" would have been indistinguishable inside the
signed evidence. That is precisely the silent-compromise shape the transport
E2E work identified (unrecorded egress), reproduced one layer up.

## What was built

All additive; no guarded canonicalization, signing, or verifier file was
modified.

- `packages/enforcement-runtime/src/runtime/transitLedger.ts` — per-invocation
  custody ledger. Sequence numbers are allocated before egress is attempted,
  so a severed transit burns its number and the gap is itself evidence of an
  incomplete egress attempt. Recording is fail-closed: only allocated
  sequence numbers, strictly increasing, well-formed digests.
- `packages/enforcement-runtime/src/gateway/gatewayModelInvoker.ts` — a
  `ModelInvoker` that never opens its own socket: model egress goes through
  `executeGovernedTransit` under an exact-match destination allowlist, and the
  observed transit is recorded in the ledger **before** the response is
  interpreted. A transit whose body fails to parse is still recorded egress.
- `packages/enforcement-runtime/src/receipts/v2/runtimeEmitter.ts` — v2
  emitter that mirrors the v1 emitter's identity hashing and field derivation
  and reuses the existing v2 build/sign path unchanged.
- `governedInvoke` (additive extension) — when a v2 emitter is configured,
  every receipt-bearing path also emits a v2 receipt whose `execution_trace`
  is the ledger's gateway-recorded custody, subject to the custody rule below.
  When no v2 emitter is configured, behavior is unchanged; the previously
  passing suite is the backward-compatibility evidence.

## The custody rule

> If model egress **completed** and the transit ledger recorded **zero**
> transits, the runtime refuses to emit a v2 receipt and the invocation fails
> closed.

Consequences, each exercised in
`tests/integration/governedInvokeV2Custody.test.ts` against a real local HTTP
endpoint (no transport mocks; trace digests are recomputed in the test with
node crypto from the bytes the server actually observed, and receipts are
checked by the independent Node verifier, not the emitting code):

1. Gateway-bound egress → v2 receipt binds the wire-observed digests;
   independent verifier accepts; a tampered trace entry is rejected.
2. Egress outside custody (a direct invoker) → `failed_closed`, no v2 receipt,
   and the v1 receipt of the refusal is still persisted evidence.
3. Policy blocks before any egress → v2 receipt with an honestly empty trace.
4. Severed transit (allowlist refusal) → `failed_closed` with a v2 receipt
   attesting zero completed transits for a refused invocation.
5. No v2 emitter configured → the v1-only result is byte-for-byte unchanged.

## Category answer

The advisory review asked which category Ghost-Ark belongs to (IFC,
provenance, accountability, runtime verification, AI security substrate). The
working answer this phase supports:

> Ghost-Ark is an information-flow enforcement and cryptographic
> accountability layer for LLM-agent runtimes whose load-bearing property is
> that, within a stated custody boundary, an execution either carries a
> signed, independently recomputable record of its observed egress or it does
> not complete.

That is narrower than "binding semantic intent to observed execution":
semantic intent is not receipt-checkable (impossibility I2 in
`docs/research/EVIDENCE_PROVENANCE_LATTICE.md`); observed transit is.

## Answer to the framing question

"Can we prove that an LLM agent cannot cause unreceipted effects outside its
capability lattice, even in the presence of adversarial transports, tools, and
runtime mutations?" — Not unconditionally, and no design reviewed here changes
that. What this phase establishes, with tests, is the conditional form:

- **Within** the runtime API path, with a v2 emitter configured: completed
  model egress with no gateway record does not produce a completed invocation.
- **Outside** it, the property does not hold and is not claimed: host code
  that never enters `governedInvoke`, or that fabricates a ledger, is beyond
  this boundary. Narrowing that gap is the province of process isolation and
  attestation work (Phases XII-shaped), which this repository has not built
  and therefore does not claim.

## Advisory roadmap triage

- **Phase VI/VII (runtime interception, governedInvoke v2 integration)** —
  accepted; this is that work, done locally at zero cloud cost.
- **Phase VIII (AgentDojo / InjecAgent / benchmark suites)** — real external
  integrations; will not be stubbed or simulated. Deferred until run for real.
- **Phase IX+ (cloud deployment, federation, TPM/SGX, zk)** — aspirational;
  none of it exists here and none of it is claimed.
- **Monetary figures ($10k–$500k per phase)** — non-claims. They are the
  advisor's speculation about markets, not properties of this code, and no
  artifact in this repository should be read as supporting them.
- **Maturity scores (8.5/10 etc.)** — informal opinion, recorded as received;
  not evidence.

## Named gaps (unchanged or newly explicit)

- Process boundary: nothing prevents host code from bypassing the runtime
  entirely. The custody rule closes the runtime API path only.
- Severed transits produce no trace entry; the burned sequence number is
  ledger-local and is not yet committed into the receipt.
- v2 receipts are not chain-linked (`prev_receipt_hash` is null) and have no
  repository/persistence path.
- The v2 runtime emitter takes the synchronous signer; local HMAC is dev-only
  and async KMS custody for v2 is not wired.
- Retrieval and vault egress do not yet flow through the gateway; only model
  egress does.

## Non-claims

This phase does not establish production readiness, semantic safety, truth of
model output, compliance with any regime, resistance to all attacks, process
or hardware isolation, or attestation of runtime integrity. Signing continues
to prove signing authorization over the receipt payload, nothing more.
