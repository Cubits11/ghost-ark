/**
 * Strict JSON admission control — a text-level guard that runs BEFORE JSON.parse.
 *
 * Why this module exists
 * ----------------------
 * Experiment E1 (`tools/experiments/e1KernelCensus.ts`) found three unintended kernel
 * members in Ghost-Ark's own `parse -> canonicalize -> digest` pipeline: two byte-distinct
 * JSON documents receiving the SAME receipt identity, where a declared consumer
 * distinguishes them.
 *
 *   {"amount":1,"amount":2}                        vs  {"amount":2}
 *   {"amount":9007199254740993}                    vs  {"amount":9007199254740992}
 *   {"rate":0.1}                                   vs  {"rate":0.1000000000000000055511151231257827}
 *
 * Critically, **none of these collapses happen in the canonicalizer.** They happen inside
 * `JSON.parse`: duplicate keys are silently resolved last-wins, and numeric literals are
 * rounded to the nearest IEEE-754 double. By the time `canonicalize()` sees a value, the
 * distinction is already gone. No amount of auditing the canonicalizer can recover it.
 *
 * So the fix cannot live in the canonicalizer. It has to inspect the raw text.
 *
 * Design constraints
 * ------------------
 * 1. **Additive only.** This module does NOT change `canonicalize()`. Receipt v1 identities
 *    and every existing signature remain byte-identical. This is admission control at the
 *    trust boundary, applied to untrusted input before it becomes a receipt payload — not a
 *    change to how anything is canonicalized or signed.
 * 2. **Fail closed.** A document that asserts a distinction the receipt cannot carry is
 *    REJECTED, not silently flattened. Refusing to issue an identity is always safe;
 *    issuing a false shared identity is not.
 * 3. **No new dependencies.** Hand-written scanner over the text.
 *
 * The three rules, and why each boundary is where it is
 * ----------------------------------------------------
 * R1 — duplicate object keys are rejected at any depth. `{"a":1,"a":2}` is a document that
 *      asserted `a` twice. A dispute-resolution consumer must be able to tell that apart
 *      from a document that asserted it once, and last-wins destroys the difference.
 *
 * R2 — integer literals with magnitude above Number.MAX_SAFE_INTEGER (2^53 - 1) are
 *      rejected. Above that boundary distinct integers share a double, so a ledger,
 *      billing, or quantity consumer cannot recover which value was submitted.
 *
 * R3 — numeric literals with more than 17 significant digits are rejected. 17 is the
 *      round-trip precision of an IEEE-754 double: beyond it, the text asserts precision
 *      the receipt provably cannot carry.
 *
 *      Note carefully what R3 does NOT do. It does not require a literal to be exactly
 *      representable — that would reject `0.1`, since 0.1 is not a double, which would
 *      reject essentially all real-world decimals. It also does not require a canonical
 *      form, so `1e2`, `100`, and `1.0e2` all remain admissible; those denote the same
 *      value exactly and no declared consumer distinguishes them. R3 targets only the
 *      pathological case of a literal spelling out more precision than exists.
 *
 * What this does NOT fix
 * ----------------------
 * Two documents that differ only in NFC/NFD normalization still receive DIFFERENT digests
 * (E1 calls this over-discrimination). That is the dual defect and it is not addressed here:
 * fixing it requires deciding a normalization policy for string values, which changes what
 * gets signed and therefore needs a receipt schema migration. It is recorded as an open gap
 * in docs/research/EXPERIMENTS.md, not silently handled.
 *
 * NON-CLAIM: this guard rejects three specific classes of identity-collapsing input. It is
 * not a complete JSON validator, not a schema validator, not a security boundary against
 * all malformed input, and not evidence of model safety, semantic truth, or compliance. A
 * document that passes admission is not thereby trustworthy — it is merely free of these
 * three collapses.
 */

export const STRICT_ADMISSION_RULE_IDS = ["duplicate_object_key", "unsafe_integer_magnitude", "excess_significant_digits"] as const;

export type StrictAdmissionRuleId = (typeof STRICT_ADMISSION_RULE_IDS)[number];

/** Round-trip precision of an IEEE-754 double. Beyond this a literal asserts absent precision. */
export const MAX_SIGNIFICANT_DIGITS = 17;

export interface StrictAdmissionViolation {
  rule: StrictAdmissionRuleId;
  /** Byte offset into the input text where the offending token starts. */
  offset: number;
  /** JSON-pointer-ish path to the offending location, for diagnosis. */
  path: string;
  message: string;
}

export class StrictAdmissionError extends Error {
  public readonly violations: readonly StrictAdmissionViolation[];
  public readonly domain = "ghost_ark.strict_json_admission.v1";

  constructor(violations: readonly StrictAdmissionViolation[]) {
    const summary = violations.map((violation) => `${violation.rule} at ${violation.path}`).join("; ");
    super(`Strict JSON admission rejected the document: ${summary}`);
    this.name = "StrictAdmissionError";
    this.violations = violations;
  }
}

interface ScanState {
  text: string;
  index: number;
  violations: StrictAdmissionViolation[];
}

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function skipWhitespace(state: ScanState): void {
  while (state.index < state.text.length && isWhitespace(state.text[state.index] as string)) {
    state.index += 1;
  }
}

function fail(state: ScanState, message: string): never {
  throw new SyntaxError(`ghost_ark.strict_json_admission: ${message} at offset ${state.index}`);
}

/**
 * Read a JSON string token starting at the opening quote and return its decoded value.
 *
 * Decoding matters for R1: `{"a":1,"a":2}` is the same key twice, and a scanner that
 * compared raw token text would miss it. Escape handling here mirrors RFC 8259.
 */
function readString(state: ScanState): string {
  if (state.text[state.index] !== '"') {
    fail(state, "expected a string");
  }
  state.index += 1;

  let decoded = "";
  while (state.index < state.text.length) {
    const character = state.text[state.index] as string;

    if (character === '"') {
      state.index += 1;
      return decoded;
    }

    if (character === "\\") {
      const escape = state.text[state.index + 1];
      state.index += 2;
      switch (escape) {
        case '"':
          decoded += '"';
          break;
        case "\\":
          decoded += "\\";
          break;
        case "/":
          decoded += "/";
          break;
        case "b":
          decoded += "\b";
          break;
        case "f":
          decoded += "\f";
          break;
        case "n":
          decoded += "\n";
          break;
        case "r":
          decoded += "\r";
          break;
        case "t":
          decoded += "\t";
          break;
        case "u": {
          const hex = state.text.slice(state.index, state.index + 4);
          if (!/^[0-9a-fA-F]{4}$/u.test(hex)) {
            fail(state, "malformed \\u escape");
          }
          decoded += String.fromCharCode(Number.parseInt(hex, 16));
          state.index += 4;
          break;
        }
        default:
          fail(state, "unknown escape sequence");
      }
      continue;
    }

    decoded += character;
    state.index += 1;
  }

  fail(state, "unterminated string");
}

/**
 * Count significant digits in a JSON numeric literal.
 *
 * Leading zeros are not significant; trailing zeros in the fractional part ARE counted as
 * written, because `1.500000...` spelled to 30 places is exactly the over-precision R3
 * exists to reject. The exponent is not part of the significand.
 */
export function countSignificantDigits(literal: string): number {
  const withoutSign = literal.replace(/^[+-]/u, "");
  const [mantissa] = withoutSign.split(/[eE]/u);
  const digitsOnly = (mantissa ?? "").replace(".", "");
  const withoutLeadingZeros = digitsOnly.replace(/^0+/u, "");
  return withoutLeadingZeros.length;
}

/** Scan a numeric literal starting at `state.index`, applying R2 and R3. */
function readNumber(state: ScanState, path: string): void {
  const start = state.index;

  if (state.text[state.index] === "-" || state.text[state.index] === "+") {
    state.index += 1;
  }
  while (state.index < state.text.length && /[0-9]/u.test(state.text[state.index] as string)) {
    state.index += 1;
  }
  let isInteger = true;
  if (state.text[state.index] === ".") {
    isInteger = false;
    state.index += 1;
    while (state.index < state.text.length && /[0-9]/u.test(state.text[state.index] as string)) {
      state.index += 1;
    }
  }
  if (state.text[state.index] === "e" || state.text[state.index] === "E") {
    isInteger = false;
    state.index += 1;
    if (state.text[state.index] === "+" || state.text[state.index] === "-") {
      state.index += 1;
    }
    while (state.index < state.text.length && /[0-9]/u.test(state.text[state.index] as string)) {
      state.index += 1;
    }
  }

  const literal = state.text.slice(start, state.index);
  if (literal.length === 0) {
    fail(state, "expected a number");
  }

  const parsed = Number(literal);

  // R2: integers beyond the safe range share a double with their neighbours.
  if (isInteger && Number.isFinite(parsed) && Math.abs(parsed) > Number.MAX_SAFE_INTEGER) {
    state.violations.push({
      rule: "unsafe_integer_magnitude",
      offset: start,
      path,
      message:
        `Integer literal ${literal} exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}). ` +
        "Above this magnitude distinct integers share an IEEE-754 double, so the receipt cannot " +
        "evidence which value was submitted. Encode large integers as strings."
    });
  }

  // R3: more significant digits than a double can round-trip.
  const significantDigits = countSignificantDigits(literal);
  if (significantDigits > MAX_SIGNIFICANT_DIGITS) {
    state.violations.push({
      rule: "excess_significant_digits",
      offset: start,
      path,
      message:
        `Numeric literal ${literal} carries ${significantDigits} significant digits, above the ` +
        `${MAX_SIGNIFICANT_DIGITS}-digit round-trip precision of an IEEE-754 double. The text asserts ` +
        "precision the receipt cannot carry. Encode exact decimals as strings."
    });
  }
}

function readValue(state: ScanState, path: string): void {
  skipWhitespace(state);
  const character = state.text[state.index];

  if (character === "{") {
    state.index += 1;
    const seenKeys = new Set<string>();
    skipWhitespace(state);

    if (state.text[state.index] === "}") {
      state.index += 1;
      return;
    }

    for (;;) {
      skipWhitespace(state);
      const keyOffset = state.index;
      const key = readString(state);

      // R1: the same key twice. Compared AFTER escape decoding, so {"a":1,"a":2} is caught.
      if (seenKeys.has(key)) {
        state.violations.push({
          rule: "duplicate_object_key",
          offset: keyOffset,
          path: `${path}/${key}`,
          message:
            `Duplicate object key ${JSON.stringify(key)}. JSON.parse resolves duplicates last-wins, ` +
            "so this document and one asserting the key once would receive the same receipt identity."
        });
      }
      seenKeys.add(key);

      skipWhitespace(state);
      if (state.text[state.index] !== ":") {
        fail(state, "expected ':' after object key");
      }
      state.index += 1;

      readValue(state, `${path}/${key}`);
      skipWhitespace(state);

      if (state.text[state.index] === ",") {
        state.index += 1;
        continue;
      }
      if (state.text[state.index] === "}") {
        state.index += 1;
        return;
      }
      fail(state, "expected ',' or '}' in object");
    }
  }

  if (character === "[") {
    state.index += 1;
    skipWhitespace(state);
    if (state.text[state.index] === "]") {
      state.index += 1;
      return;
    }
    let arrayIndex = 0;
    for (;;) {
      readValue(state, `${path}/${arrayIndex}`);
      arrayIndex += 1;
      skipWhitespace(state);
      if (state.text[state.index] === ",") {
        state.index += 1;
        continue;
      }
      if (state.text[state.index] === "]") {
        state.index += 1;
        return;
      }
      fail(state, "expected ',' or ']' in array");
    }
  }

  if (character === '"') {
    readString(state);
    return;
  }

  if (state.text.startsWith("true", state.index)) {
    state.index += 4;
    return;
  }
  if (state.text.startsWith("false", state.index)) {
    state.index += 5;
    return;
  }
  if (state.text.startsWith("null", state.index)) {
    state.index += 4;
    return;
  }

  readNumber(state, path);
}

/**
 * Inspect raw JSON text and return every admission violation found.
 *
 * Returns ALL violations rather than the first, so a rejected document can be diagnosed in
 * one pass. Throws SyntaxError on text that is not JSON at all — malformed input is a
 * separate concern from identity collapse, and is reported as such.
 */
export function findStrictAdmissionViolations(text: string): StrictAdmissionViolation[] {
  const state: ScanState = { text, index: 0, violations: [] };
  readValue(state, "");
  skipWhitespace(state);

  if (state.index !== text.length) {
    fail(state, "unexpected trailing content after the top-level value");
  }

  return state.violations;
}

/**
 * Parse JSON text under strict admission control.
 *
 * Fails closed: a document carrying any identity-collapsing construct is rejected with a
 * StrictAdmissionError listing every violation, rather than being silently flattened into a
 * value whose receipt identity cannot distinguish it from a different document.
 *
 * Use this at trust boundaries where untrusted text becomes a receipt payload. It is NOT a
 * drop-in replacement for JSON.parse on internal, already-validated data, and it does not
 * change how anything is canonicalized or signed.
 */
export function parseStrictJson(text: string): unknown {
  const violations = findStrictAdmissionViolations(text);
  if (violations.length > 0) {
    throw new StrictAdmissionError(violations);
  }
  return JSON.parse(text);
}

/** True when the text is admissible. Convenience wrapper; prefer parseStrictJson. */
export function isStrictlyAdmissible(text: string): boolean {
  try {
    return findStrictAdmissionViolations(text).length === 0;
  } catch {
    return false;
  }
}
