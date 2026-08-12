# The Observability Gap — a research program

Tier: **core**. Opened 2026-08-12, the day the first external reports were filed.

## The thesis

> **A canonicalization standard is sound only over the layer it is defined on. A standard
> defined over parsed values inherits its parser's kernel, and can forbid conditions no
> conforming implementation is able to observe.**

This is not a conjecture about JSON. It was found in RFC 8785 by measurement — §3.1 forbids
duplicate property names while §3.2.3 operates on an already-parsed object, so the prohibition
sits one layer above anything a conforming implementation can check
([JCS_CANONICALIZER_PROBE.md](./JCS_CANONICALIZER_PROBE.md)) — and the same shape appears to
recur across every family of canonical encoding. The program below is the attempt to find out
whether that recurrence is real, how often the gap is exercised in production, and what
happens when systems with gaps are composed.

It succeeds by producing a defensible negative result as readily as a positive one. If the
survey finds most standards are layer-correct, or the log finds the pathologies never occur in
real traffic, those are the results and they narrow the claim — which is what
[00_THESIS.md](./00_THESIS.md) F2 asks for.

## Why now, and what changed

Two things, both on 2026-08-12. The measurement instrument is published and installable by
anyone (`@ghost-ark/kernel-probe@0.1.0`, provenance-attested), so a finding no longer requires
trusting this repository. And the first five reports went to people who did not ask for them,
which converts the project's largest open weakness from "unaddressed" to "awaiting reply."

The repository is otherwise feature-frozen (see AGENTS.md). Everything below is a measurement
of something this project does not control, which is the only category the freeze permits.

## Arm E — real traffic (falsifier F2, directly)

**The gap.** Every incidence figure this project has ever reported comes from a hand-curated
alphabet or a declared generator. EXPERIMENTS.md §Open Gaps says so, and F2 says the finding
may be an artifact of that curation. Closing it needs a corpus this project did not author.

**The corpus exists and is public.** Sigstore's Rekor transparency log is append-only,
publicly readable, and holds real production signed evidence:

```
GET https://rekor.sigstore.dev/api/v1/log            -> treeSize 2,316,221,073   (2026-08-12)
GET https://rekor.sigstore.dev/api/v1/log/entries?logIndex=<n>
```

**Pilot, executed 2026-08-12 before this document was written.** 25 uniformly random indices
over the full tree, seed 20260812: **16 dsse, 8 hashedrekord, 1 intoto**. So roughly
two-thirds of entries carry a JSON attestation payload and one third are bare hashes with
nothing to canonicalize.

*n = 25 is below `MIN_N_FOR_PROPORTION_INTERVAL`, so those are exact counts and no interval is
attached.* The pilot establishes only that the population is reachable and substantially
eligible — it is a feasibility check, not a result.

**What Arm E measures.** For a random sample of eligible entries, drawn with a recorded seed:
how often does a real, production, signed attestation payload contain a construct that a
declared consumer would distinguish but the canonicalization step does not — duplicate keys,
integers outside the safe range, non-finite literals, over-precise decimals?

**This is the first measurement in this project that legitimately earns a confidence
interval.** The draws are random from a population this project did not construct, so
`reportProportion` with provenance `sampled` applies rather than `census`, provided n ≥ 30 and
the sampling frame is recorded.

**Both outcomes are publishable, and one of them is against interest:**

| Outcome | What it means |
|:---|:---|
| Pathologies occur at a measurable rate | F2 is **narrowed**. The alphabet models something that happens. |
| Pathologies never occur across a large sample | **F2 is confirmed.** The alphabet is adversarial fiction with respect to production traffic, the claim contracts to "possible, not observed," and this document says so in the same sentence it reports the number. |

**Traps, each already visible:**

- *Sampling frame.* Take uniformly random indices over the whole tree with a recorded seed.
  The first N entries are chronologically biased and heavy with early test data; "recent
  entries" is biased toward whatever tool is popular this month. Record the frame, the seed,
  and the date.
- *Eligibility must be reported, not silently dropped.* One third of the log has no JSON
  payload. A rate over "entries" and a rate over "eligible entries" are different quantities
  and only one of them answers the question. Report both denominators, as E10 does.
- *A zero needs its denominator more than a positive does.* "0 duplicate keys" is meaningless
  without n, and at small n it is compatible with a substantial true rate.
- *Payload extraction is a pipeline with its own kernel.* Base64-decoding a DSSE envelope and
  re-parsing it is exactly the `parse ∘ canonicalize` composition under study. Probe the
  **raw bytes** of the payload, never a re-serialization of it, or the measurement destroys
  the property it is measuring. This is the E4 discriminator applied to the harness.
- *Rate limits and politeness.* This is free public infrastructure operated by someone else.
  Sample slowly, cache locally, identify the client, and stop if asked.

**Adjacent corpora, same method:** npm provenance attestations (every provenance-published
package, including this project's own), and GitHub's artifact attestation API. Three
independent real-traffic populations would make the result far harder to dismiss than one.

## Arm C — the cross-standard survey

**The claim to test:** the JCS layering gap is an instance, not an accident.

One row per standard, and every row must answer the same three questions: *what layer is it
defined over*, *what does it forbid*, and *can a conforming implementation observe a
violation*.

| Standard | Defined over | Forbids | Observable at that layer? |
|:---|:---|:---|:---|
| RFC 8785 (JCS) | parsed value | duplicate property names (§3.1) | **No** — measured, see JCS_CANONICALIZER_PROBE.md |
| RFC 8949 §4.2 (CBOR deterministic) | parsed map | duplicate map keys | to measure |
| Protobuf deterministic serialization | in-memory message | — (explicitly not canonical across versions) | to measure |
| JSON-LD RDFC-1.0 / URDNA2015 | RDF dataset | — | to measure |
| XML C14N + XML Signature | node-set from a parse | — | **known-unsound historically**; see below |
| DER (X.690) | the encoding itself | non-minimal encodings | **expected yes — the control arm** |

**DER is the control and the table is worthless without it.** This repository's own rule is
that a detection rate with no control arm means nothing: a survey that finds every standard
unsound has probably found a definition of "unsound" that everything meets. DER is defined
over octets rather than over a parsed value, so if the thesis is right, DER should be the row
where the gap does not appear. If DER shows the same gap, the thesis is wrong as stated.

**XML Signature is the prior art and must be cited as such, not rediscovered.** The signature
wrapping attack family — where the signed canonical form and the consumed parse tree are
selected by different mechanisms — is a documented, decade-old body of work with real CVEs
across SAML and WS-Security. Arm C's contribution is not noticing that XML had this problem.
It is the claim that XML's problem and JSON's problem are **the same problem stated at
different layers**, and that the property distinguishing the safe standards from the unsafe
ones is layer-correctness rather than format. Read that literature first; a survey that
reinvents it will be dismissed by the first reviewer who recognizes it, correctly.

**Trap:** this arm decays into a literature review. Guard: every row carries either a runnable
probe against a real implementation, or the word **unmeasured** in the observability column.
No row gets an opinion.

## Arm F — kernel composition

**The question no one has answered:** evidence crosses hops. A receipt is canonicalized and
signed at a gateway, transported, re-parsed by a consumer, and re-canonicalized before
comparison. Each hop has its own `parse ∘ canonicalize` and therefore its own kernel.

**Conjecture (to be proved or refuted, not assumed):** kernel is **not compositional**.
Soundness of a chain cannot be inferred from soundness of its links, in both directions —
a chain of individually sound hops can be unsound, and a chain containing an unsound hop can be
sound because an earlier hop's normalization removed the distinction the later hop would have
destroyed.

If that holds, it has a blunt practical consequence: **auditing each component of an evidence
pipeline is insufficient, and the composite has to be audited as a composite.** Every
supply-chain security architecture that reasons component-by-component would inherit that
caveat.

`proofs/tla/TransportBoundary.tla` already models one boundary and found that the reconciler
rather than the parser is load-bearing. Arm F generalizes it to n hops.

**Trap, and it is the serious one:** this project does not need a seventh TLA+ spec. Arm F is
justified only if it produces a **counterexample that surprises** — a concrete two-hop chain,
both hops sound in isolation, whose composite is not, exhibited as a trace and reproduced
against real implementations. A spec that merely restates the definition is exactly the
credibility-negative surface AGENTS.md warns against. If no surprising counterexample appears
within a bounded search, record that and stop; a proved compositionality result would also be
worth having, and would be the more useful finding for practitioners.

## Arm R — reception

The five filed reports are tracked in
[EXTERNAL_KERNEL_PROBE_REPORTS_2026-08-12.md](../validation/EXTERNAL_KERNEL_PROBE_REPORTS_2026-08-12.md).
The disposition log is empty and stays empty until somebody replies.

The reply worth most is **"your intent is wrong"** — a maintainer stating that their consumers
do not distinguish a pair marked `distinct`. That is direct evidence about the alphabet, which
is the component this project can least verify alone and precisely what F2 attacks. If such a
reply arrives and holds, `kernelAlphabet.ts` changes, the change cites the reply by name, and
every document quoting E1's counts fails the drift guard until re-measured.

## Sequencing

**Arm E first, and it is not close.** It is the only arm that attacks the largest open
weakness with data that already exists, it produces a result whichever way it falls, and its
pilot is already executed. Arm C is second because it needs reading before measuring. Arm F is
third and is permitted to be abandoned.

Arm R runs in the background and outranks everything the moment a reply lands — an external
finding is worth more than any internally generated result in this program, which is the whole
reason the program exists.

## Non-claims

This is a plan, not a result. Nothing here is evidence of anything. Arm E has a feasibility
pilot at n = 25 and no measurement. Arms C and F have neither. No standard named above is
asserted to be defective; the survey asks a structural question about where each specification
is defined, and a standard that turns out to be layer-correct is a finding, not a failure.
Nothing in this program bears on semantic safety, model behaviour, compliance, or the
correctness of any deployment.
