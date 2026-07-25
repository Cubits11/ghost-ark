# The Provenance Kernel Problem

**Status:** research note. Formal statement, proof, and an executable
demonstration against this repository's own canonicalizer.
**Evidence class:** local — the theorem is elementary and self-contained; the
demonstration is [`tests/differential/provenanceKernel.test.ts`](../../tests/differential/provenanceKernel.test.ts)
(9 tests). No deployment or external validation is claimed.

---

## 0. The claim in one paragraph

Digital signatures are applied not to documents but to *canonical byte strings*
derived from them. The derivation is many-to-one, so every signature covers an
equivalence class of documents, not a document. Call that class structure the
**kernel** of the canonicalizer. Some of the kernel is intended — key ordering
must not change a signature — and some is not. The unintended part is where one
signature authorises two documents that downstream systems read differently.
This note shows that the unintended part is **not a fixed property of the
canonicalizer**: it can grow while the canonicalizer's code, specification, and
behaviour remain byte-for-byte unchanged, because it is defined jointly by the
canonicalizer *and* by a population of consumers that evolves independently.
Consequently a soundness proof about a canonicalizer is a statement with a
**scope that expires**, and a proof that does not declare its scope is not
merely incomplete — it is unindexed.

## 1. Why this matters before the formalism

The practical question a receipt is supposed to answer is: *what exactly was
authorised?* If the answer is "one of these two documents, and the verifier
cannot tell you which," then the receipt has silently weakened from an
authorisation of a fact to an authorisation of an ambiguity. Every mechanism in
this repository — the digest binding, the signature envelope, the chain — sits
downstream of canonicalization and therefore inherits its kernel exactly. No
amount of cryptographic strength above the canonicalizer can recover a
distinction the canonicalizer erased below it.

## 2. Definitions

Let:

- $\Sigma$ be an alphabet, and $D_\Sigma$ the set of well-formed documents over $\Sigma$.
- $C : D_\Sigma \to B$ be a **canonicalizer** into byte strings $B$. This is the
  function whose output is hashed and signed.
- $P$ be a set of **consumers**. Each $p \in P$ has an interpretation
  $[\![\cdot]\!]_p : D_\Sigma \to M_p$ mapping documents to whatever that
  consumer acts on (a parsed value, a policy decision, a ledger entry).

**Kernel.** The kernel of $C$ is the induced equivalence:

$$\ker(C,\Sigma) \;=\; \{\,(x,y) \in D_\Sigma^2 \;:\; x \neq y,\; C(x) = C(y)\,\}$$

**Intended kernel.** Relative to a consumer population $P$:

$$I(\Sigma, P) \;=\; \{\,(x,y) \;:\; \forall p \in P,\; [\![x]\!]_p = [\![y]\!]_p \,\}$$

That is: pairs every consumer agrees are the same. Key reordering belongs here.

**Unintended kernel.** The dangerous residue:

$$U(C, \Sigma, P) \;=\; \ker(C,\Sigma) \;\setminus\; I(\Sigma, P)$$

A pair in $U$ is a single signature covering two documents that *some* consumer
distinguishes. The verifier cannot report which was authorised, because by
construction it never saw the difference.

**Soundness.** $\mathrm{Sound}(C,\Sigma,P) \iff U(C,\Sigma,P) = \varnothing$.

Note the arity. Soundness is a **ternary** predicate. Almost every informal
claim of the form "our canonicalizer is sound" silently projects it to unary.
That projection is the error this note is about.

## 3. Results

### Lemma 1 (Kernel monotonicity in the alphabet)

If $\Sigma \subseteq \Sigma'$ and $C$ agrees with $C'$ on $D_\Sigma$, then
$\ker(C,\Sigma) \subseteq \ker(C',\Sigma')$.

*Proof.* $D_\Sigma \subseteq D_{\Sigma'}$ and $C' |_{D_\Sigma} = C$. Any pair
$(x,y)$ with $x \neq y$ and $C(x) = C(y)$ therefore satisfies
$C'(x) = C'(y)$ and remains in $D_{\Sigma'}^2$. $\square$

Elementary, but it fixes the direction of travel: admitting new documents can
only add collisions, never remove them. There is no alphabet growth that
*repairs* a kernel.

### Lemma 2 (Intended kernel is antitone in the consumer population)

If $P \subseteq P'$ then $I(\Sigma,P') \subseteq I(\Sigma,P)$.

*Proof.* $I$ is defined by a universal quantifier over $P$. Enlarging the
quantification domain can only remove pairs. $\square$

### Theorem (Non-persistence of canonicalizer soundness)

$\mathrm{Sound}(C,\Sigma,P)$ does not imply $\mathrm{Sound}(C,\Sigma',P')$ for
$\Sigma \subseteq \Sigma'$, $P \subseteq P'$ — **even when $C$ is unchanged**.

*Proof.* By Lemmas 1 and 2, $U(C,\Sigma',P') \supseteq U(C,\Sigma,P)$, and the
inclusion is strict in general. Two independent witnesses, both realised in
this repository's canonicalizer and executed in the accompanying test:

**(a) Growth by alphabet.** Restrict $\Sigma$ to documents whose numeric values
are integers below $2^{53}$. Over that domain the canonicalizer separates every
distinct integer, and no unintended numeric collision exists. Extend $\Sigma'$
to admit larger integer literals — an ordinary, spec-legal extension. Then

$$C(\{\texttt{"amount":10000000000000001}\}) = C(\{\texttt{"amount":10000000000000000}\})$$

because IEEE-754 double parsing identifies them before $C$ observes them. Any
consumer with an arbitrary-precision integer reader distinguishes the two, so
the pair lies in $U(C,\Sigma',P)$. One signature, two amounts.

**(b) Growth by consumer population — the sharper case.** Fix $\Sigma$ and fix
$C$ entirely. Let $P$ contain only JavaScript consumers. RFC 8259 leaves
duplicate object names *undefined*; JavaScript resolves last-wins, so for every
JS consumer $[\![\{\texttt{"a":1,"a":2}\}]\!] = [\![\{\texttt{"a":2}\}]\!]$ and
the colliding pair sits in $I$ — intended, harmless. Now admit one consumer
$p'$ whose parser is first-wins or duplicate-rejecting. By Lemma 2 the pair
leaves $I$ and enters $U$. **Nothing about $C$ changed. No byte of the
canonicalizer, its specification, or its test suite changed.** A soundness proof
discharged before $p'$ joined is now false, and no observation of $C$ could have
detected the transition. $\square$

### Corollary (Proof indexing)

A soundness certificate for a canonicalizer must be indexed by the pair
$(\Sigma, P)$ it was discharged over. An unindexed certificate asserts a
property over a domain that is not fixed at the time of assertion.

### Corollary (Insufficiency of static verification)

No verification performed solely on $C$ — type checking, property testing,
formal proof of the canonicalization algorithm, differential testing between
implementations — can establish $\mathrm{Sound}$, because $\mathrm{Sound}$
depends on $P$, which is not a property of $C$ and is not available to any
analysis of $C$. Static soundness proofs are therefore **structurally
insufficient**, not merely incomplete in practice.

## 4. What this is *not*

Honest positioning matters more than impressive framing:

- **It is not an impossibility theorem** in the sense of Rice or Gödel. Nothing
  here says a sound canonicalizer cannot exist. For a *fixed, declared*
  $(\Sigma, P)$, soundness is often decidable and sometimes trivial.
- **It is not novel mathematics.** Lemmas 1 and 2 are one line each. The
  contribution, if any, is the *framing*: recognising that the soundness
  predicate of a signing preimage is ternary, that its third argument is
  adversarially and silently mutable, and that this is the mechanism behind a
  known family of vulnerabilities rather than a collection of unrelated bugs.
- **It does not claim Ghost-Ark is broken.** The receipt path hashes bytes the
  gateway itself produced from values it parsed, which closes most of the gap.
  But that closure is an *argument about callers*, not a property of $C$ — and
  an argument about callers is precisely what a static proof cannot carry
  forward. The point is where the obligation lives, not that it is unmet.

## 5. Relation to known vulnerability classes

The theorem organises a set of bugs usually catalogued separately, by showing
they are all instances of $U$ becoming non-empty:

| Instance | Mechanism | Which lemma |
|:---|:---|:---|
| JSON parser differentials / duplicate keys | consumers disagree on undefined behaviour | Lemma 2 |
| Integer precision loss above $2^{53}$ | alphabet admits values the encoding folds | Lemma 1 |
| Unicode normalisation and confusables | alphabet growth introduces identifications | Lemma 1 |
| XML signature wrapping | canonicalization scope differs from consumption scope | Lemma 2 |
| Content-type / charset confusion | interpretation varies by consumer configuration | Lemma 2 |

The predictive content is the direction: these classes should be expected to
*recur* whenever an alphabet or a consumer population grows, and no fix to a
past instance prevents a future one.

## 6. Consequences adopted in this repository

1. **Declare the scope.** The canonicalizer states that it is Ghost-Ark
   canonical JSON and explicitly **not** RFC 8785 / JCS. Under the corollary
   this is not modesty, it is the index on the claim.
2. **Demonstrate the kernel, do not assert its emptiness.**
   [`provenanceKernel.test.ts`](../../tests/differential/provenanceKernel.test.ts)
   exhibits both intended and unintended members and pins them, so a change in
   the kernel shows up as a failing test rather than as silence.
3. **Push the obligation to where it can be discharged.** Because $P$ is not
   observable from $C$, the honest control is to constrain the input domain at
   ingest (the gateway hashes bytes it produced) and to state that constraint as
   a precondition of any soundness statement.
4. **Treat "we proved it sound" as having a shelf life**, and re-index it when
   the schema, the alphabet, or the set of consuming implementations changes.

## 7. Open questions

- Is there a useful *sufficient* condition on $C$ that makes $U$ empty for all
  $P$ drawn from a declared class of parsers (say, all RFC 8259-conformant
  ones)? This would trade the ternary predicate for a binary one over a
  quantified consumer class.
- Can $U$ be made *observable* — e.g. by shipping a differential harness that
  runs a candidate document through $n$ real parsers and reports divergence
  before signing? This converts an unfalsifiable claim into a monitored one.
- Does the same structure apply to embedding-based provenance (where $[\![\cdot]\!]$
  is a learned model and therefore mutable by retraining)? Conjecture: yes, and
  worse, because $P$ changes without any human decision.

## 8. Non-claims

This note does not prove that any specific deployed system is exploitable, does
not claim novelty of the underlying lemmas, does not claim RFC 8785 compliance
for any implementation discussed, and does not establish AI safety, semantic
correctness, or production readiness of anything. It formalises one structural
observation and demonstrates it on one canonicalizer.
