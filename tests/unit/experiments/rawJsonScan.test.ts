import { describe, expect, it } from "vitest";

import {
  RAW_FINDING_CLASSES,
  doubleToExactBinary,
  literalEqualsDouble,
  literalToExactDecimal,
  sameExactDecimalValue,
  scanRawJson,
  type RawFindingClass
} from "../../../tools/experiments/rawJsonScan";
import { PATHOLOGY_ALPHABET } from "../../../tools/experiments/kernelAlphabet";

/**
 * Calibration for the Arm E measurement instrument.
 *
 * E12's entire result depends on this scanner reporting the constructs that are
 * really there and NOT reporting ones that are not. Both directions are failure
 * modes with opposite consequences, and both are pinned here:
 *
 *   A MISSED construct produces a false zero, which E12 would report as
 *   "pathologies do not occur in real traffic" — a conclusion against this
 *   project's own thesis, reached by instrument error rather than by evidence.
 *
 *   A SPURIOUS construct produces a false positive rate, which E12 would report
 *   as "pathologies are common" — a conclusion in this project's favour, reached
 *   the same wrong way. That is the more dangerous direction and it gets the
 *   larger share of the negative controls below.
 *
 * The calibration that matters most is the number classification. An earlier
 * draft of this scanner flagged `0.1`, because 0.1 genuinely is not a dyadic
 * rational and genuinely differs from the double it parses to. That definition
 * is true and nearly vacuous: it fires on almost every decimal ever written, so
 * a rate computed with it measures "does this document contain a fraction".
 * The distinction between the vacuous quantity and the decision-relevant one is
 * pinned by name below, because losing it silently would inflate every figure
 * E12 reports.
 */

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function classesOf(text: string): RawFindingClass[] {
  return scanRawJson(encode(text)).findings.map((finding) => finding.class);
}

describe("rawJsonScan — structural walk", () => {
  it("accepts well-formed documents and reports no findings for ordinary content", () => {
    const result = scanRawJson(
      encode('{"_type":"https://in-toto.io/Statement/v1","subject":[{"name":"pkg","digest":{"sha256":"ab12"}}]}')
    );
    expect(result.wellFormed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.memberCount).toBe(5);
    expect(result.maxDepth).toBeGreaterThan(1);
  });

  it.each([
    ['{"v":01}', "leading zero"],
    ['{"v":NaN}', "NaN is not JSON"],
    ['{"v":Infinity}', "Infinity is not JSON"],
    ['{"v":.5}', "no integer part"],
    ['{"v":1.}', "no fraction digits"],
    ['{"v":+1}', "explicit plus sign"],
    ['{"a":1,}', "trailing comma"],
    ["{'a':1}", "single-quoted name"],
    ['{"a":1} trailing', "trailing bytes"],
    ['{"a":1', "unterminated object"],
    ['{"a":"x', "unterminated string"],
    ['{"a":""}', "unescaped control character"]
  ])("rejects malformed input %s (%s)", (text) => {
    const result = scanRawJson(encode(text));
    expect(result.wellFormed).toBe(false);
    expect(result.malformedReason).toBeTruthy();
  });

  it("never throws on adversarial bytes, because one crash silently changes the sample", () => {
    const inputs: Uint8Array[] = [
      new Uint8Array(0),
      Uint8Array.from([0xff, 0xfe, 0x00]),
      encode("["["repeat"](0)),
      encode("[".repeat(5000)),
      encode('{"a":'.repeat(2000)),
      Uint8Array.from({ length: 4096 }, (_unused, index) => index % 256)
    ];
    for (const input of inputs) {
      expect(() => scanRawJson(input)).not.toThrow();
    }
  });

  it("bounds recursion rather than exhausting the stack", () => {
    const result = scanRawJson(encode("[".repeat(5000) + "1" + "]".repeat(5000)));
    expect(result.wellFormed).toBe(false);
    expect(result.malformedReason).toContain("512");
  });
});

describe("rawJsonScan — duplicate member names", () => {
  it.each([
    ['{"amount":1,"amount":2}', "top level"],
    ['{"items":[{"qty":1,"qty":2}]}', "nested inside an array"],
    ['{"":1,"":2}', "the empty-string name"],
    ['{"a":{"b":{"c":1,"c":2}}}', "three levels deep"]
  ])("detects a duplicate %s (%s)", (text) => {
    expect(classesOf(text)).toContain("duplicate-member-name");
  });

  it("compares names after unescaping, since \\u0061 and a are the same member name", () => {
    expect(classesOf('{"a":1,"\\u0061":2}')).toContain("duplicate-member-name");
  });

  it("does not fire on distinct names, including ones that merely look similar", () => {
    expect(classesOf('{"a":1,"b":2}')).toEqual([]);
    expect(classesOf('{"a":1,"A":2}')).toEqual([]);
    expect(classesOf('{"items":[{"qty":1},{"qty":2}]}')).toEqual([]);
  });
});

describe("rawJsonScan — number classification", () => {
  /**
   * The negative controls. Every one of these is a number that a naive
   * "is it exactly representable" test would flag and that must NOT be a
   * finding, because flagging them turns the measured rate into a measurement
   * of how often JSON contains a fraction.
   */
  it.each(["0.1", "0.10", "0.3", "1e2", "1E2", "1e+2", "1.50", "-0", "5e-324", "1.7976931348623157e308", "1e30"])(
    "does not report %s as non-round-tripping",
    (literal) => {
      expect(classesOf(`{"v":${literal}}`)).not.toContain("non-round-tripping-literal");
    }
  );

  it("counts inexact numbers as a descriptor rather than a finding", () => {
    const result = scanRawJson(encode('{"v":0.1}'));
    expect(result.inexactNumberCount).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it.each([
    ["9007199254740993", "an integer one above 2^53 that rounds down"],
    ["0.1000000000000000055511151231257827", "a decimal sharing a double with 0.1"],
    ["1152921504606846976", "2^60, held exactly but re-emitted as a different value"],
    ["2.5e-324", "a subnormal that rounds to a different subnormal"]
  ])("reports %s as non-round-tripping (%s)", (literal) => {
    expect(classesOf(`{"v":${literal}}`)).toContain("non-round-tripping-literal");
  });

  it("separates the two mechanisms behind a non-round-tripping literal", () => {
    const lossyParse = scanRawJson(encode('{"v":9007199254740993}')).findings.find(
      (finding) => finding.class === "non-round-tripping-literal"
    );
    const lossyEmit = scanRawJson(encode('{"v":1152921504606846976}')).findings.find(
      (finding) => finding.class === "non-round-tripping-literal"
    );
    expect(lossyParse?.detail).toContain("parse is lossy");
    // 2^60 is held exactly; only the way back out loses it. Conflating the two
    // would misdescribe the mechanism in the one finding most likely to be
    // quoted.
    expect(lossyEmit?.detail).toContain("parse is exact");
  });

  it("reports unsafe magnitude only for syntactically integral literals", () => {
    expect(classesOf('{"v":9007199254740993}')).toContain("unsafe-magnitude-integer");
    expect(classesOf('{"v":9007199254740991}')).not.toContain("unsafe-magnitude-integer");
    // Written as a float by the producer's own choice, so it is out of the
    // deliberately conservative class...
    expect(classesOf('{"v":1e30}')).not.toContain("unsafe-magnitude-integer");
    // ...but still counted in the denominator a zero must be read against.
    expect(scanRawJson(encode('{"v":1e30}')).largeMagnitudeNumberCount).toBe(1);
  });

  it("detects overflow and underflow", () => {
    expect(classesOf('{"v":1e400}')).toEqual(["overflow-to-infinity"]);
    expect(classesOf('{"v":-1e400}')).toEqual(["overflow-to-infinity"]);
    expect(classesOf('{"v":1e-400}')).toEqual(["underflow-to-zero"]);
    expect(classesOf('{"v":0}')).toEqual([]);
    expect(classesOf('{"v":0.0}')).toEqual([]);
  });
});

describe("rawJsonScan — exact arithmetic primitives", () => {
  it("recovers a double as an exact mantissa and binary exponent", () => {
    for (const value of [1, 0.5, 0.1, 2 ** 60, Number.MIN_VALUE, Number.MAX_VALUE, -3.25]) {
      const { mantissa, exponent } = doubleToExactBinary(value);
      // Reconstructed as mantissa * 2^exponent. The mantissa is at most 2^53 so
      // it converts to a double exactly, and 2**exponent stays in range for
      // every finite double including subnormals — dividing by 2n**1074n
      // instead would overflow the divisor to Infinity and read back zero.
      expect(Number(mantissa) * 2 ** exponent).toBe(value);
    }
  });

  it("decides literal-versus-double equality exactly, not by rendering", () => {
    expect(literalEqualsDouble("0.5", 0.5)).toBe(true);
    expect(literalEqualsDouble("0.1", 0.1)).toBe(false);
    expect(literalEqualsDouble("1152921504606846976", 2 ** 60)).toBe(true);
  });

  it("compares decimal literals by value, so spelling does not matter", () => {
    expect(sameExactDecimalValue("0.1", "0.10")).toBe(true);
    expect(sameExactDecimalValue("1e2", "100")).toBe(true);
    expect(sameExactDecimalValue("1E+2", "100.00")).toBe(true);
    expect(sameExactDecimalValue("0.1", "0.2")).toBe(false);
    expect(sameExactDecimalValue("1e400", "1e401")).toBe(false);
  });

  it("decomposes literals into exact digits and a base-ten exponent", () => {
    expect(literalToExactDecimal("-12.34")).toEqual({ digits: -1234n, exponent: -2 });
    expect(literalToExactDecimal("1e3")).toEqual({ digits: 1n, exponent: 3 });
  });
});

describe("rawJsonScan — strings", () => {
  it("detects an unpaired surrogate escape on either half of the range", () => {
    expect(classesOf('{"v":"\\ud800"}')).toContain("lone-surrogate-escape");
    expect(classesOf('{"v":"\\udc00"}')).toContain("lone-surrogate-escape");
  });

  it("does not fire on a well-formed surrogate pair", () => {
    expect(classesOf('{"v":"\\ud83d\\ude00"}')).toEqual([]);
  });

  it("detects a decomposed string, written either literally or as an escape", () => {
    expect(classesOf(`{"n":"café"}`)).toContain("non-nfc-string");
    expect(classesOf('{"n":"cafe\\u0301"}')).toContain("non-nfc-string");
    expect(classesOf(`{"n":"café"}`)).toEqual([]);
  });

  it("detects a decomposed member NAME, not only a value", () => {
    const findings = scanRawJson(encode(`{"café":1}`)).findings;
    expect(findings.map((finding) => finding.class)).toContain("non-nfc-string");
    expect(findings[0]?.detail).toContain("Member name");
  });

  it("reports ill-formed UTF-8 rather than silently substituting U+FFFD", () => {
    // A bare 0xFF inside a string. A substituting decoder would map this and a
    // genuine U+FFFD document onto one string, which is the collapse the class
    // exists to record.
    const bytes = Uint8Array.from([0x7b, 0x22, 0x76, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
    expect(scanRawJson(bytes).findings.map((finding) => finding.class)).toContain("invalid-utf8");
  });
});

describe("rawJsonScan — agreement with the pre-registered alphabet", () => {
  /**
   * The scanner and the E1 alphabet are two independent statements of the same
   * pathologies. Where the alphabet declares a pair `distinct` because one side
   * carries a construct, the scanner must see that construct in that side's raw
   * bytes. This is what makes the E12 rate comparable to the E1 census instead
   * of being a differently-defined number that happens to share vocabulary.
   */
  const expectations: { pathologyId: string; side: "rawA" | "rawB"; findingClass: RawFindingClass }[] = [
    { pathologyId: "duplicate-key-last-wins", side: "rawA", findingClass: "duplicate-member-name" },
    { pathologyId: "nested-duplicate-key-in-array", side: "rawA", findingClass: "duplicate-member-name" },
    { pathologyId: "duplicate-empty-key", side: "rawA", findingClass: "duplicate-member-name" },
    { pathologyId: "integer-precision-loss", side: "rawA", findingClass: "unsafe-magnitude-integer" },
    { pathologyId: "decimal-literal-collapse", side: "rawB", findingClass: "non-round-tripping-literal" },
    { pathologyId: "non-finite-overflow", side: "rawA", findingClass: "overflow-to-infinity" },
    { pathologyId: "lone-surrogate-escape", side: "rawA", findingClass: "lone-surrogate-escape" },
    { pathologyId: "unicode-nfc-vs-nfd", side: "rawB", findingClass: "non-nfc-string" }
  ];

  it.each(expectations)("sees $findingClass in $pathologyId.$side", ({ pathologyId, side, findingClass }) => {
    const pathology = PATHOLOGY_ALPHABET.find((entry) => entry.id === pathologyId);
    expect(pathology, `alphabet no longer contains ${pathologyId}`).toBeDefined();
    expect(classesOf(pathology?.[side] as string)).toContain(findingClass);
  });

  it("sees nothing in the sides the alphabet uses as clean controls", () => {
    for (const pathologyId of ["safe-integer-neighbours", "object-key-order", "insignificant-whitespace"]) {
      const pathology = PATHOLOGY_ALPHABET.find((entry) => entry.id === pathologyId);
      expect(classesOf(pathology?.rawA as string)).toEqual([]);
      expect(classesOf(pathology?.rawB as string)).toEqual([]);
    }
  });
});

describe("rawJsonScan — report shape", () => {
  it("initializes every declared class so a zero is a reported zero, not a missing key", () => {
    const result = scanRawJson(encode("{}"));
    for (const findingClass of RAW_FINDING_CLASSES) {
      expect(result.counts[findingClass]).toBe(0);
    }
  });

  it("carries a JSON Pointer to each finding", () => {
    const findings = scanRawJson(encode('{"a":{"b":[{"q":1,"q":2}]}}')).findings;
    expect(findings[0]?.pointer).toBe("/a/b/0/q");
  });
});
