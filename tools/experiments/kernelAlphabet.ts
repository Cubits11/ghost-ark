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
  },

  // ---------------------------------------------------------------------------
  // Expansion added 2026-07-29 to widen the coverage boundary that falsifier F2
  // attacks ("the alphabet is curated, so the finding may be an artifact of what
  // the author chose to look at"). Breadth is the only honest answer to that, and
  // every intent below was declared before the arms were re-run.
  // ---------------------------------------------------------------------------

  {
    id: "nested-duplicate-key-in-array",
    description: "Duplicate key inside an object nested within an array.",
    rawA: '{"items":[{"qty":1,"qty":2}]}',
    rawB: '{"items":[{"qty":2}]}',
    intent: "distinct",
    consumerRationale:
      "Same reasoning as duplicate-key-last-wins, but nested two levels deep. A guard that only inspects top-level " +
      "keys would pass this while leaving the collapse fully exploitable, so depth coverage is load-bearing."
  },
  {
    id: "duplicate-empty-key",
    description: "The empty-string key repeated.",
    rawA: '{"":1,"":2}',
    rawB: '{"":2}',
    intent: "distinct",
    consumerRationale:
      'The empty string is a legal JSON key. A duplicate-key guard that special-cases or skips "" would leave a ' +
      "bypass, so the degenerate key name is checked explicitly."
  },
  {
    id: "proto-literal-key",
    description: "A literal __proto__ key alongside ordinary data.",
    rawA: '{"a":1,"__proto__":2}',
    rawB: '{"a":1}',
    intent: "distinct",
    consumerRationale:
      "JSON.parse creates __proto__ as an ordinary own property rather than invoking the prototype setter, so the two " +
      "documents genuinely differ in content. A consumer that later spreads or deep-merges this object distinguishes " +
      "them sharply, since one carries a key that can poison a prototype chain downstream."
  },
  {
    id: "array-element-order",
    description: "The same array elements in a different order.",
    rawA: '{"v":[1,2]}',
    rawB: '{"v":[2,1]}',
    intent: "distinct",
    consumerRationale:
      "JSON arrays are ordered by RFC 8259, unlike objects. A canonicalizer that sorted array elements the way it " +
      "sorts object keys would destroy meaning; this class exists to catch that specific over-reach."
  },
  {
    id: "null-vs-absent-key",
    description: "An explicit null value versus the key being absent.",
    rawA: '{"a":null}',
    rawB: "{}",
    intent: "distinct",
    consumerRationale:
      '"the field was supplied and is empty" and "the field was never supplied" are different assertions. Patch ' +
      "semantics, schema validation, and audit review all distinguish them."
  },
  {
    id: "false-vs-zero",
    description: "Boolean false versus numeric zero.",
    rawA: '{"a":false}',
    rawB: '{"a":0}',
    intent: "distinct",
    consumerRationale:
      "Type confusion between false and 0 is a classic source of authorization bugs. Any typed consumer distinguishes them."
  },
  {
    id: "empty-string-vs-null",
    description: "The empty string versus null.",
    rawA: '{"a":""}',
    rawB: '{"a":null}',
    intent: "distinct",
    consumerRationale: "An empty value and an absent value are different facts to every schema and every reviewer."
  },
  {
    id: "float-vs-integer-same-value",
    description: "1.0 written as a float versus as an integer.",
    rawA: '{"v":1.0}',
    rawB: '{"v":1}',
    intent: "equivalent",
    consumerRationale:
      "Both denote exactly the number one. JSON draws no int/float distinction, and no declared consumer branches on " +
      "whether a whole number was spelled with a decimal point."
  },
  {
    id: "trailing-zero-fraction",
    description: "A fractional part padded with trailing zeros.",
    rawA: '{"v":1.50}',
    rawB: '{"v":1.5}',
    intent: "equivalent",
    consumerRationale: "Identical value; the padding carries no information a consumer reads."
  },
  {
    id: "plus-signed-exponent",
    description: "An exponent written with an explicit plus sign.",
    rawA: '{"v":1e+2}',
    rawB: '{"v":1e2}',
    intent: "equivalent",
    consumerRationale: "Both denote 100 exactly. The sign on a positive exponent is syntax, not content."
  },
  {
    id: "uppercase-exponent-marker",
    description: "Exponent marker written as E rather than e.",
    rawA: '{"v":1E2}',
    rawB: '{"v":1e2}',
    intent: "equivalent",
    consumerRationale: "RFC 8259 permits either marker for the same value; no consumer distinguishes the letter case."
  },
  {
    id: "escaped-solidus",
    description: "A forward slash escaped versus written literally.",
    rawA: '{"v":"a\\/b"}',
    rawB: '{"v":"a/b"}',
    intent: "equivalent",
    consumerRationale: "Escaping the solidus is optional in JSON and decodes to the identical string."
  },
  {
    id: "escape-hex-case",
    description: "A \\u escape with uppercase versus lowercase hex digits.",
    rawA: '{"v":"\\u00E9"}',
    rawB: '{"v":"\\u00e9"}',
    intent: "equivalent",
    consumerRationale: "Both escapes denote U+00E9. Hex digit case is wire syntax and decodes identically."
  },
  {
    id: "surrogate-pair-vs-literal-astral",
    description: "An astral-plane character as an escaped surrogate pair versus written literally.",
    // EDITOR WARNING: rawB carries a literal U+1F600. Do not replace it with an escape.
    rawA: '{"v":"\\ud83d\\ude00"}',
    rawB: '{"v":"😀"}',
    intent: "equivalent",
    consumerRationale:
      "Both encode exactly U+1F600. A consumer displaying, indexing, or re-emitting the value cannot distinguish the " +
      "wire escaping of an identical character."
  },
  {
    id: "key-order-non-ascii",
    description: "Key order permuted where one key is non-ASCII.",
    rawA: '{"é":1,"a":2}',
    rawB: '{"a":2,"é":1}',
    intent: "equivalent",
    consumerRationale:
      "Objects are unordered, so this must collapse. It is separated from object-key-order because sorting stability " +
      "across non-ASCII keys depends on whether the implementation compares UTF-16 code units or UTF-8 bytes, and the " +
      "two orders differ for some key sets."
  },
  {
    id: "safe-integer-neighbours",
    description: "Two adjacent integers just inside the safe range.",
    rawA: '{"v":9007199254740991}',
    rawB: '{"v":9007199254740990}',
    intent: "distinct",
    consumerRationale:
      "The positive control for integer-precision-loss. These are one apart at 2^53-1 and 2^53-2, both exactly " +
      "representable, so they MUST stay distinct. If the safe-range boundary were set one value too low they would " +
      "collapse, and this class would catch that."
  },
  {
    id: "deep-nesting-depth",
    description: "Nesting depth 200 versus 201.",
    rawA: `${"[".repeat(200)}1${"]".repeat(200)}`,
    rawB: `${"[".repeat(201)}1${"]".repeat(201)}`,
    intent: "distinct",
    consumerRationale:
      "Different structures. Included to detect a depth limit that silently truncates rather than rejecting, which " +
      "would map two different documents onto one identity."
  },
  {
    id: "large-document-single-byte",
    description: "Two ~64 KiB documents differing in one byte near the end.",
    rawA: `{"pad":"${"x".repeat(65536)}","tail":"a"}`,
    rawB: `{"pad":"${"x".repeat(65536)}","tail":"b"}`,
    intent: "distinct",
    consumerRationale:
      "Detects any size-based truncation or sampling in the hash path. A digest computed over a prefix would collapse " +
      "these two, which is the classic length-extension-adjacent failure for evidence systems."
  },
  {
    id: "leading-zero-integer",
    description: "An integer with a leading zero, which RFC 8259 forbids.",
    rawA: '{"v":01}',
    rawB: '{"v":1}',
    intent: "distinct",
    consumerRationale:
      "rawA is not valid JSON. A strict parser must reject it; a lenient one that accepts it and coerces to 1 would " +
      "give malformed input the identity of a well-formed document."
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
