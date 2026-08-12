/**
 * Raw-byte JSON scanner — the measurement instrument for Arm E of the
 * Observability Gap program.
 *
 * WHY THIS FILE EXISTS AND WHY IT MAY NOT USE `JSON.parse`
 * -------------------------------------------------------
 * Arm E asks how often real production attestation payloads contain a construct
 * that a declared consumer would distinguish but a canonicalization step does
 * not. Every such construct is, by definition, one that `JSON.parse` destroys:
 * a duplicate member name is gone after last-wins resolution, an integer above
 * 2^53 has already been rounded, and two decimal literals that share a double
 * are indistinguishable the moment either becomes a `number`.
 *
 * So a harness that parses the payload and then inspects the resulting value
 * cannot observe any of them. It would report zero and the zero would be an
 * artifact of the instrument. That is the E4 discriminator applied to Arm E's
 * own harness, and it is the single way this measurement is most likely to be
 * wrong, so it is structural here rather than a comment: this module walks the
 * UTF-8 bytes with its own recursive-descent tokenizer and never constructs a
 * JavaScript value from the document. `tests/unit/repo-hygiene/rawJsonScanNoParse.test.ts`
 * asserts the absence of `JSON.parse` in this file so the property cannot be
 * lost in a later edit.
 *
 * EXACTNESS OF THE NUMBER ANALYSIS
 * --------------------------------
 * "This literal loses precision" is decided exactly, not by string comparison
 * against a shortest-round-trip rendering. The literal's exact rational value
 * (D x 10^E, BigInt D) is compared by cross-multiplication against the exact
 * rational value of the IEEE-754 double it parses to (m x 2^e, both integers
 * recovered from the bit pattern). Two exact rationals, one exact comparison,
 * no floating-point in the decision path. A literal is reported as lossy if and
 * only if those two rationals differ.
 *
 * WHAT A FINDING IS AND IS NOT
 * ----------------------------
 * A finding is an OBSERVATION about the bytes: this document contains a
 * construct whose distinguishing information does not survive a parse. It is
 * not an allegation of a defect, an attack, or a vulnerability in whoever
 * produced the document. Most of these constructs are emitted by ordinary
 * tooling for ordinary reasons. Whether a finding matters depends entirely on
 * what a consumer does with the parsed value, which this scanner cannot see.
 *
 * NON-CLAIM: this module reports syntactic properties of JSON bytes. It is not
 * a validator, not a security scanner, not a statement that any document or
 * producer is defective, and it establishes nothing about safety, compliance,
 * or the correctness of any system that consumed these bytes.
 */

/** Pathology classes this scanner can observe in raw bytes. */
export type RawFindingClass =
  /** The same member name appears twice in one object, at any depth. */
  | "duplicate-member-name"
  /** An integer literal whose magnitude exceeds 2^53 - 1, so adjacent integers share a double. */
  | "unsafe-magnitude-integer"
  /** The literal does not survive a parse-then-canonically-re-emit round trip. */
  | "non-round-tripping-literal"
  /** A finite decimal literal that parses to +/-Infinity. */
  | "overflow-to-infinity"
  /** A non-zero literal that parses to zero. */
  | "underflow-to-zero"
  /** An unpaired UTF-16 surrogate, written as a \\u escape. */
  | "lone-surrogate-escape"
  /** A string whose decoded form is not in Unicode Normalization Form C. */
  | "non-nfc-string"
  /** Raw bytes that are not well-formed UTF-8. */
  | "invalid-utf8";

export const RAW_FINDING_CLASSES: readonly RawFindingClass[] = [
  "duplicate-member-name",
  "unsafe-magnitude-integer",
  "non-round-tripping-literal",
  "overflow-to-infinity",
  "underflow-to-zero",
  "lone-surrogate-escape",
  "non-nfc-string",
  "invalid-utf8"
] as const;

export interface RawFinding {
  class: RawFindingClass;
  /** JSON Pointer (RFC 6901) to the location, built from the byte walk. */
  pointer: string;
  /** Byte offset in the document where the construct starts. */
  offset: number;
  /** The exact source text of the construct, truncated for reporting. */
  literal: string;
  detail: string;
}

export interface RawJsonScanResult {
  /** True when the bytes are a structurally well-formed RFC 8259 document. */
  wellFormed: boolean;
  /** Why not, when not. Null when wellFormed. */
  malformedReason: string | null;
  byteLength: number;
  findings: RawFinding[];
  counts: Record<RawFindingClass, number>;
  /** Corpus descriptors, reported so a zero can be read against what was searched. */
  memberCount: number;
  stringCount: number;
  numberCount: number;
  /**
   * Numbers whose double differs from the literal's exact value. Deliberately a
   * descriptor and not a finding: every non-dyadic decimal qualifies, 0.1
   * included, so this count is near-vacuous as a pathology rate. It is reported
   * so the near-vacuous quantity and the decision-relevant
   * `unrecoverable-literal` count can be read side by side.
   */
  inexactNumberCount: number;
  /**
   * Numeric literals of any spelling whose magnitude exceeds 2^53 - 1. The
   * denominator for the deliberately conservative `unsafe-magnitude-integer`
   * class, which counts only the syntactically integral subset. A zero in that
   * class must be read against this number.
   */
  largeMagnitudeNumberCount: number;
  maxDepth: number;
}

const MAX_LITERAL_REPORT = 120;

function emptyCounts(): Record<RawFindingClass, number> {
  const counts = {} as Record<RawFindingClass, number>;
  for (const key of RAW_FINDING_CLASSES) {
    counts[key] = 0;
  }
  return counts;
}

/* -------------------------------------------------------------------------- */
/* Exact IEEE-754 decomposition                                               */
/* -------------------------------------------------------------------------- */

/**
 * Recovers the exact rational value of a finite double as `mantissa * 2^exponent`
 * with both parts integral, straight from the bit pattern.
 *
 * Every finite double IS exactly such a rational, so this loses nothing. It is
 * the half of the comparison that makes the precision test exact rather than
 * heuristic.
 */
export function doubleToExactBinary(value: number): { mantissa: bigint; exponent: number } {
  if (!Number.isFinite(value)) {
    throw new Error("ghost_ark.rawScan: doubleToExactBinary requires a finite double.");
  }
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);

  const negative = (bits >> 63n) === 1n;
  const biasedExponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0xf_ffff_ffff_ffffn;

  // Subnormals (and zero) carry no implicit leading one.
  const mantissaMagnitude = biasedExponent === 0 ? fraction : fraction + (1n << 52n);
  const exponent = biasedExponent === 0 ? -1074 : biasedExponent - 1075;

  return { mantissa: negative ? -mantissaMagnitude : mantissaMagnitude, exponent };
}

/** Decomposes a JSON number literal into an exact `digits * 10^exponent`. */
export function literalToExactDecimal(literal: string): { digits: bigint; exponent: number } {
  let rest = literal;
  let sign = 1n;
  if (rest.startsWith("-")) {
    sign = -1n;
    rest = rest.slice(1);
  }

  let exponent = 0;
  const exponentMarker = rest.search(/[eE]/u);
  if (exponentMarker >= 0) {
    exponent = Number.parseInt(rest.slice(exponentMarker + 1), 10);
    rest = rest.slice(0, exponentMarker);
  }

  const point = rest.indexOf(".");
  if (point >= 0) {
    const fractionDigits = rest.length - point - 1;
    exponent -= fractionDigits;
    rest = rest.slice(0, point) + rest.slice(point + 1);
  }

  return { digits: sign * BigInt(rest === "" ? "0" : rest), exponent };
}

/**
 * Exact equality between a decimal literal and the double it parses to.
 *
 * Compares `digits * 10^decExp` against `mantissa * 2^binExp` by
 * cross-multiplying the two fractions with BigInt arithmetic. No rounding
 * happens anywhere in this function.
 */
export function literalEqualsDouble(literal: string, value: number): boolean {
  const { digits, exponent: decExp } = literalToExactDecimal(literal);
  const { mantissa, exponent: binExp } = doubleToExactBinary(value);

  let leftNumerator = digits;
  let leftDenominator = 1n;
  if (decExp >= 0) {
    leftNumerator *= 10n ** BigInt(decExp);
  } else {
    leftDenominator = 10n ** BigInt(-decExp);
  }

  let rightNumerator = mantissa;
  let rightDenominator = 1n;
  if (binExp >= 0) {
    rightNumerator *= 1n << BigInt(binExp);
  } else {
    rightDenominator = 1n << BigInt(-binExp);
  }

  return leftNumerator * rightDenominator === rightNumerator * leftDenominator;
}

/**
 * Exact equality of the values denoted by two decimal literals.
 *
 * Value equality, not spelling equality: `0.10` and `0.1` and `1e-1` all pass,
 * because they denote one number. Used to ask whether re-emitting a parsed
 * number reproduces the value that was actually written.
 */
export function sameExactDecimalValue(left: string, right: string): boolean {
  const a = literalToExactDecimal(left);
  const b = literalToExactDecimal(right);
  if (a.digits === 0n || b.digits === 0n) {
    return a.digits === b.digits;
  }
  const spread = a.exponent - b.exponent;
  // Beyond this the two values differ by hundreds of orders of magnitude and
  // cannot be equal; bounded so the comparison cannot build a huge BigInt.
  if (Math.abs(spread) > 4096) {
    return false;
  }
  return spread >= 0
    ? a.digits * 10n ** BigInt(spread) === b.digits
    : b.digits * 10n ** BigInt(-spread) === a.digits;
}

/* -------------------------------------------------------------------------- */
/* UTF-8 decoding, done here so ill-formed input is a finding and not a throw  */
/* -------------------------------------------------------------------------- */

/**
 * Strict UTF-8 decode. Returns null when the bytes are not well-formed, rather
 * than substituting U+FFFD the way `TextDecoder` does by default — a
 * substituting decoder would silently destroy exactly the distinction
 * `invalid-utf8` exists to record.
 */
export function decodeStrictUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* The scanner                                                                */
/* -------------------------------------------------------------------------- */

class ScanError extends Error {}

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

class RawScanner {
  private index = 0;
  private depth = 0;

  readonly findings: RawFinding[] = [];
  memberCount = 0;
  stringCount = 0;
  numberCount = 0;
  inexactNumberCount = 0;
  largeMagnitudeNumberCount = 0;
  maxDepth = 0;

  constructor(private readonly bytes: Uint8Array) {}

  private fail(message: string): never {
    throw new ScanError(`${message} at byte ${this.index}`);
  }

  private peek(): number {
    return this.index < this.bytes.length ? (this.bytes[this.index] as number) : -1;
  }

  private skipWhitespace(): void {
    while (this.index < this.bytes.length && WHITESPACE.has(this.bytes[this.index] as number)) {
      this.index += 1;
    }
  }

  private expect(byte: number, what: string): void {
    if (this.peek() !== byte) {
      this.fail(`expected ${what}`);
    }
    this.index += 1;
  }

  private record(finding: RawFinding): void {
    this.findings.push(finding);
  }

  /** Entry point: one complete JSON text, with nothing but whitespace after it. */
  scanDocument(): void {
    this.skipWhitespace();
    this.scanValue("");
    this.skipWhitespace();
    if (this.index !== this.bytes.length) {
      this.fail("trailing bytes after the top-level value");
    }
  }

  private scanValue(pointer: string): void {
    this.depth += 1;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
    // A payload is attacker-influenced input; a recursive walk over it must not
    // be able to exhaust the JS stack, so depth is bounded and the bound is a
    // malformed-reason rather than a crash.
    if (this.depth > 512) {
      this.fail("nesting deeper than the scanner's 512-level bound");
    }

    const byte = this.peek();
    switch (byte) {
      case 0x7b: // {
        this.scanObject(pointer);
        break;
      case 0x5b: // [
        this.scanArray(pointer);
        break;
      case 0x22: // "
        this.scanString(pointer, false);
        this.stringCount += 1;
        break;
      case 0x74: // t
        this.scanKeyword("true");
        break;
      case 0x66: // f
        this.scanKeyword("false");
        break;
      case 0x6e: // n
        this.scanKeyword("null");
        break;
      default:
        if (byte === 0x2d || (byte >= 0x30 && byte <= 0x39)) {
          this.scanNumber(pointer);
          this.numberCount += 1;
        } else {
          this.fail("expected a JSON value");
        }
    }
    this.depth -= 1;
  }

  private scanKeyword(word: string): void {
    for (const character of word) {
      if (this.peek() !== character.charCodeAt(0)) {
        this.fail(`expected the literal ${word}`);
      }
      this.index += 1;
    }
  }

  private scanObject(pointer: string): void {
    this.expect(0x7b, "{");
    this.skipWhitespace();

    // Member names are compared AFTER unescaping, because RFC 8259 member names
    // are strings: "a" and "a" are the same name written two ways, and a
    // duplicate check over raw spans would miss that pair entirely.
    const seen = new Map<string, number>();

    if (this.peek() === 0x7d) {
      this.index += 1;
      return;
    }

    for (;;) {
      this.skipWhitespace();
      if (this.peek() !== 0x22) {
        this.fail("expected a member name");
      }
      const nameOffset = this.index;
      const name = this.scanString(pointer, true);
      this.stringCount += 1;
      this.memberCount += 1;

      const previousOffset = seen.get(name);
      if (previousOffset !== undefined) {
        this.record({
          class: "duplicate-member-name",
          pointer: `${pointer}/${escapePointerToken(name)}`,
          offset: nameOffset,
          literal: truncate(name),
          detail:
            `Member name repeated in one object; first occurrence at byte ${previousOffset}. ` +
            "A last-wins parse keeps one of the two values and the other is not recoverable from the parsed form."
        });
      } else {
        seen.set(name, nameOffset);
      }

      this.skipWhitespace();
      this.expect(0x3a, ":");
      this.skipWhitespace();
      this.scanValue(`${pointer}/${escapePointerToken(name)}`);
      this.skipWhitespace();

      const next = this.peek();
      if (next === 0x2c) {
        this.index += 1;
        continue;
      }
      if (next === 0x7d) {
        this.index += 1;
        return;
      }
      this.fail("expected , or } in an object");
    }
  }

  private scanArray(pointer: string): void {
    this.expect(0x5b, "[");
    this.skipWhitespace();
    if (this.peek() === 0x5d) {
      this.index += 1;
      return;
    }

    let position = 0;
    for (;;) {
      this.skipWhitespace();
      this.scanValue(`${pointer}/${position}`);
      this.skipWhitespace();
      const next = this.peek();
      if (next === 0x2c) {
        this.index += 1;
        position += 1;
        continue;
      }
      if (next === 0x5d) {
        this.index += 1;
        return;
      }
      this.fail("expected , or ] in an array");
    }
  }

  /**
   * Scans one string and returns its DECODED value.
   *
   * The decode is done here, escape by escape, rather than by handing the span
   * to a JSON parser: the surrogate and normalization findings are properties of
   * how the string was written, and both are gone once a parser has produced a
   * JS string.
   */
  private scanString(pointer: string, isMemberName: boolean): string {
    const startOffset = this.index;
    this.expect(0x22, '"');

    const units: number[] = [];
    let sawLoneSurrogate = false;
    let loneSurrogateDetail = "";

    for (;;) {
      const byte = this.peek();
      if (byte === -1) {
        this.fail("unterminated string");
      }
      if (byte === 0x22) {
        this.index += 1;
        break;
      }
      if (byte < 0x20) {
        this.fail("unescaped control character in a string");
      }

      if (byte === 0x5c) {
        this.index += 1;
        const escape = this.peek();
        this.index += 1;
        switch (escape) {
          case 0x22:
            units.push(0x22);
            break;
          case 0x5c:
            units.push(0x5c);
            break;
          case 0x2f:
            units.push(0x2f);
            break;
          case 0x62:
            units.push(0x08);
            break;
          case 0x66:
            units.push(0x0c);
            break;
          case 0x6e:
            units.push(0x0a);
            break;
          case 0x72:
            units.push(0x0d);
            break;
          case 0x74:
            units.push(0x09);
            break;
          case 0x75: {
            const unit = this.readFourHexDigits();
            units.push(unit);
            if (unit >= 0xd800 && unit <= 0xdbff) {
              // A high surrogate is only well-formed when the NEXT escape is a
              // low surrogate. A literal astral character cannot follow, because
              // \u escapes and literal characters are separate encodings.
              const paired = this.peekLowSurrogateEscape();
              if (paired === null) {
                sawLoneSurrogate = true;
                loneSurrogateDetail = `unpaired high surrogate U+${unit.toString(16).toUpperCase()}`;
              } else {
                units.push(paired);
                this.index += 6;
              }
            } else if (unit >= 0xdc00 && unit <= 0xdfff) {
              sawLoneSurrogate = true;
              loneSurrogateDetail = `unpaired low surrogate U+${unit.toString(16).toUpperCase()}`;
            }
            break;
          }
          default:
            this.fail("unrecognized escape sequence");
        }
        continue;
      }

      // A literal (unescaped) byte run. Copied verbatim; UTF-8 well-formedness
      // of the whole document is checked separately, once, over all the bytes.
      units.push(byte);
      this.index += 1;
    }

    const rawSpan = this.bytes.subarray(startOffset, this.index);
    const decoded = decodeStringSpan(units);

    if (sawLoneSurrogate) {
      this.record({
        class: "lone-surrogate-escape",
        pointer,
        offset: startOffset,
        literal: truncate(latin1(rawSpan)),
        detail:
          `${loneSurrogateDetail}. The escape denotes no Unicode scalar value, so any consumer that decodes, ` +
          "re-encodes, or normalizes the string replaces it, and the replacement is not distinguishable afterwards " +
          "from a document that carried the replacement character to begin with."
      });
    }

    if (decoded !== null && decoded.normalize("NFC") !== decoded) {
      this.record({
        class: "non-nfc-string",
        pointer,
        offset: startOffset,
        literal: truncate(decoded),
        detail:
          (isMemberName ? "Member name" : "String") +
          " is not in Normalization Form C. Any hop that normalizes maps it onto its NFC form, which is a different " +
          "byte sequence carrying the same rendered text."
      });
    }

    return decoded ?? latin1(rawSpan);
  }

  private readFourHexDigits(): number {
    let value = 0;
    for (let position = 0; position < 4; position += 1) {
      const byte = this.peek();
      const digit = hexDigit(byte);
      if (digit < 0) {
        this.fail("\\u escape requires four hexadecimal digits");
      }
      value = value * 16 + digit;
      this.index += 1;
    }
    return value;
  }

  /** Looks ahead for `\uDCxx` without consuming it. */
  private peekLowSurrogateEscape(): number | null {
    if (this.index + 6 > this.bytes.length) {
      return null;
    }
    if (this.bytes[this.index] !== 0x5c || this.bytes[this.index + 1] !== 0x75) {
      return null;
    }
    let value = 0;
    for (let position = 0; position < 4; position += 1) {
      const digit = hexDigit(this.bytes[this.index + 2 + position] as number);
      if (digit < 0) {
        return null;
      }
      value = value * 16 + digit;
    }
    return value >= 0xdc00 && value <= 0xdfff ? value : null;
  }

  /**
   * Scans one number and decides, exactly, what a parse would do to it.
   *
   * The grammar enforced here is RFC 8259's, so `01`, `.5`, `1.`, `+1`, `NaN`
   * and `Infinity` are malformed rather than findings — a document containing
   * them is not JSON, and reporting it as a pathology class would conflate
   * "this parses to something lossy" with "this does not parse".
   */
  private scanNumber(pointer: string): void {
    const startOffset = this.index;

    if (this.peek() === 0x2d) {
      this.index += 1;
    }

    if (this.peek() === 0x30) {
      this.index += 1;
      if (isDigit(this.peek())) {
        this.fail("leading zero in a number");
      }
    } else if (isDigit(this.peek())) {
      while (isDigit(this.peek())) {
        this.index += 1;
      }
    } else {
      this.fail("expected a digit");
    }

    let isInteger = true;
    if (this.peek() === 0x2e) {
      isInteger = false;
      this.index += 1;
      if (!isDigit(this.peek())) {
        this.fail("expected a digit after the decimal point");
      }
      while (isDigit(this.peek())) {
        this.index += 1;
      }
    }

    if (this.peek() === 0x65 || this.peek() === 0x45) {
      this.index += 1;
      if (this.peek() === 0x2b || this.peek() === 0x2d) {
        this.index += 1;
      }
      if (!isDigit(this.peek())) {
        this.fail("expected a digit in the exponent");
      }
      while (isDigit(this.peek())) {
        this.index += 1;
      }
      // `isInteger` tracks SYNTACTIC integrality — digits and an optional sign,
      // nothing else. 1e2 denotes an integer but is not written as one, and the
      // magnitude class below is deliberately about how the producer wrote the
      // number, not only about what it denotes.
      isInteger = false;
    }

    const literal = latin1(this.bytes.subarray(startOffset, this.index));
    // Number() on a validated RFC 8259 literal is the same rounding a parser
    // applies; it is used to obtain the TARGET of the comparison, never to
    // decide the comparison.
    const parsed = Number(literal);

    if (!Number.isFinite(parsed)) {
      this.record({
        class: "overflow-to-infinity",
        pointer,
        offset: startOffset,
        literal: truncate(literal),
        detail:
          "A finite decimal literal that parses to a non-finite double. Every literal above the overflow threshold " +
          "maps to the same infinity, so their differences are not recoverable after a parse, and most canonical " +
          "JSON forms cannot re-emit the value at all."
      });
      return;
    }

    const exact = literalToExactDecimal(literal);
    const literalIsZero = exact.digits === 0n;

    if (parsed === 0 && !literalIsZero) {
      this.record({
        class: "underflow-to-zero",
        pointer,
        offset: startOffset,
        literal: truncate(literal),
        detail:
          "A non-zero literal that parses to zero. Every literal below the underflow threshold maps to the same zero."
      });
      return;
    }

    // Descriptor, deliberately NOT a finding. Every decimal that is not a
    // dyadic rational — 0.1 included — differs from its double, so this count
    // is close to "how many non-integer numbers are there" and reporting it as
    // a pathology rate would inflate the result to the point of vacuity. It is
    // carried so a reader can see the gap between the true-but-vacuous quantity
    // and the decision-relevant one below.
    if (!literalEqualsDouble(literal, parsed)) {
      this.inexactNumberCount += 1;
    }

    // The decision-relevant class: the literal does not survive one hop of
    // parse-then-canonically-re-emit. RFC 8785 s3.2.2.3 mandates the ECMAScript
    // shortest-round-trip rendering, so that rendering IS what the next hop
    // sees. If it denotes a different value than the literal did, the number
    // that was transmitted is not the number that continues down the pipeline.
    //
    // Two distinct mechanisms land here and the detail says which:
    //   - the parse is lossy   (9007199254740993 -> 9007199254740992)
    //   - the parse is exact but the re-emission is not (2^60 is held exactly
    //     as a double, yet its shortest rendering is 1152921504606847000)
    // The second is the more interesting one, because the value is intact in
    // memory and is lost only when it is written back out.
    //
    // 0.1 passes this test, and that is the point of using it rather than
    // exact-representability: 0.1 is not a dyadic rational, but its shortest
    // rendering is "0.1", so the value written is the value re-emitted.
    const reemitted = String(parsed);
    if (!sameExactDecimalValue(literal, reemitted)) {
      const parseIsLossy = !literalEqualsDouble(literal, parsed);
      this.record({
        class: "non-round-tripping-literal",
        pointer,
        offset: startOffset,
        literal: truncate(literal),
        detail: parseIsLossy
          ? `The parse is lossy for this literal: it rounds to a double whose canonical rendering is ${reemitted}, ` +
            "a different exact value, so the transmitted value is not recoverable from the parsed form."
          : `The parse is exact but the canonical re-emission is not: the double holds this value exactly, yet its ` +
            `shortest round-trip rendering is ${reemitted}, a different exact value. The loss happens on the way ` +
            "back out, not on the way in."
      });
    }

    const magnitude = absoluteIntegerValue(exact);
    if (magnitude !== null && magnitude > 9007199254740991n) {
      this.largeMagnitudeNumberCount += 1;

      // Restricted to SYNTACTICALLY integral literals — no decimal point, no
      // exponent. That is how a ledger, a quantity, a counter, or an ID is
      // written, and it is the shape whose collapsing neighbours are a
      // consumer's problem. A literal spelled 1e30 or 1.79e308 is a float by
      // the producer's own intent and is already covered above when its value
      // fails to round-trip.
      //
      // This narrows the class deliberately, and it narrows it in the
      // conservative direction: it can under-count and cannot over-count. That
      // asymmetry matters when reading the result. A POSITIVE finding is
      // strengthened by it. A ZERO is weakened by it, and the zero must be
      // reported against `largeMagnitudeNumberCount` rather than alone.
      if (isInteger) {
        this.record({
          class: "unsafe-magnitude-integer",
          pointer,
          offset: startOffset,
          literal: truncate(literal),
          detail:
            "Integer magnitude above 2^53 - 1. At this magnitude adjacent integers share a double, so a parsed form " +
            "cannot distinguish this value from at least one of its neighbours."
        });
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isDigit(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x39;
}

function hexDigit(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  return -1;
}

/** Magnitude of the literal's exact value, truncated toward zero. */
function absoluteIntegerValue(exact: { digits: bigint; exponent: number }): bigint | null {
  // Bounded so a pathological literal such as 1e1000000000 cannot be turned
  // into a multi-gigabyte BigInt by the scanner itself.
  if (exact.exponent > 4096 || exact.exponent < -4096) {
    return null;
  }
  const value =
    exact.exponent >= 0
      ? exact.digits * 10n ** BigInt(exact.exponent)
      : exact.digits / 10n ** BigInt(-exact.exponent);
  return value < 0n ? -value : value;
}

/** Builds a JS string from decoded escapes and raw UTF-8 byte runs. */
function decodeStringSpan(units: readonly number[]): string | null {
  // Units below 0x100 that came from raw bytes must be re-assembled as UTF-8;
  // units from \u escapes are already UTF-16 code units. They are separated by
  // magnitude: escapes above 0x7F are code units, raw bytes above 0x7F are UTF-8
  // continuation bytes. Both are emitted here and the result is validated.
  const bytes: number[] = [];
  const codeUnits: number[] = [];
  let sawEscapeAbove7f = false;

  for (const unit of units) {
    if (unit > 0xff) {
      sawEscapeAbove7f = true;
      break;
    }
  }

  if (!sawEscapeAbove7f) {
    for (const unit of units) {
      bytes.push(unit);
    }
    return decodeStrictUtf8(Uint8Array.from(bytes));
  }

  // Mixed content: decode the raw runs as UTF-8 and splice escapes in as code
  // units. Done in one pass so a raw multi-byte character adjacent to an escape
  // is still decoded correctly.
  let pending: number[] = [];
  const flush = (): boolean => {
    if (pending.length === 0) {
      return true;
    }
    const decoded = decodeStrictUtf8(Uint8Array.from(pending));
    pending = [];
    if (decoded === null) {
      return false;
    }
    for (const character of decoded) {
      for (let position = 0; position < character.length; position += 1) {
        codeUnits.push(character.charCodeAt(position));
      }
    }
    return true;
  };

  for (const unit of units) {
    if (unit > 0xff) {
      if (!flush()) {
        return null;
      }
      codeUnits.push(unit);
    } else {
      pending.push(unit);
    }
  }
  if (!flush()) {
    return null;
  }

  let out = "";
  for (const unit of codeUnits) {
    out += String.fromCharCode(unit);
  }
  return out;
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += String.fromCharCode(byte);
  }
  return out;
}

function truncate(text: string): string {
  return text.length <= MAX_LITERAL_REPORT ? text : `${text.slice(0, MAX_LITERAL_REPORT)}...`;
}

function escapePointerToken(token: string): string {
  return token.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Scans raw document bytes and reports every observable construct.
 *
 * Never throws on adversarial input: malformed bytes come back as
 * `wellFormed: false` with a reason, because a payload drawn from a public log
 * is arbitrary input and a harness that crashes on one entry silently changes
 * the sample.
 */
export function scanRawJson(bytes: Uint8Array): RawJsonScanResult {
  const counts = emptyCounts();
  const findings: RawFinding[] = [];

  // UTF-8 well-formedness is a property of the whole document and is checked
  // once, before the structural walk, because the walk's string decoding
  // depends on it.
  const wholeDocument = decodeStrictUtf8(bytes);
  if (wholeDocument === null) {
    findings.push({
      class: "invalid-utf8",
      pointer: "",
      offset: 0,
      literal: "",
      detail:
        "Document bytes are not well-formed UTF-8. A decoder that substitutes U+FFFD maps a family of distinct byte " +
        "sequences onto one string, and the original bytes are not recoverable from the substituted result."
    });
    counts["invalid-utf8"] += 1;
  }

  const scanner = new RawScanner(bytes);
  let wellFormed = true;
  let malformedReason: string | null = null;
  try {
    scanner.scanDocument();
  } catch (error) {
    wellFormed = false;
    malformedReason = error instanceof ScanError ? error.message : String(error);
  }

  for (const finding of scanner.findings) {
    findings.push(finding);
    counts[finding.class] += 1;
  }

  return {
    wellFormed,
    malformedReason,
    byteLength: bytes.length,
    findings,
    counts,
    memberCount: scanner.memberCount,
    stringCount: scanner.stringCount,
    numberCount: scanner.numberCount,
    inexactNumberCount: scanner.inexactNumberCount,
    largeMagnitudeNumberCount: scanner.largeMagnitudeNumberCount,
    maxDepth: scanner.maxDepth
  };
}
