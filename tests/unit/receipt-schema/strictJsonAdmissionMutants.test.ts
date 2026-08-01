import { describe, expect, it } from "vitest";

import {
  findStrictAdmissionViolations,
  isStrictlyAdmissible,
  parseStrictJson
} from "../../../packages/receipt-schema/src/strictJsonAdmission";

/**
 * Tests written to kill specific surviving mutants from experiment E10.
 *
 * The first completed E10 run scored `strictJsonAdmission.ts` at 81.4%
 * (263/323) with 60 survivors. A surviving mutant is a demonstrated gap: an edit
 * to the trust kernel that the entire 70-file declared scope does not detect.
 * The existing tests assert the three RULES well; what they did not assert is
 * the SCANNER underneath them — the hand-written parser that decides where a
 * key ends, what an escape decodes to, and which path a violation is reported
 * at. E1's whole mitigation claim rests on that scanner running correctly at the
 * text level, before `JSON.parse`.
 *
 * Each test below names the mutant it kills. Mutants judged EQUIVALENT — where
 * no observable behavior differs, so no test can kill them — are recorded at the
 * bottom rather than chased, because an unkillable mutant is a property of the
 * code, not a gap in the suite.
 */

describe("E10 survivors: escape decoding is load-bearing for duplicate detection", () => {
  // Kills the `case` arms at lines 142-164 (ConditionalExpression mutants).
  //
  // Why these survived: the existing duplicate-key tests use the SAME spelling
  // for both keys, so a broken escape arm corrupts both sides identically and
  // the duplicate is still found. The defect only shows when one key uses the
  // short escape and the other uses \u — which is exactly the adversarial case
  // R1 exists to catch, since a scanner that compares raw token text would miss
  // it and so would a scanner that decodes one form wrongly.
  const escapeForms: ReadonlyArray<{ name: string; short: string; unicode: string }> = [
    { name: "backspace", short: "\\b", unicode: "\\u0008" },
    { name: "form feed", short: "\\f", unicode: "\\u000c" },
    { name: "newline", short: "\\n", unicode: "\\u000a" },
    { name: "carriage return", short: "\\r", unicode: "\\u000d" },
    { name: "tab", short: "\\t", unicode: "\\u0009" },
    { name: "quote", short: '\\"', unicode: "\\u0022" },
    { name: "backslash", short: "\\\\", unicode: "\\u005c" },
    { name: "solidus", short: "\\/", unicode: "\\u002f" }
  ];

  for (const form of escapeForms) {
    it(`detects a duplicate key spelled ${form.name} two ways`, () => {
      const text = `{"a${form.short}b":1,"a${form.unicode}b":2}`;
      const violations = findStrictAdmissionViolations(text);

      expect(
        violations.filter((violation) => violation.rule === "duplicate_object_key"),
        `${form.name}: the two spellings must decode to the same key`
      ).toHaveLength(1);
    });
  }

  it("keeps distinct keys distinct after decoding", () => {
    // The negative control for the tests above. Without it, a scanner that
    // decoded EVERY escape to the empty string would pass all of them by
    // collapsing every key to "ab".
    const violations = findStrictAdmissionViolations('{"a\\bb":1,"a\\tb":2}');
    expect(violations.filter((violation) => violation.rule === "duplicate_object_key")).toHaveLength(0);
  });
});

describe("E10 survivors: \\u escape validation", () => {
  it("rejects a malformed \\u escape", () => {
    // Kills the ConditionalExpression mutant at line 168, which turns
    // `if (!/^[0-9a-fA-F]{4}$/u.test(hex))` into `if (false)` — accepting any
    // four characters as a hex escape.
    expect(() => parseStrictJson('{"a\\uZZZZ":1}')).toThrow(/malformed \\u escape/u);
  });

  it("accepts a well-formed \\u escape", () => {
    expect(isStrictlyAdmissible('{"a\\u0041b":1}')).toBe(true);
    expect(parseStrictJson('{"k":"\\u0041"}')).toEqual({ k: "A" });
  });

  it("rejects a truncated \\u escape at end of input", () => {
    expect(() => parseStrictJson('{"a\\u00":1}')).toThrow();
  });
});

describe("E10 survivors: violation paths inside arrays", () => {
  it("reports the array index a violating value sits at", () => {
    // Kills the AssignmentOperator mutant at line 330 (`arrayIndex += 1` ->
    // `arrayIndex -= 1`). No existing test asserted a path through an array
    // element, so the index could count backwards undetected.
    const violations = findStrictAdmissionViolations('[1, 9007199254740993, 3]');

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("unsafe_integer_magnitude");
    expect(violations[0]?.path, "the offending element is at index 1").toContain("/1");
  });

  it("distinguishes two violations at different array indices", () => {
    const violations = findStrictAdmissionViolations('[9007199254740993, 0, 9007199254740994]');
    const paths = violations.map((violation) => violation.path);

    expect(violations).toHaveLength(2);
    expect(new Set(paths).size, "two distinct elements must not report the same path").toBe(2);
  });
});

describe("E10 survivors: the magnitude rule fires only on integers past the boundary", () => {
  it("admits an ordinary integer with no violation at all", () => {
    // Kills the ConditionalExpression mutant at line 240, which replaces the
    // whole `isInteger && Number.isFinite(parsed) && Math.abs(parsed) >
    // MAX_SAFE_INTEGER` guard with `true` — flagging every numeric literal.
    expect(findStrictAdmissionViolations('{"a":1,"b":-42,"c":0}')).toEqual([]);
  });

  it("admits a fractional literal whose magnitude exceeds the safe integer boundary", () => {
    // Kills the BooleanLiteral mutants at lines 215 and 222 (`isInteger = false`
    // -> `true`) when a fraction or exponent is seen. With isInteger forced true,
    // a large NON-integer would wrongly trip unsafe_integer_magnitude, a rule
    // that exists because distinct INTEGERS above 2^53-1 share a double. 1e300 is
    // representable and carries few significant digits, so neither R2 nor R3
    // should fire.
    expect(findStrictAdmissionViolations('{"a":1e300}')).toEqual([]);
    expect(findStrictAdmissionViolations('{"a":1.5}')).toEqual([]);
  });

  it("still rejects the integer immediately above the safe boundary", () => {
    // The negative control: the tests above must not pass by disabling R2.
    const violations = findStrictAdmissionViolations('{"a":9007199254740993}');
    expect(violations.map((violation) => violation.rule)).toEqual(["unsafe_integer_magnitude"]);
  });
});

describe("E10 survivors: structural scanning", () => {
  it("requires a colon between key and value, and says so", () => {
    // The message match is the load-bearing part, and the first version of this
    // test did not have it. A bare `.toThrow()` passed with the line-300 check
    // deleted, because the scanner then consumed `1` as if it were the colon and
    // failed a token later with a different message. Mutation testing caught
    // that: the mutant survived, which is the signal that the assertion could
    // not tell "failed for the right reason" from "failed for some reason".
    expect(() => parseStrictJson('{"a" 1}')).toThrow(/expected ':' after object key/u);
  });

  it("requires a quoted object key, and says so", () => {
    // Same correction. With the line-124 body removed the scanner walks past the
    // unquoted key and eventually fails elsewhere, so only a message assertion
    // distinguishes the two.
    expect(() => parseStrictJson("{a:1}")).toThrow(/expected a string/u);
  });

  it("rejects a leading plus on a numeric literal", () => {
    // Kills the sign-handling mutants at line 207. `+1` is not JSON; admitting
    // it is how jq manufactures a kernel member (E7 finding F7.4).
    expect(() => parseStrictJson('{"a":+1}')).toThrow();
  });

  it("admits a leading minus", () => {
    expect(parseStrictJson('{"a":-1}')).toEqual({ a: -1 });
  });
});

/**
 * MEASURED EFFECT, and what remains.
 *
 * Re-running E10 over this file after adding these tests, same host and same
 * pinned scope:
 *
 *   covered mutation score  81.4% (263/323)  ->  87.8% (287/327)
 *   survivors                          60    ->  40
 *   no-coverage                        11    ->   7
 *
 * Twenty-six distinct mutant signatures were newly killed, including every arm
 * of the escape-sequence switch, the `\u` validation guard, the array-index
 * counter, and the magnitude guard.
 *
 * TWO PREDICTIONS IN THE FIRST VERSION OF THIS FILE WERE WRONG, and the re-run
 * is how that was found. The tests at lines 300 and 124 were written asserting a
 * bare `.toThrow()`, and both mutants SURVIVED: deleting each check does not stop
 * the parse from failing, it only makes it fail later with a different message.
 * An assertion that cannot tell "failed for the right reason" from "failed for
 * some reason" is not a test of that check. Both now match on the message. This
 * is the same defect class as E4's tautological benchmarks, found in tests
 * written specifically to close an E10 gap.
 *
 * EQUIVALENT MUTANTS — recorded, not chased. Killing every mutant is not
 * achievable in principle: equivalent-mutant detection is undecidable, and a
 * zero-survivor target creates pressure to write assertions that kill mutants
 * rather than tests that catch defects.
 *
 *   line 168, Regex `/^[0-9a-fA-F]{4}$/u` -> `/[0-9a-fA-F]{4}$/u` and
 *   -> `/^[0-9a-fA-F]{4}/u`
 *     `hex` is `text.slice(index, index + 4)`, so it is at most four characters.
 *     For a four-character subject both anchors are redundant; for a shorter one
 *     the `{4}` quantifier already fails. No input can distinguish the three.
 *     PREDICTED equivalent before the re-run; both did survive it.
 *
 *   17 StringLiteral mutants in violation `message` fields
 *     Diagnostics. Tests assert `rule`, `path`, and `offset` — the
 *     machine-readable contract. Pinning prose would make every wording
 *     improvement a test failure for no gain in detection.
 *
 * The remaining ~21 non-string survivors are mostly loop-bound comparisons
 * (`index < length` -> `<=`) in the scanner. They are NOT claimed equivalent;
 * they are unexamined, and saying so is more useful than a guess.
 */
