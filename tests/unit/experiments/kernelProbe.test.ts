import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { PATHOLOGY_ALPHABET } from "../../../tools/experiments/kernelAlphabet";
import { probeKernel as probeKernelUncached, runTarget } from "../../../tools/experiments/kernelProbe";

/**
 * Guard tests for the standalone kernel probe.
 *
 * The probe is the generalization of E1/E11: point it at any command that reads
 * JSON on stdin and writes a canonical form on stdout, and it reports which
 * distinctions that canonicalizer destroys. It is the piece of this work usable
 * without Ghost-Ark, so its own correctness is the thing an outside user has to
 * trust before trusting anything it says.
 *
 * These tests calibrate it against canonicalizers whose kernels are known by
 * construction, which is the E4 discriminator applied to a measuring instrument:
 * a probe that reported the same thing for a degenerate canonicalizer and a
 * faithful one would measure nothing.
 */

const dir = mkdtempSync(join(tmpdir(), "ghost-ark-kernel-probe-"));

function script(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** Collapses everything: one output for every input. */
const DEGENERATE = script("degenerate", "cat >/dev/null\necho CONSTANT");
/** Collapses nothing: byte-identical echo, so only identical inputs collide. */
const IDENTITY = script("identity", "cat");
/** Accepts nothing. */
const REFUSE_ALL = script("refuse-all", "cat >/dev/null\nexit 1");

const DISTINCT_CLASSES = PATHOLOGY_ALPHABET.filter((p) => p.intent === "distinct").length;
const EQUIVALENT_CLASSES = PATHOLOGY_ALPHABET.filter((p) => p.intent === "equivalent").length;

/**
 * Memoized probe, pre-warmed below.
 *
 * `runTarget` spawns the target with `execFileSync` — one SYNCHRONOUS process per
 * pathology class. With 31 classes and eight `probeKernel` calls this file was
 * spawning ~248 processes, of which ~155 were redundant: the eight calls cover
 * only three distinct canonicalizers.
 *
 * That cost is invisible alone (3.4s) and fatal in the full suite, where vitest
 * runs many files concurrently and process-spawn latency balloons. Measured
 * 2026-08-06: 3.4s isolated versus 30.9s under full-suite load, against a 15s
 * per-test timeout — the exact recurrence AGENTS.md asked to have the test name
 * captured for.
 *
 * This is the fix already recorded in AGENTS.md for the CDK-synth flake, applied
 * to the same failure class: memoize the expensive call and pre-warm it in
 * `beforeAll`, so the cost is paid once and outside any individually-timed `it`.
 * It is NOT a raised timeout — the work is genuinely ~93 process spawns, and no
 * algorithmic defect is being masked. Do not reintroduce a per-test probe run.
 */
const probeCache = new Map<string, ReturnType<typeof probeKernelUncached>>();
function probeKernel(command: string): ReturnType<typeof probeKernelUncached> {
  const hit = probeCache.get(command);
  if (hit) {
    return hit;
  }
  const report = probeKernelUncached(command);
  probeCache.set(command, report);
  return report;
}

beforeAll(() => {
  for (const target of [DEGENERATE, IDENTITY, REFUSE_ALL]) {
    probeKernel(target);
  }
}, 120_000);

describe("kernel probe: calibration against known-kernel canonicalizers", () => {
  it("reports maximum collapse for a canonicalizer that maps everything to one output", () => {
    // Every `distinct`-intent pair becomes an unintended kernel member, and
    // nothing can be over-discriminated because nothing is ever distinguished.
    // If this did not hold, the probe would be under-reporting collapse.
    const report = probeKernel(DEGENERATE);
    expect(report.counts["unintended-kernel"]).toBe(DISTINCT_CLASSES);
    expect(report.counts["over-discrimination"]).toBe(0);
  });

  it("reports maximum discrimination for a byte-identical echo", () => {
    // The opposite extreme. Every `equivalent`-intent pair is split, and no pair
    // is collapsed, because the alphabet contains no two byte-identical sides —
    // an invariant `assertAlphabetWellFormed` enforces.
    const report = probeKernel(IDENTITY);
    expect(report.counts["unintended-kernel"]).toBe(0);
    expect(report.counts["over-discrimination"]).toBe(EQUIVALENT_CLASSES);
  });

  it("partitions the alphabet exactly between the two degenerate extremes", () => {
    // The calibration that ties the two above together: the classes one extreme
    // flags and the classes the other flags are disjoint and cover the alphabet.
    // A probe whose two extremes overlapped, or left classes unaccounted for,
    // would be miscounting intent somewhere.
    expect(DISTINCT_CLASSES + EQUIVALENT_CLASSES).toBe(PATHOLOGY_ALPHABET.length);
    const collapsed = new Set(probeKernel(DEGENERATE).unintended_kernel_members);
    const split = new Set(probeKernel(IDENTITY).over_discriminated);
    for (const id of collapsed) {
      expect(split.has(id), `${id} cannot be in both extremes`).toBe(false);
    }
    expect(collapsed.size + split.size).toBe(PATHOLOGY_ALPHABET.length);
  });

  it("scores a canonicalizer that refuses everything as fail-closed, not as sound", () => {
    // The control-arm problem. Refusing all input produces zero kernel members,
    // and a probe that reported that as success would rank a useless
    // canonicalizer above every real one.
    const report = probeKernel(REFUSE_ALL);
    expect(report.counts["fail-closed"]).toBe(PATHOLOGY_ALPHABET.length);
    expect(report.counts.sound).toBe(0);
    expect(report.unintended_kernel_members).toEqual([]);
  });
});

describe("kernel probe: the target contract", () => {
  it("treats a non-zero exit as a rejection rather than an error", () => {
    // A canonicalizer refusing malformed input is behaving well. Scoring that as
    // a crash, or as agreement, misreports it — and both mistakes have been made
    // in this repository's history.
    const outcome = runTarget(REFUSE_ALL, [], "{}");
    expect(outcome.status).toBe("rejected");
  });

  it("treats empty output as a rejection", () => {
    const empty = script("empty", "cat >/dev/null");
    expect(runTarget(empty, [], "{}").status).toBe("rejected");
  });

  it("digests the target's bytes rather than trusting it to hash", () => {
    // The probe computes SHA-256 itself, so a target need not agree with it
    // about hashing — and cannot influence identity by choosing a digest.
    const outcome = runTarget(IDENTITY, [], '{"a":1}');
    expect(outcome.status).toBe("digest");
    expect(outcome.status === "digest" && outcome.canonicalForm).toBe('{"a":1}');
  });

  it("raises rather than silently scoring when the command does not exist", () => {
    // A missing target is absence of evidence. Reporting it as 31 rejections
    // would look like a fail-closed canonicalizer, which is the same defect E1's
    // Python arm carried.
    expect(() => runTarget(join(dir, "no-such-command"), [], "{}")).toThrow(/command not found/u);
  });
});

describe("kernel probe: reporting discipline", () => {
  it("declares census provenance so no interval is attached", () => {
    expect(probeKernel(IDENTITY).sample_provenance).toBe("census");
  });

  it("carries a non-claim that does not read as a security verdict", () => {
    const report = probeKernel(IDENTITY);
    expect(report.non_claim).toMatch(/not a security review/u);
    expect(report.non_claim).toMatch(/not evidence of safety/u);
    // The most important sentence: a clean report is not a pass.
    expect(report.non_claim).toMatch(/Absence of a class here is not evidence of its absence/u);
  });

  it("reports the consumer rationale beside every finding", () => {
    // A kernel member is only a defect relative to someone who needs the
    // distinction. Emitting the id without the rationale would invite reading
    // the count as a score.
    const report = probeKernel(DEGENERATE);
    for (const cell of report.cells) {
      expect(cell.consumerRationale.length).toBeGreaterThan(0);
    }
  });
});
