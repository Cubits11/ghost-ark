import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every document stating the mutation gate must state the value in
 * stryker.config.json.
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-12 the config said `break: 80` while three documents still said 75:
 * the comment in .github/workflows/mutation.yml, the E10 prose in
 * docs/research/EXPERIMENTS.md — which contradicted its own history section
 * forty lines below, where the 75 -> 58 -> 70 -> 80 chain was recorded
 * correctly — and AGENTS.md, which recorded the historical 75 without stating
 * the current value at all. The gate has moved four times, each move applied
 * where somebody was looking and nowhere else. Nothing covered this, which is
 * why it drifted.
 *
 * Modeled on toolchainPinSync.test.ts: one declared source of truth, every
 * restating site checked against it, plus a sanity check that the patterns
 * still match something — a guard whose regex rots reports green forever.
 *
 * Like the other sync guards this enforces AGREEMENT, not truth: whether 80 is
 * the right threshold is decided by sweeps (EXPERIMENTS.md §E10), never here.
 */

const REPO_ROOT = resolve(__dirname, "../../..");

const read = (path: string): string => readFileSync(resolve(REPO_ROOT, path), "utf8");

function trackedProse(): string[] {
  return execFileSync("git", ["ls-files", "*.md", "*.yml", "*.yaml"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  })
    .split("\n")
    .filter((line) => line.length > 0);
}

/** stryker.config.json is the single source of truth for the gate. */
function configuredBreak(): number {
  const config = JSON.parse(read("stryker.config.json")) as {
    thresholds?: { break?: unknown };
  };
  const value = config.thresholds?.break;
  expect(value, "stryker.config.json must declare thresholds.break").toBeTypeOf("number");
  expect(value, "break must be a percentage").toBeGreaterThanOrEqual(0);
  expect(value, "break must be a percentage").toBeLessThanOrEqual(100);
  return value as number;
}

/**
 * A `break: N` immediately followed by "was set"/"was chosen" is recorded
 * history — this repository keeps its mistakes on the page (AGENTS.md,
 * EXPERIMENTS.md both narrate the mis-set 75). Anything else stating
 * `break: N` reads as the current gate and must agree with the config.
 */
const HISTORY_CONTINUATION = /^\s*was (?:set|chosen)/u;

interface Offence {
  readonly location: string;
  readonly detail: string;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

describe("mutation gate: every document agrees with stryker.config.json", () => {
  it("declares an integer break threshold in the config", () => {
    expect(Number.isInteger(configuredBreak())).toBe(true);
  });

  it("finds no document stating a different current gate", () => {
    const expected = configuredBreak();
    const offences: Offence[] = [];

    for (const file of trackedProse()) {
      const text = read(file);
      for (const match of text.matchAll(/`break: (\d+)`/gu)) {
        const stated = Number(match[1]);
        const index = (match.index ?? 0) + match[0].length;
        if (HISTORY_CONTINUATION.test(text.slice(index, index + 40))) continue;
        if (stated !== expected) {
          offences.push({
            location: `${file}:${lineOf(text, match.index ?? 0)}`,
            detail: `states break: ${stated}, stryker.config.json says ${expected}`
          });
        }
      }
    }

    expect(
      offences.map((o) => `${o.location} ${o.detail}`),
      "a document disagrees with the configured mutation gate"
    ).toEqual([]);
  });

  it("ends every break history chain at the current gate", () => {
    // "It has moved 75 -> 58 -> 70 -> 80" asserts, by its tail, what the gate
    // is NOW. A chain that stops at a superseded value is a stale claim wearing
    // history's clothing, which is exactly how the last drift survived review.
    const expected = configuredBreak();
    const offences: Offence[] = [];

    for (const file of trackedProse()) {
      const lines = read(file).split("\n");
      lines.forEach((line, i) => {
        const window = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
        if (!/\bbreak\b/iu.test(window)) return;
        for (const match of line.matchAll(/\b\d+(?:\s*(?:->|→)\s*\d+)+/gu)) {
          const hops = match[0].split(/\s*(?:->|→)\s*/u).map(Number);
          if (hops.length < 3) continue; // 2-hop arrows are correction notation, not gate history
          const tail = hops[hops.length - 1];
          if (tail !== expected) {
            offences.push({
              location: `${file}:${i + 1}`,
              detail: `history chain ends at ${tail}, config says ${expected}`
            });
          }
        }
      });
    }

    expect(offences.map((o) => `${o.location} ${o.detail}`)).toEqual([]);
  });

  it("still matches every site it exists to guard", () => {
    // The three sites that drifted on 2026-08-12, plus the two that were
    // already right. If a rewording stops the pattern matching in any of them,
    // this fails rather than letting the sweep above go silently blind.
    const expected = configuredBreak();
    for (const file of [
      ".github/workflows/mutation.yml",
      "docs/research/EXPERIMENTS.md",
      "AGENTS.md",
      "docs/artifact/CI_COVERAGE.md"
    ]) {
      const text = read(file);
      const current = [...text.matchAll(/`break: (\d+)`/gu)].filter((match) => {
        const index = (match.index ?? 0) + match[0].length;
        return !HISTORY_CONTINUATION.test(text.slice(index, index + 40));
      });
      expect(
        current.length,
        `${file} no longer states the current gate — update this guard's site list deliberately, not by accident`
      ).toBeGreaterThan(0);
      for (const match of current) {
        expect(Number(match[1]), `${file} current-gate statement`).toBe(expected);
      }
    }
  });
});
