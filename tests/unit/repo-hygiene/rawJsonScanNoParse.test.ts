import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { scanRawJson } from "../../../tools/experiments/rawJsonScan";

/**
 * Holds Arm E's measurement instrument to the one property its result depends on.
 *
 * E12 counts constructs that `JSON.parse` destroys: a duplicate member name is
 * gone after last-wins resolution, an integer above 2^53 has already been
 * rounded, two decimal literals sharing a double are indistinguishable once
 * either is a `number`. A scanner that parsed would report zero for every one of
 * them, and the zero would be a property of the instrument rather than of the
 * corpus — which E12 would then publish as "these constructs do not occur in
 * real traffic".
 *
 * That is not hypothetical in this repository. E1's own harness reported a
 * missing Python interpreter through the same channel CPython uses to reject an
 * input, and the headline count moved with the ambient environment while the run
 * still exited zero. The lesson recorded from it was that a measurement's
 * validity condition must be enforced mechanically rather than described in a
 * comment.
 *
 * Two guards, and the second is the one that matters:
 *
 *   SOURCE      the file must not call a JSON parser at all.
 *   BEHAVIOUR   the scanner must actually find the constructs. A file can pass
 *               the source check and still detect nothing, so absence of a
 *               function call is necessary and nowhere near sufficient.
 */

const SCANNER = resolve(__dirname, "../../../tools/experiments/rawJsonScan.ts");

describe("rawJsonScan does not parse", () => {
  const source = readFileSync(SCANNER, "utf8");

  it("never calls JSON.parse", () => {
    // Comments legitimately discuss JSON.parse, so the check is against code
    // lines only.
    const codeLines = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
      .join("\n");
    expect(codeLines).not.toMatch(/JSON\s*\.\s*parse/u);
  });

  it("never reaches for another parser either", () => {
    expect(source).not.toMatch(/require\(["']js-yaml["']\)/u);
    expect(source).not.toMatch(/from\s+["'](js-yaml|json5|jsonc-parser)["']/u);
  });

  it("does not use a substituting UTF-8 decoder, which would erase ill-formed input", () => {
    // Every TextDecoder in this file must be fatal. A non-fatal decoder maps a
    // family of distinct byte sequences onto one string by inserting U+FFFD,
    // which is exactly the collapse `invalid-utf8` exists to record.
    const decoders = source.match(/new TextDecoder\([^)]*\)/gu) ?? [];
    expect(decoders.length).toBeGreaterThan(0);
    for (const decoder of decoders) {
      expect(decoder).toContain("fatal: true");
    }
  });
});

describe("rawJsonScan actually detects, which the source check cannot establish", () => {
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

  it.each([
    ["duplicate-member-name", '{"a":1,"a":2}'],
    ["unsafe-magnitude-integer", '{"a":9007199254740993}'],
    ["non-round-tripping-literal", '{"a":0.1000000000000000055511151231257827}'],
    ["overflow-to-infinity", '{"a":1e400}'],
    ["underflow-to-zero", '{"a":1e-400}'],
    ["lone-surrogate-escape", '{"a":"\\ud800"}'],
    ["non-nfc-string", '{"a":"cafe\\u0301"}']
  ])("fires for %s", (findingClass, payload) => {
    const result = scanRawJson(encode(payload));
    expect(result.counts[findingClass as keyof typeof result.counts]).toBeGreaterThan(0);
  });

  it("stays silent on a payload shaped like the ones actually drawn", () => {
    const realistic =
      '{"_type":"https://in-toto.io/Statement/v1","subject":[{"name":"pkg:npm/x@1.0.0",' +
      '"digest":{"sha512":"6e0d4f4c"}}],"predicateType":"https://slsa.dev/provenance/v1",' +
      '"predicate":{"buildDefinition":{"buildType":"https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1"},' +
      '"runDetails":{"builder":{"id":"https://github.com/actions/runner"}}}}';
    expect(scanRawJson(encode(realistic)).findings).toEqual([]);
  });
});
