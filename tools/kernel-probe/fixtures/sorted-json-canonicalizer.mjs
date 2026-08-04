#!/usr/bin/env node
/**
 * A minimal, honest canonicalizer — the one a competent engineer writes first.
 *
 * Reads one raw JSON document on stdin, writes a sorted-key canonical form on
 * stdout, exits non-zero if the input does not parse. That is the whole
 * contract `kernel-probe` expects of a target.
 *
 * It exists so `kernelProbeStandalone.test.ts` can run the standalone probe
 * end to end against a REAL target without depending on `jq` or `python3` being
 * installed. A parity test that skips when a binary is missing reports green
 * while measuring nothing, which is the defect `dab/bench` was quarantined for.
 *
 * It is also a worked example of the finding: this canonicalizer is *correct*
 * by any ordinary reading, and it still collapses duplicate keys — because
 * `JSON.parse` resolves them before a single line of this file executes. The
 * kernel belongs to the pipeline, not to the canonicalizer.
 */

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    // A refusal is a legitimate answer and is scored separately from a
    // collapse. Exiting non-zero is how a target says "I decline this input".
    process.exit(1);
  }
  process.stdout.write(canonicalize(value));
});

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}
