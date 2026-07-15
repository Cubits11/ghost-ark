# Phase III — The Effect Oracle and Byte Reconciler

Status: research-only design with a clean-room reference reconciler and an FSA corpus. No eBPF, kernel, cloud, or live-capture component is implemented or claimed. The goal is to make M = P(unsafe | receipt-valid) measurable by an instrument independent of Ghost-Ark.

## Three components, three trust domains

| Component | Domain | Records |
| --- | --- | --- |
| Ghost-Ark gateway | application layer | `TransitRecord` / receipt `execution_trace` — digest of the decoded HTTP body |
| Effect Oracle (Observer) | transport layer | raw egress wire bytes, target, clean-close flag — parses nothing |
| Reconciler (new binary) | neither | decodes the Oracle's wire bytes and compares against the receipt |

The Oracle is deliberately dumb: it logs bytes, timestamps, and target IPs, and does not parse JSON or intention. Intelligence lives in the Reconciler, which shares zero runtime and zero memory with Ghost-Ark and recomputes every digest with its own crypto.

Reference implementation: `packages/research-frontier/src/oracle/byteReconciler.ts`. FSA corpus: `tests/differential/oracleDivergence.test.ts`.

## Corrections to the proposed design

Three points in the commissioning design would have produced a broken or self-defeating instrument. They are corrected here and encoded in the reconciler.

### 1. Wire bytes are not app-layer digests — decode before comparing

The Oracle captures transport-layer bytes: status line, headers, and — for chunked responses — chunk-size markers and terminators. The receipt commits the digest of the *decoded body*. `sha256(wireBytes)` therefore never equals `response_payload_digest` for any real response. A naive comparison flags 100% of honest traffic as divergent.

This, not garbage-collection timing, is the dominant source of the "false-positive divergence" the design attributes to asynchronous drift. The reconciler parses HTTP/1.1 framing, de-chunks, strips headers, and only then digests the reconstructed body. It additionally reports framing faults a digest comparison alone cannot see: ambiguous Content-Length/Transfer-Encoding pairs (the smuggling vector), trailing bytes beyond the declared body, and truncated streams.

### 2. Correlate by content-addressed identity, not by time

The design proposes dynamic time warping over byte streams to survive clock skew between user-space and kernel-space timestamps. Unnecessary. Correlate transits by `execution_nonce` + `sequence_num` (content-addressed), never by wall-clock proximity, and skew becomes irrelevant by construction — there is no temporal match to drift. The reconciler keys on `sequenceNum`. Every receipt-claimed transit must have an observation and every observation a receipt entry; an unmatched entry on either side is itself a divergence (`MISSING_OBSERVATION`, `UNRECORDED_TRANSIT`), which is exactly how a transit Ghost-Ark failed to record, or fabricated, surfaces.

### 3. The HTTPS independence boundary must be stated, not hidden

A transparent PCAP/eBPF observer sees ciphertext under TLS and cannot reconstruct the body. Body reconciliation then requires a TLS-terminating proxy (the Envoy in the design), which means the Oracle shares TLS trust with the observed path. That is a real reduction in independence — the "zero shared trust" claim holds for plaintext egress and weakens to "separate process, shared TLS termination" for HTTPS. The reference reconciler is scoped to plaintext HTTP/1.1 response bytes and says so.

## FSA corpus (initial)

| Case | Construction | Expected |
| --- | --- | --- |
| Baseline (Content-Length) | wire body equals the digested body | MATCH |
| Baseline (chunked) | body split across chunks; reconciler de-chunks | MATCH |
| Header smuggling | body matches digest, extra pipelined response appended | EXTRA_WIRE_BYTES |
| CL/TE desync | Content-Length and Transfer-Encoding both present | AMBIGUOUS_FRAMING |
| Truncation | Content-Length declares full body, wire carries half, unclean close | TRUNCATED |
| A-CC echo tampering | receipt digests a CRLF-injected body the wire never carried | DIGEST_MISMATCH |
| Missing observation | receipt claims a transit with no wire record | MISSING_OBSERVATION |
| Unrecorded transit | Oracle sees egress with no receipt entry | UNRECORDED_TRANSIT |

## Production-review positions

- **Divergence as a kill switch.** A `rate(divergence) > 0 → contain the tenant cell` policy is only safe once false-positive divergence is driven to zero. Corrections 1 and 2 are prerequisites: without decode-before-compare and content-addressed correlation, honest traffic trips the switch and the Oracle becomes a self-DoS an adversary can fire on demand. Order matters — correctness before automation.
- **Ring-buffer sampling has a selection-bias trap.** Flushing only "high-risk" slices to durable storage, where risk is Ghost-Ark's own score, means the Oracle inherits Ghost-Ark's blind spots — and A-CC hides precisely in traces the system scored low-risk. If sampling is used, its trigger must be independent of Ghost-Ark's risk score (e.g., uniform random plus all divergences), or M is estimated on a biased subpopulation and understates exactly the failures it exists to catch.
- **Async drift is real but not a byte-reconciliation problem.** It matters for live alerting latency, not for offline content-addressed reconciliation, which is where M is computed.

## Non-Claims

- The reconciler proves receipt-vs-wire consistency for plaintext HTTP/1.1 under its documented rules; it does not prove the tool's response was truthful (Impossibility I2).
- No eBPF, kernel, Envoy, Kubernetes, or live-capture component exists here; the Docker/DaemonSet pathway is a design target.
- HTTPS body reconciliation requires a TLS-terminating observer and the reduced-independence boundary that entails.
- M is computable only with an Oracle that shares no code with Ghost-Ark; this reconciler is that instrument's offline core, not a measured M.
