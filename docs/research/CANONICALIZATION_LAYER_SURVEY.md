# The canonicalization layer survey — Arm C of the Observability Gap program

Tier: **supporting**. Opened and first measured 2026-08-12.

Arm C of [OBSERVABILITY_GAP_PROGRAM.md](./OBSERVABILITY_GAP_PROGRAM.md). The claim under test:
the JCS layering gap is an instance, not an accident.

Every row below answers the same three questions — *what layer is the requirement defined
over*, *what does it forbid*, *can a conforming implementation observe a violation* — and
every row carries either a runnable probe against a real implementation or the word
**unmeasured**. No row gets an opinion.

---

## What measurement did to the thesis before any table was drawn

Two things happened in the first probe run, and both narrow the claim. They are stated
before the table because a reader who takes the table at face value will take it
further than it goes.

### The strong form of the thesis is false, and the CBOR probe is what falsified it

The program document states the thesis as: a standard defined over parsed values "can forbid
conditions no conforming implementation is able to observe."

That is too strong. Measured against `ciborium` 0.2.2, **one library exhibits all three
behaviours RFC 8949 permits for a duplicate map key, and which one you get is selected by
the consumer's decode target rather than by the codec**:

| decode target | result for the octets `A2 61 61 01 61 61 02` (a map with `"a"` twice) |
|:---|:---|
| `Value` (structure-preserving) | `Map([(Text("a"), 1), (Text("a"), 2)])` — both pairs kept, **duplicate observable** |
| `BTreeMap` / `HashMap` | `{"a": 2}` — last wins, duplicate destroyed, no error |
| `#[derive(Deserialize)]` struct | `Err(Semantic(None, "duplicate field \`a\`"))` — **rejected** |

So observability is not a property of the standard, and it is not a property of the codec.
It is a property of **the type the consumer decodes into**. The honest form of the claim is:

> A requirement stated over a layer above the one an implementation reads is not observable
> *at that implementation's chosen decode target*. Whether any conforming implementation can
> observe it depends on whether the ecosystem offers a structure-preserving target, and
> whether anyone uses it.

That is weaker, and it is what the evidence supports. It also explains the JCS result rather
than contradicting it: RFC 8785 §3.2.3 takes an already-parsed object, and a caller handed
only a parsed object has already chosen the lossy target.

### An alternative explanation this arm cannot rule out

The competing hypothesis is that the explanatory variable is not *layer* but
**schema-boundness**. DER is clean partly because ASN.1's type system forbids duplicate
members structurally — a `SEQUENCE` has named, typed components, so "the same field twice"
is not expressible. JSON, JSON-LD, and XML are schemaless at verification time. Protobuf's
difficulty is with *unknown* fields, which is schema incompleteness.

A reviewer can argue the layer story is an epiphenomenon of schema-boundness and that this
table was selected to make layers look causal. Breaking that confound needs a row that is
same-layer-but-schemaless, or schema-bound-but-cross-layer. **This survey has neither, so the
confound stands unresolved and the layer account is one of two live explanations, not the
established one.**

---

## The table

| Standard | Defined over | Forbids / requires | Observable at that layer? | Evidence |
|:---|:---|:---|:---|:---|
| RFC 8785 (JCS) §3.1 | a parsed value (§3.2.3) | duplicate property names | **No**, for a caller handed a parsed object | measured — [JCS_CANONICALIZER_PROBE.md](./JCS_CANONICALIZER_PROBE.md) |
| RFC 8949 §5.6 (CBOR) | the decoded map | duplicate map keys | **Depends on the decode target** — yes into `Value`, no into `BTreeMap` | measured — ciborium 0.2.2, cbor2 6.1.4 |
| RFC 8949 §4.2.1 (CBOR) | the encoded octets | preferred serialization, definite lengths, bytewise-sorted keys | **Yes** — re-encode-and-compare works | measured |
| Protobuf deterministic serialization | an in-memory message | nothing; explicitly not canonical across builds | **unmeasured** | not probed |
| RDFC-1.0 (JSON-LD) | an abstract RDF dataset | — | **unmeasured**; the JSON→RDF step discards duplicate keys, key order and number precision *before* canonicalization begins | not probed |
| XML C14N + XML Signature | a node-set from a parse | — | **No**, and this is documented in the standard itself since 2002 | prior art, cited below |
| DER (ITU-T X.690) | **the octets themselves** | minimal integer encoding (§8.3.2), minimum-length length octets (§8.1.3) | **Yes** — and *not* observable after a parse | measured — the control arm |

---

## DER is the control, and it behaves as the thesis predicts

This repository's own rule is that a detection rate with no control arm means nothing: a
survey finding every standard unsound has probably found a definition of "unsound" that
everything meets. DER is defined over octets rather than over a parsed value, so if the
layer account has content, DER is the row where the gap should not appear.

**Measured, on 2026-08-12.** One real ECDSA P-256 / SHA-256 signature, plus seven variants
that are valid BER and invalid DER. Every variant BER-decodes to the *identical* `(r, s)`
pair — asserted in the probe, not assumed.

| variant | violation | OpenSSL 3.6.2 | Node 22.22.3 | Java 23.0.1 SunEC | octet-layer checker |
|:---|:---|:---|:---|:---|:---|
| original | — (conformant) | ACCEPT | ACCEPT | ACCEPT | PASS |
| superfluous `0x00` on `r` | X.690 §8.3.2 | REJECT | REJECT | REJECT | FLAGGED |
| superfluous `0x00` on `s` | X.690 §8.3.2 | REJECT | REJECT | REJECT | FLAGGED |
| SEQUENCE length in long form | X.690 §8.1.3.3 | REJECT | REJECT | REJECT | FLAGGED |
| INTEGER length in long form | X.690 §8.1.3.3 | REJECT | REJECT | REJECT | FLAGGED |
| SEQUENCE length zero-padded | X.690 §8.1.3.5 | REJECT | REJECT | REJECT | FLAGGED |
| trailing octet after SEQUENCE | not a minimality rule | REJECT | REJECT | REJECT | FLAGGED |
| indefinite length | X.690 §8.1.3.6 | REJECT | REJECT | REJECT | FLAGGED |

**The half that carries the argument is the dual.** After a permissive parse to `(r, s)`, all
eight variants re-encode to *one* canonical byte string. A checker handed only the parsed
value receives byte-identical input for the conformant signature and for every violation. The
non-minimality is not hidden from it; **it no longer exists in its input**. Parsing is the
lossy step, and that is the thesis stated on the row where the thesis predicts safety.

Three findings against the tidy version of this result, recorded because they cost the row
some of its force:

- **Two independent verifiers, not three.** Node 22.22.3 links OpenSSL 3.5.6 and the CLI is
  3.6.2 — same codebase lineage. Java's SunEC is the only genuinely independent stack
  measured.
- **`openssl asn1parse` is not a reliable detector.** It flags a non-minimal INTEGER as
  `BAD INTEGER`, and is completely silent, at exit 0, on non-minimal *length* octets and on
  indefinite length. An auditor using it as a DER checker would pass three of the five
  minimality violations above.
- **No permissive verifier was measured.** Python `cryptography`, `ecdsa`, and `asn1crypto`
  were all absent from the machine, and no ASN.1 package was installed under npm. Only the
  probe's own BER reader demonstrates that a parser *can* accept these. That historically
  permissive stacks exist is the entire reason Bitcoin's BIP-66 ("Strict DER signatures")
  was written, but **that is citation, not measurement**, and this arm did not reproduce it.
- **The rejection mechanism is unmeasured.** Whether OpenSSL refuses at parse time or by
  re-encode-and-compare afterwards was not determined; no source was read.

**An inconsistency this arm has not resolved.** X.690 defines *two* canonical restrictions of
BER — CER and DER. That is the same multiplicity the CBOR row below treats as a finding.
Holding DER up as the clean control while counting CBOR's two orderings against it is not
obviously consistent, and CER is not addressed anywhere in this survey.

---

## CBOR: the JCS shape, one layer down, plus two canonical forms

**Measured** against `ciborium` 0.2.2 (Rust, crates.io) and `cbor2` 6.1.4 (Python, C
extension), on hand-written octets. No CBOR codec was written for this probe; the libraries
only decode and re-encode bytes supplied to them.

**The kernel collapse reproduces.** With a canonicalizing decode target, in both libraries
independently:

```
canonical(A2 61 61 01 61 61 02)   ==   A1 61 61 02       # {"a":1,"a":2}
canonical(A1 61 61 02)            ==   A1 61 61 02       # {"a":2}
```

Two distinct well-formed wire messages, one canonical output. Anything assigning identity by
digesting the canonical form cannot tell them apart. This is the same shape the JCS probe
found, in a different format, at a different layer.

**Where duplicate detection actually lives.** A canonical checker built as
re-encode-and-compare never tests §5.6 at all:

- over a structure-preserving target the duplicate round-trips byte-for-byte, so the checker
  **accepts** invalid-but-well-formed input;
- over a canonicalizing target the duplicate is destroyed *before* the comparison, so the
  checker rejects but cannot report the cause and cannot separate it from any other
  non-canonical input.

Detection exists at the encoding layer only as a side effect of enforcing **strictly**
increasing bytewise key order over the encoded keys. Measured on the duplicate: non-strict
`<=` holds, strict `<` fails. A checker written with `<=` instead of `<` loses duplicate
detection silently, and nothing in its output would say so.

**Two canonical forms, demonstrated.** The same abstract map has two distinct canonical
octet strings under §4.2.1 (bytewise) and §4.2.3 (length-first, inherited from RFC 7049):

```
{1000000: 1, "abc": 2}
  §4.2.1 bytewise      A2 1A 00 0F 42 40 01 63 61 62 63 02
  §4.2.3 length-first  A2 63 61 62 63 02 1A 00 0F 42 40 01
```

And the sharper result: **both libraries' canonical modes emit the length-first form**, which
is the §4.2.3 alternative rather than §4.2.1's core requirement.

Two corrections recorded against this row, one of them to this survey's own premise:

- **The `"z"` vs `"aa"` example does not diverge.** For text strings shorter than 24 bytes the
  head byte is `0x60 + len`, so bytewise ordering is *already* length-first. Divergence needs
  a pair crossing major types or the 24-byte boundary, which is why the pair above mixes an
  integer with a text string. The obvious example is wrong and was measured to be wrong.
- **Two libraries agreeing is not a deployment finding.** Both document the behaviour, and
  §4.2.3 is blessed by the RFC for RFC 7049 compatibility. The defensible statement is an
  interop hazard — a §4.2.1-conformant verifier rejects everything these two emit — and that
  needs more than n = 2 plus evidence that §4.2.1 is deployed anywhere. Neither exists here.

---

## XML Signature is prior art, and it states the thesis normatively

This must be cited rather than rediscovered. The signature-wrapping family — where the signed
canonical form and the consumed parse tree are selected by different mechanisms — is a
documented body of work with real CVEs across SAML and WS-Security.

**The standard says it itself.** W3C XML Signature Syntax and Processing, Security
Considerations §8.1.1, *"Only What is Signed is Secure"*:

> "When transforms are applied the signer is not signing the native (original) document but
> the resulting (transformed) document."

Its siblings are §8.1.2 *"Only What is 'Seen' Should be Signed"* and §8.1.3 *"'See' What is
Signed"*. Section headings and text verified against the W3C Recommendation on 2026-08-12.

That is this program's thesis, for XML, in a W3C Recommendation, roughly two decades old.
Arm C's contribution is not noticing that XML had this problem.

Supporting literature, verified:

- Momot, Bratus, Hallberg, Patterson, *The Seven Turrets of Babel: A Taxonomy of LangSec
  Errors and How to Expunge Them*, IEEE SecDev 2016, pp. 45–52 — names **parser
  differentials** as a taxonomy entry: two or more components of a system failing to
  interpret input equivalently.
- McIntosh & Austel, *XML signature element wrapping attacks and countermeasures*, ACM
  Workshop on Secure Web Services, 2005.
- Somorovsky et al., *On Breaking SAML: Be Whoever You Want to Be*, USENIX Security 2012.
  *(Bibliographic record verified via DBLP; the paper itself was not retrieved, so the page
  range is unconfirmed here.)*

---

## Novelty, stated against interest

**The general claim is not novel, and this survey should not be written as though it were.**

- XMLDSig §8.1.1 states the consequence normatively in a W3C Recommendation.
- Momot et al. named parser differentials as a weakness class in 2016.
- **Concurrent work exists.** Arslan Brömme, *Canonicalization Failures as a Recurring
  Vulnerability Class: Representation Divergence in Cryptographic Systems and Its Avoidance*,
  arXiv:2608.06508, submitted **2026-08-06** — six days before this program was opened. Its
  abstract systematizes failures previously known under separate names (transaction
  malleability, message malleability) as instances of violated uniqueness conditions, and
  proposes a canonicalization review procedure. *Existence, title, author and date verified
  2026-08-12; the paper itself has been read only in abstract, so the exact overlap with this
  survey is not yet established and no claim about the relationship should be made until it
  is.*

What is left that this program can honestly offer:

1. **The prevalence measurement** ([EXPERIMENTS.md §E12](./EXPERIMENTS.md)). Incidence data
   for these constructs in real supply-chain attestation payloads. A measurement, not a
   theory.
2. **A per-requirement layer table.** Cut per *requirement* rather than per *standard* —
   RFC 8949 already breaks the per-standard framing by having §4.2.1 land on one side of the
   line and §5.6 on the other.
3. **Non-compositionality across pipeline hops** ([EXPERIMENTS.md §E13](./EXPERIMENTS.md)).
   The one claim in this program not found anticipated in the prior art assembled here.

A survey that concedes the general shape is known and then contributes prevalence data is
worth writing. One that claims a new vulnerability class is not.

---

## What is unmeasured, listed so a reader does not mistake silence for a finding

- **Protobuf.** The upstream non-guarantee was not read at source; no probe was run.
- **RDFC-1.0 / JSON-LD.** Specification sections were truncated in every retrieval attempt.
  The interesting question — whether the JSON→RDF conversion drops duplicate keys, key order,
  and number precision *before* canonicalization begins, making it the same gap shape one
  step earlier — is stated as a question and is **not** answered.
- **CER**, the other canonical restriction in X.690.
- **JWS (RFC 7515) and COSE (RFC 9052)**, the JSON-family and CBOR-family standards that
  avoid this entire problem by signing octets and not canonicalizing at all. Their absence is
  a real gap: a survey about canonicalization that omits the deployed standards which got it
  right reads as constructed to a conclusion.
- **Whether any real consumer distinguishes any of these pairs.** Every "distinct" intent in
  this work is a declared consumer model, not an observed one.

---

**NON-CLAIM.** This survey reports where specifications place their requirements and what
particular implementations did with particular inputs on one machine on one day. It is not a
security review of any standard or library; not a statement that any standard, implementation,
or deployment is defective — every implementation measured here behaves as its documentation
says; and not evidence about semantic safety, compliance, model behaviour, or the correctness
of any system. Rows marked unmeasured are unmeasured, and absence of a finding in this table
is not evidence of absence in practice.
