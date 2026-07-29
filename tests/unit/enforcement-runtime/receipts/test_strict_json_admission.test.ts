import { describe, expect, it } from "vitest";
import {
  MAX_SIGNIFICANT_DIGITS,
  StrictAdmissionError,
  countSignificantDigits,
  findStrictAdmissionViolations,
  isStrictlyAdmissible,
  parseStrictJson
} from "../../../../packages/receipt-schema/src/strictJsonAdmission";
import { canonicalize } from "../../../../packages/receipt-schema/src/hashCanonicalization";

/**
 * These tests pin the fix for the three unintended kernel members that experiment E1 found
 * in Ghost-Ark's own pipeline. Each rule test is paired with a demonstration that the
 * collapse it prevents is REAL: the two documents are shown to produce identical canonical
 * forms under plain JSON.parse, and then shown to be rejected under strict admission.
 *
 * Without the paired demonstration these would be tests that a validator validates. With it,
 * they are tests that a specific, reproducible identity collapse is now refused.
 */

describe("R1 — duplicate object keys", () => {
  it("demonstrates the collapse it prevents: two distinct documents, one canonical form", () => {
    const withDuplicate = '{"amount":1,"amount":2}';
    const withoutDuplicate = '{"amount":2}';

    expect(withDuplicate).not.toBe(withoutDuplicate);
    // The collapse, reproduced. This is the defect, not a hypothetical.
    expect(canonicalize(JSON.parse(withDuplicate))).toBe(canonicalize(JSON.parse(withoutDuplicate)));
  });

  it("rejects the duplicate-key document and admits the honest one", () => {
    expect(() => parseStrictJson('{"amount":1,"amount":2}')).toThrow(StrictAdmissionError);
    expect(parseStrictJson('{"amount":2}')).toEqual({ amount: 2 });
  });

  it("detects duplicates at any nesting depth, including inside arrays", () => {
    expect(isStrictlyAdmissible('{"outer":{"a":1,"a":2}}')).toBe(false);
    expect(isStrictlyAdmissible('{"items":[{"a":1},{"b":1,"b":2}]}')).toBe(false);
    expect(isStrictlyAdmissible('{"items":[{"a":1},{"b":2}]}')).toBe(true);
  });

  it("compares keys after escape decoding, so an escaped duplicate cannot slip through", () => {
    // A scanner comparing raw token text would see "a" and "a" as different tokens.
    // JSON.parse resolves them to the same key, so the collapse is identical.
    expect(canonicalize(JSON.parse('{"a":1,"\\u0061":2}'))).toBe(canonicalize(JSON.parse('{"a":2}')));
    const violations = findStrictAdmissionViolations('{"a":1,"\\u0061":2}');
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("duplicate_object_key");
  });

  it("does not confuse the same key name in sibling objects for a duplicate", () => {
    expect(isStrictlyAdmissible('{"x":{"a":1},"y":{"a":2}}')).toBe(true);
    expect(isStrictlyAdmissible('[{"a":1},{"a":2}]')).toBe(true);
  });

  it("reports the path of the offending key", () => {
    const violations = findStrictAdmissionViolations('{"outer":{"inner":{"k":1,"k":2}}}');
    expect(violations[0]?.path).toBe("/outer/inner/k");
  });
});

describe("R2 — unsafe integer magnitude", () => {
  it("demonstrates the collapse it prevents: two integers one apart, one canonical form", () => {
    const higher = '{"amount":9007199254740993}';
    const lower = '{"amount":9007199254740992}';

    expect(higher).not.toBe(lower);
    expect(canonicalize(JSON.parse(higher))).toBe(canonicalize(JSON.parse(lower)));
  });

  it("rejects integers above MAX_SAFE_INTEGER in both signs", () => {
    expect(isStrictlyAdmissible('{"n":9007199254740993}')).toBe(false);
    expect(isStrictlyAdmissible('{"n":-9007199254740993}')).toBe(false);
  });

  it("admits integers at and below the safe boundary", () => {
    // 2^53 - 1 exactly. The boundary must be inclusive, or ordinary large ids break.
    expect(isStrictlyAdmissible(`{"n":${Number.MAX_SAFE_INTEGER}}`)).toBe(true);
    expect(isStrictlyAdmissible('{"n":0}')).toBe(true);
    expect(isStrictlyAdmissible('{"n":-1}')).toBe(true);
    expect(isStrictlyAdmissible('{"n":1234567890}')).toBe(true);
  });

  it("accepts a large value encoded as a string, which is the documented remedy", () => {
    expect(isStrictlyAdmissible('{"n":"9007199254740993"}')).toBe(true);
    // And the string form does NOT collapse, which is the point of the remedy.
    expect(canonicalize(JSON.parse('{"n":"9007199254740993"}'))).not.toBe(canonicalize(JSON.parse('{"n":"9007199254740992"}')));
  });
});

describe("R3 — excess significant digits", () => {
  it("demonstrates the collapse it prevents: two decimal literals, one canonical form", () => {
    const short = '{"rate":0.1}';
    const long = '{"rate":0.1000000000000000055511151231257827}';

    expect(short).not.toBe(long);
    expect(canonicalize(JSON.parse(short))).toBe(canonicalize(JSON.parse(long)));
  });

  it("rejects the over-precise literal and admits the ordinary one", () => {
    expect(isStrictlyAdmissible('{"rate":0.1000000000000000055511151231257827}')).toBe(false);
    expect(isStrictlyAdmissible('{"rate":0.1}')).toBe(true);
  });

  it("does NOT require exact representability, which would reject nearly all decimals", () => {
    // 0.1, 0.2, and 0.3 are none of them exactly representable as doubles. A rule demanding
    // exactness would reject all of them and be unusable. R3 targets over-precision only.
    for (const literal of ["0.1", "0.2", "0.3", "1.5", "3.14159", "-2.718"]) {
      expect(isStrictlyAdmissible(`{"v":${literal}}`), `${literal} must remain admissible`).toBe(true);
    }
  });

  it("does NOT require a canonical numeric form, so equivalent spellings stay admissible", () => {
    // E1 classifies numeric-exponent-form as consumer-EQUIVALENT and currently sound.
    // Rejecting these would convert a sound case into an availability failure.
    for (const literal of ["1e2", "100", "1.0e2", "1E2", "1e-2", "0.01", "-0", "0"]) {
      expect(isStrictlyAdmissible(`{"v":${literal}}`), `${literal} must remain admissible`).toBe(true);
    }
  });

  it("counts significant digits without counting leading zeros or the exponent", () => {
    expect(countSignificantDigits("0.1")).toBe(1);
    expect(countSignificantDigits("100")).toBe(3);
    expect(countSignificantDigits("0.000123")).toBe(3);
    expect(countSignificantDigits("1e100")).toBe(1);
    expect(countSignificantDigits("-1.5e-10")).toBe(2);
    expect(countSignificantDigits("0.1000000000000000055511151231257827")).toBe(34);
  });

  it("places the boundary at the double round-trip precision", () => {
    const seventeen = `{"v":0.${"1".repeat(MAX_SIGNIFICANT_DIGITS)}}`;
    const eighteen = `{"v":0.${"1".repeat(MAX_SIGNIFICANT_DIGITS + 1)}}`;
    expect(isStrictlyAdmissible(seventeen)).toBe(true);
    expect(isStrictlyAdmissible(eighteen)).toBe(false);
  });
});

describe("admission control is additive and does not alter canonicalization", () => {
  it("leaves canonicalize() byte-identical for admissible documents", () => {
    // Receipt v1 compatibility: every existing identity and signature must be unchanged.
    // This module gates input; it must never re-serialize.
    const documents = ['{"b":2,"a":1}', '{"n":[1,2,3]}', '{"s":"caf\\u00e9"}', '{"nested":{"x":{"y":null}}}', "{}", "[]"];
    for (const text of documents) {
      expect(canonicalize(parseStrictJson(text))).toBe(canonicalize(JSON.parse(text)));
    }
  });

  it("still admits every fixture the reproducibility corpus depends on", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const root = resolve(__dirname, "../../../..");

    // A guard that rejected the project's own valid receipts would be a regression, not a
    // hardening. This is the availability half of "fail closed".
    for (const fixture of ["hmac-baseline", "hmac-chained", "kms-style-rsa"]) {
      const text = readFileSync(resolve(root, `examples/reproducibility/receipts/${fixture}.receipt.json`), "utf8");
      expect(isStrictlyAdmissible(text), `${fixture} must remain admissible`).toBe(true);
    }
  });
});

describe("scanner correctness (adversarial input against the scanner itself)", () => {
  it("handles escapes, nesting, whitespace, and unicode without false positives", () => {
    const gnarly = `{
      "quote": "he said \\"hi\\"",
      "backslash": "a\\\\b",
      "solidus": "a\\/b",
      "controls": "\\b\\f\\n\\r\\t",
      "unicode": "\\u00e9\\u0301",
      "empty_obj": {},
      "empty_arr": [],
      "deep": {"a":{"b":{"c":[1,{"d":2}]}}},
      "nums": [0, -0, 1e2, 1.5, -3.25e-4]
    }`;
    expect(isStrictlyAdmissible(gnarly)).toBe(true);
    expect(parseStrictJson(gnarly)).toEqual(JSON.parse(gnarly));
  });

  it("does not treat a brace or colon inside a string as structure", () => {
    // A naive regex-based scanner breaks here. This is the classic tokenizer trap.
    expect(isStrictlyAdmissible('{"k":"}{:,\\"a\\":1"}')).toBe(true);
    expect(isStrictlyAdmissible('{"a":"a","b":"a"}')).toBe(true);
    // And a duplicate must still be caught when strings contain decoys.
    expect(isStrictlyAdmissible('{"a":"}{","a":2}')).toBe(false);
  });

  it("reports malformed JSON as a SyntaxError, distinct from an admission violation", () => {
    // Identity collapse and malformed input are different failures and must not be conflated.
    expect(() => findStrictAdmissionViolations('{"a":')).toThrow(SyntaxError);
    expect(() => findStrictAdmissionViolations("{'a':1}")).toThrow(SyntaxError);
    expect(() => findStrictAdmissionViolations('{"a":1}trailing')).toThrow(SyntaxError);
    expect(() => findStrictAdmissionViolations("")).toThrow(SyntaxError);
  });

  it("agrees with JSON.parse on every admissible document it accepts", () => {
    const cases = ["null", "true", "false", "0", '""', "[]", "{}", '{"a":[1,null,true,"x"]}', '[[[[1]]]]', '{"a":{"b":[{"c":1}]}}'];
    for (const text of cases) {
      expect(parseStrictJson(text)).toEqual(JSON.parse(text));
    }
  });

  it("collects every violation in one pass rather than stopping at the first", () => {
    const violations = findStrictAdmissionViolations('{"a":1,"a":2,"big":9007199254740993}');
    expect(violations).toHaveLength(2);
    expect(violations.map((violation) => violation.rule).sort()).toEqual(["duplicate_object_key", "unsafe_integer_magnitude"]);
  });

  it("carries the domain and every violation on the thrown error", () => {
    try {
      parseStrictJson('{"a":1,"a":2}');
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(StrictAdmissionError);
      const admissionError = error as StrictAdmissionError;
      expect(admissionError.domain).toBe("ghost_ark.strict_json_admission.v1");
      expect(admissionError.violations).toHaveLength(1);
      expect(admissionError.message).toMatch(/duplicate_object_key/u);
    }
  });
});
