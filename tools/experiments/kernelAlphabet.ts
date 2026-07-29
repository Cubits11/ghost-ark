/**
 * E1 pathology alphabet — the pre-registered input alphabet for the provenance
 * kernel census.
 *
 * Each class supplies a pair of RAW JSON TEXTS that are distinct byte sequences,
 * plus a declared consumer intent fixed BEFORE any implementation was run. The
 * intent column is the pre-registration: it is what makes a collapse "unintended"
 * rather than merely "observed". Changing an intent to match a measured result
 * would void the experiment, and `tests/unit/experiments/kernelAlphabet.test.ts`
 * pins every intent value against tampering.
 *
 * Why raw text and not parsed values: the kernel of a receipt system is a property
 * of the whole `parse -> canonicalize -> digest` pipeline, not of the canonicalizer
 * alone. Several collapses below happen inside `JSON.parse`, before any Ghost-Ark
 * code executes. That is the point.
 *
 * NON-CLAIM: this alphabet is hand-curated and deliberately adversarial. It is not
 * a random sample of real-world JSON, it is not exhaustive over JSON pathologies,
 * and a class absent here is not evidence of absence. See EXPERIMENTS.md §E1 for
 * the stated coverage boundary.
 */

/**
 * What the declared consumer set does with the pair.
 *
 * - "distinct": at least one declared consumer must be able to tell the two raw
 *   documents apart. A canonicalizer that maps them to one digest has an
 *   UNINTENDED KERNEL MEMBER: the receipt cannot discriminate a difference that
 *   matters downstream.
 * - "equivalent": every declared consumer treats the two documents as the same
 *   fact. A canonicalizer that maps them to two digests OVER-DISCRIMINATES: the
 *   receipt reports a difference where none exists, which breaks re-verification
 *   of semantically unchanged evidence.
 */
export type ConsumerIntent = "distinct" | "equivalent";

export interface PathologyClass {
  /** Stable id; appears in reports and must not be renamed once published. */
  id: string;
  /** One-line description of the pathology. */
  description: string;
  /** Raw JSON text, side A. */
  rawA: string;
  /** Raw JSON text, side B. Must differ from rawA byte-for-byte. */
  rawB: string;
  /** PRE-REGISTERED. Declared before any run. Do not edit to fit a result. */
  intent: ConsumerIntent;
  /** Who distinguishes (or unifies) these, and why. Justifies `intent`. */
  consumerRationale: string;
}

export const PATHOLOGY_ALPHABET: readonly PathologyClass[] = [
  {
    id: "duplicate-key-last-wins",
    description: "Same key twice in one object; JSON.parse keeps the last occurrence.",
    rawA: '{"amount":1,"amount":2}',
    rawB: '{"amount":2}',
    intent: "distinct",
    consumerRationale:
      "An auditor reading the raw transmitted bytes sees a document that asserted 'amount' twice — a malformed or " +
      "tampered submission — versus a document that asserted it once. A dispute-resolution consumer must be able to " +
      "distinguish 'the sender sent contradictory fields' from 'the sender sent one field'."
  },
  {
    id: "integer-precision-loss",
    description: "Two integers above 2^53 that differ by 1 and share an IEEE-754 double.",
    rawA: '{"amount":9007199254740993}',
    rawB: '{"amount":9007199254740992}',
    intent: "distinct",
    consumerRationale:
      "These are different integers, one unit apart. Any ledger, billing, or quantity consumer distinguishes them. " +
      "A receipt that assigns both the same identity cannot evidence which amount was actually submitted."
  },
  {
    id: "decimal-literal-collapse",
    description: "Two distinct decimal literals that round to the same IEEE-754 double.",
    rawA: '{"rate":0.1}',
    rawB: '{"rate":0.1000000000000000055511151231257827}',
    intent: "distinct",
    consumerRationale:
      "The raw documents state different numeric literals. A consumer performing exact decimal arithmetic, or an " +
      "auditor comparing against a source system that stores decimals, distinguishes them."
  },
  {
    id: "non-finite-overflow",
    description: "Two distinct large exponents that both overflow to IEEE-754 Infinity.",
    rawA: '{"v":1e400}',
    rawB: '{"v":1e401}',
    intent: "distinct",
    consumerRationale:
      "Distinct numeric literals. A fail-closed rejection is the correct outcome here; a shared digest is not."
  },
  {
    id: "lone-surrogate-escape",
    description: "An unpaired UTF-16 surrogate escape versus the replacement character.",
    rawA: '{"v":"\\ud800"}',
    rawB: '{"v":"\\ufffd"}',
    intent: "distinct",
    consumerRationale:
      "A lone surrogate is not valid Unicode text; the replacement character is. A consumer that logs, indexes, or " +
      "re-emits the value distinguishes an ill-formed input from a well-formed one."
  },
  {
    id: "unicode-nfc-vs-nfd",
    description: "Same visible string in NFC versus NFD normalization form.",
    // EDITOR WARNING: rawA carries U+00E9 (precomposed); rawB carries 'e' + U+0301
    // (combining acute). They render identically. Do not retype or "tidy" these
    // literals — making them byte-identical would silently void the class.
    // assertAlphabetWellFormed() and the alphabet test both fail if that happens.
    rawA: '{"name":"café"}',
    rawB: '{"name":"café"}',
    intent: "equivalent",
    consumerRationale:
      "Every declared consumer — display, search, human review, name matching — treats these as the same name. " +
      "Two digests here means semantically unchanged evidence fails re-verification after any normalizing hop."
  },
  {
    id: "object-key-order",
    description: "Same key/value pairs emitted in different orders.",
    rawA: '{"a":1,"b":2}',
    rawB: '{"b":2,"a":1}',
    intent: "equivalent",
    consumerRationale:
      "JSON objects are unordered by RFC 8259. No declared consumer depends on member order, so collapsing these is " +
      "the intended behavior and is the reason canonicalization exists at all."
  },
  {
    id: "insignificant-whitespace",
    description: "Identical structure differing only in insignificant whitespace.",
    rawA: '{"a": 1, "b": [2, 3]}',
    rawB: '{"a":1,"b":[2,3]}',
    intent: "equivalent",
    consumerRationale: "Whitespace outside strings carries no JSON meaning; every consumer treats these as one document."
  },
  {
    id: "escaped-vs-literal-char",
    description: "A character written as a \\u escape versus written literally.",
    rawA: '{"v":"\\u0041"}',
    rawB: '{"v":"A"}',
    intent: "equivalent",
    consumerRationale: "Both encode the single character 'A'. No consumer distinguishes the wire escaping of an identical string."
  },
  {
    id: "numeric-exponent-form",
    description: "The same numeric value written in exponent versus plain form.",
    rawA: '{"v":1e2}',
    rawB: '{"v":100}',
    intent: "equivalent",
    consumerRationale: "Both denote the number 100 exactly. Arithmetic consumers treat them as one value."
  },
  {
    id: "negative-zero",
    description: "Negative zero versus positive zero.",
    rawA: '{"v":-0}',
    rawB: '{"v":0}',
    intent: "equivalent",
    consumerRationale:
      "IEEE-754 defines -0 == 0, and no declared Ghost-Ark consumer branches on the sign of zero. Collapsing is intended."
  },
  {
    id: "string-vs-number-type",
    description: "The same digits as a JSON string versus a JSON number.",
    rawA: '{"v":"100"}',
    rawB: '{"v":100}',
    intent: "distinct",
    consumerRationale:
      "Type is semantic: a schema validator, a typed deserializer, and a database column all distinguish the string " +
      '"100" from the number 100. A shared digest would let a type-confusion payload inherit a valid identity.'
  }
] as const;

/** Sanity invariants the alphabet must satisfy; asserted by tests and by the runner. */
export function assertAlphabetWellFormed(alphabet: readonly PathologyClass[] = PATHOLOGY_ALPHABET): void {
  const seen = new Set<string>();
  for (const entry of alphabet) {
    if (seen.has(entry.id)) {
      throw new Error(`ghost_ark.e1: duplicate pathology id ${entry.id}`);
    }
    seen.add(entry.id);

    if (entry.rawA === entry.rawB) {
      throw new Error(`ghost_ark.e1: pathology ${entry.id} has identical rawA and rawB; the pair must be byte-distinct.`);
    }
  }
}
