# The Observability Gap — a research program

Tier: **core**. Opened 2026-08-12, the day the first external reports were filed. **First
measured the same day**; this document was rewritten against the results, and the section
immediately below records what the measurements did to the plan.

## The thesis, as it now stands

> **A canonicalization requirement is sound only over the layer it is defined on. A
> requirement stated over parsed values is not observable at an implementation's chosen
> decode target, and the distinguishing information is destroyed before the requirement can
> be checked.**

That is a **weaker statement than the one this document opened with**, and it was weakened by
measurement rather than by review. The original wording was:

> ~~"...and can forbid conditions no conforming implementation is able to observe."~~

**Falsified on 2026-08-12.** One CBOR library, `ciborium` 0.2.2, exhibits all three
behaviours RFC 8949 permits for a duplicate map key, and which one you get is chosen by the
consumer's decode target, not by the codec: `Value` preserves both pairs and the duplicate
**is** observable, `BTreeMap` silently keeps the last, and a `derive(Deserialize)` struct
raises `duplicate field`. A conforming implementation *can* observe the violation if the
ecosystem offers a structure-preserving target and somebody uses it. Details and the full
accept/reject matrix are in
[CANONICALIZATION_LAYER_SURVEY.md](./CANONICALIZATION_LAYER_SURVEY.md).

## Corrections this program made to itself on its first day

Recorded at the top rather than buried, because every one of them was an error in the version
of this document that opened the program, and three of them would have produced a wrong
number if they had survived into the measurement.

**1. The sampling frame was mis-specified.** This document named
`GET /api/v1/log -> treeSize 2,316,221,073` as the frame. That is the size of the **active
shard only**. Rekor addresses entries by a **global** index spanning every shard, so the frame
is the sum over all shards — measured at run time as **2,438,308,366** across three shards
(4,163,431 + 117,740,831 + 2,316,404,104). Drawing uniformly over the active shard's treeSize
would have covered both retired shards in full and truncated the newest ~5% of the log, while
looking uniform. Verified empirically: index 0 and 4,163,430 land in shard 1, 4,163,431
through 121,904,261 in shard 2, and 121,904,262 upward in shard 3.

**2. The pilot's eligibility figure was wrong by roughly a factor of thirty.** The pilot read
"16 dsse, 8 hashedrekord, 1 intoto" as "roughly two-thirds of entries carry a JSON attestation
payload." **A Rekor `dsse` entry stores `envelopeHash`, `payloadHash` and signatures — it does
not store the payload.** Neither does `rekord` or `hashedrekord`. Those 16 dsse entries are 16
hashes with nothing to canonicalize. Only `intoto` v0.0.1 carries a retrievable attestation,
and the measured eligible fraction is about **2%**, not 67%.

**3. "Signed attestation payload" overstates what the log supports.** Rekor's intoto entry
stores hashes of the envelope and the payload; the DSSE envelope itself is not stored, so **no
signature can be checked from log data alone.** What can be checked, and now is, per entry, is
that the payload bytes scanned hash to the `payloadHash` the log recorded. The word "signed"
has been removed from what Arm E claims.

**4. The general claim is not novel, and this document did not say so.** It is stated
normatively in W3C XML Signature Security Considerations **§8.1.1, "Only What is Signed is
Secure"** — *"When transforms are applied the signer is not signing the native (original)
document but the resulting (transformed) document."* Momot et al. named parser differentials
as a weakness class at IEEE SecDev 2016. And **concurrent work exists**: Brömme,
*Canonicalization Failures as a Recurring Vulnerability Class*, arXiv:2608.06508, submitted
**2026-08-06**, six days before this program opened. See the survey's novelty section; the
honest position is that this program contributes a *measurement* and a *composition result*,
not a new vulnerability class.

**5. Arm E's premise needed reframing, and the reframing makes it more defensible.** DSSE
signs the raw payload octets under PAE and Rekor hashes those same octets. **There is no
canonicalization step in that verification path**, so the gap this program studies
structurally cannot bite there — Sigstore is, on this question, an example of the safe design.
The log is used as a **corpus** of real JSON emitted by real build systems, not as a target.
Any hazard a finding describes belongs to a downstream consumer that parses and re-serializes
such a payload.

---

## Arm E — real traffic (falsifier F2, directly)

**Executed 2026-08-12.** Harness: `tools/experiments/e12RealTrafficKernel.ts`. Measurement
instrument: `tools/experiments/rawJsonScan.ts`. Full result and coverage boundary in
[EXPERIMENTS.md §E12](./EXPERIMENTS.md).

**Seed 20260812, 3,000 uniform draws over 2,438,317,323 global log indices, 0 unresolved.**

```
kinds drawn   dsse 2030 | hashedrekord 901 | intoto 69
eligibility   eligible 64 | absent-by-type 2931 | absent-though-typed 5
              payload-digest-mismatch 0 | unresolved 0
corpus        1,056,499 payload bytes | 18,528 members | 33,982 strings | 103 numbers
```

| | result |
|:---|:---|
| entries carrying **any** pathology class | **0 / 64**, 95% CI [0.00%, 5.66%] |
| clustered by producer | **0 / 16** — **no interval**, n is below the floor of 30 |
| positive controls detected | **7 / 7** |
| payload digest verified against the log | **64 / 64** |

**The outcome is the one this document pre-committed to calling against interest.**

> **F2 is CONFIRMED, not narrowed.** Not one pathology class occurred in a single real
> attestation payload. The alphabet is adversarial fiction with respect to this production
> traffic, and the claim contracts to **"possible, not observed."** E1 shows these collapses
> are constructible and that real canonicalizers exhibit them; E12 shows they are not what
> production supply-chain attestations look like. Both are true, and the second bounds the
> first.

Four things stop that zero from being read as more than it is.

- **The zeros are not equally informative.** `duplicate-member-name` had 18,528 object members
  to occur in and did not: that is the strong one. `unsafe-magnitude-integer` had **zero
  opportunities** — the corpus contains 103 numbers in total and none above 2^53 − 1 — so its
  zero is **vacuous** and says nothing about large integers.
- **At the level of independent units there is no bound at all.** Entries from one toolchain
  are not independent draws. Collapsing the clustering gives 0/16 producers, which is below
  `MIN_N_FOR_PROPORTION_INTERVAL`, so the interval is **refused**. The entry-level
  [0%, 5.66%] describes 64 correlated observations and must not be quoted alone.
- **The eligible population is time-skewed by construction.** Eligibility requires the log to
  have stored a payload, which only `intoto` v0.0.1 does. Shard 2 supplied 4.5% of the draws
  and 37.5% of the eligible entries; the modern shard's eligibility rate is 1.40% against
  shard 2's 17.65%. The estimand is "intoto entries with stored attestations, skewed toward
  the older shard" — not "Rekor", and not "supply-chain attestations today".
- **The instrument was shown to work on the same run.** Seven synthetic payloads, one per
  class, pushed through the identical decode-and-scan path; all seven detected. A zero from a
  working detector and a zero from a broken tokenizer are the same number, and this repository
  has shipped the second kind before.

---

## Arm C — the cross-standard survey

**Executed 2026-08-12.** Written up in full at
[CANONICALIZATION_LAYER_SURVEY.md](./CANONICALIZATION_LAYER_SURVEY.md). Headlines:

- **DER behaves as the control arm should.** Seven variants of one real ECDSA P-256 signature,
  all valid BER, all invalid DER, all BER-decoding to the identical `(r, s)`. OpenSSL 3.6.2,
  Node 22.22.3, and Java 23.0.1 SunEC each rejected all seven and accepted the original. And
  the half that carries the argument: after a permissive parse to `(r, s)`, all eight variants
  re-encode to **one** byte string, so a checker handed only the parsed value cannot observe
  the violation — it no longer exists in its input. **Parsing is the lossy step**, demonstrated
  on the row where the thesis predicts safety.
- **CBOR reproduces the JCS collapse one layer down.** In two independent libraries,
  `canonical({"a":1,"a":2}) == canonical({"a":2})`.
- **Detection at the encoding layer survives only as a side effect of strictness.** Duplicate
  keys are visible over the encoded key sequence only if a checker enforces **strictly**
  increasing bytewise order; written with `<=` instead of `<`, the check passes and says
  nothing.
- **Two canonical CBOR forms exist and both tested libraries emit the non-core one** (§4.2.3
  length-first rather than §4.2.1 bytewise).
- **An alternative explanation the survey cannot rule out:** the causal variable may be
  **schema-boundness**, not layer. DER is clean partly because ASN.1's type system makes "the
  same field twice" inexpressible. Breaking that confound needs a row this survey does not
  have.
- Protobuf, RDFC-1.0, CER, JWS and COSE are **unmeasured** and marked so.

---

## Arm F — kernel composition

**Executed 2026-08-12.** Harness: `tools/experiments/e13KernelComposition.ts`. Full result in
[EXPERIMENTS.md §E13](./EXPERIMENTS.md).

The conjecture was that kernel is not compositional in both directions. **Both directions
hold, and a third result that was not conjectured is the more useful one.**

**Part 1, exhaustive over a finite model.** Every hop on a four-document domain — 625 hops,
390,625 ordered compositions, all enumerated, graded with E1's own `classify`:

| | count |
|:---|---:|
| both hops acceptable alone, composite not | 1,480 |
| an unacceptable hop inside an acceptable chain | 102,120 |
| upstream collapse neutralized **by rejection** | 75,000 |
| upstream collapse repaired **by separation** | **0** |

> **Repair impossibility.** Once a hop maps two documents to one canonical form without
> refusing them, no downstream hop can separate them again. It can pass the collapse along, or
> it can refuse. **You cannot audit an upstream collapse away downstream; you can only decline
> to build on it.**

**Part 2, real implementations.** Nine hops composed pairwise over the 31-class alphabet:
2,511 cells, **2 forward counterexamples**, 405 repairs, all by rejection, none by separation.

The counterexample, reproduced by hand and verified at the byte level: `jq` **rejects**
`{"v":"\ud800"}` outright (`parse error: Invalid \uXXXX\uXXXX surrogate pair escape`, exit 5)
— correct, fail-closed behaviour. CPython configured with `errors='surrogatepass'` keeps that
document distinct from its control. Composed, `jq` after CPython **collapses them**: the
upstream hop re-encoded the escaped surrogate as raw WTF-8 octets, `jq`'s guard is written
against the *escape syntax*, and the same condition arriving as *raw bytes* is invisible to
it. **A normalization step placed in front of a fail-closed verifier disabled that verifier's
refusal.**

**And the counterexample's own limit, stated in the same breath.** It needs one permissive
codec configuration, and that configuration was chosen by the harness. Measured on the same
machine: CPython's default raises, Ruby's stdlib raises, and Node preserves the escape so a
downstream `jq` still refuses. **No pair of all-default hops on this machine exhibits it.**
The mechanism is demonstrated; its incidence in deployed pipelines is unmeasured. This is a
"possible, not observed" result and is reported as one.

The program said Arm F was justified only if it produced a counterexample that surprises,
and was otherwise permitted to be abandoned. It produced one, plus a proposition with a
practical consequence, and the counterexample carries a configuration dependency that is
recorded rather than smoothed over.

---

## Arm R — reception

Unchanged. The five filed reports are tracked in
[EXTERNAL_KERNEL_PROBE_REPORTS_2026-08-12.md](../validation/EXTERNAL_KERNEL_PROBE_REPORTS_2026-08-12.md).
The disposition log is empty and stays empty until somebody replies.

The reply worth most is still **"your intent is wrong"** — a maintainer stating that their
consumers do not distinguish a pair marked `distinct`. That is direct evidence about the
alphabet, which is the component this project can least verify alone and precisely what F2
attacks. Arm E's result raises the stakes on that reply rather than lowering them: an alphabet
whose constructs do not appear in production traffic is under more pressure to justify its
intents, not less.

---

## What this program has not done

- **Named a consumer and shown that it distinguishes.** Every `distinct` intent in this work
  is a declared consumer model, not an observed one. Demonstrating that a real policy engine
  — Kyverno, OPA, `in-toto` verification, a cosign policy — actually distinguishes one of
  these pairs is the single measurement that would convert the whole program from structural
  to consequential, and it does not exist.
- **Measured a second real-traffic population.** npm provenance attestations expose full DSSE
  payload bytes and would be a genuinely independent corpus. A defensible sampling frame for
  npm was not established, so it was not run rather than run badly.
- **Read the concurrent work.** arXiv:2608.06508 has been verified to exist and read in
  abstract only. No claim about its overlap with this program should be made until it is read.
- **Resolved the schema-boundness confound** in Arm C.
- **Chains longer than two hops** in Arm F.

---

## Non-claims

Nothing in this program bears on semantic safety, model behaviour, compliance, or the
correctness of any deployment. No standard named here is asserted to be defective, and no
implementation measured here is: every one behaved exactly as its documentation says, and
`jq`'s refusal in Arm F is correct behaviour that a composition defeated. Arm E measures the
incidence of syntactic constructs in one public log; it is not a security review of Sigstore
or Rekor, not evidence that any construct was ever exploited, and a construct's presence says
nothing about whether any consumer distinguishes it. Rows marked unmeasured in Arm C are
unmeasured, and absence of a finding anywhere in this program is not evidence of absence in
practice.
