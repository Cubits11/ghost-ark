/**
 * Ghost-Ark DAB Tier-0 — Adversarial + Performance Aggregate Runner
 *
 * This is the single entrypoint referenced (but never previously shipped) by
 * `dab/reproduce.sh` and `dab/agent-runtime/package.json`. It computes nothing
 * new: it imports the existing, self-contained exported suites and prints one
 * JSON document to stdout. The suites themselves produce the real detection
 * results — this file only aggregates them and derives an honest pass flag.
 *
 * Run (Node >= 22, native TypeScript type-stripping, zero dependencies):
 *
 *   node --experimental-strip-types dab/bench/run_all.ts
 *   node --experimental-strip-types dab/bench/run_all.ts --trials 2000
 *
 * Aggregate pass criterion (all must hold):
 *   - every mutation/replay/unicode/concurrency attack reports detected === true
 *   - the four formal games report global_advantage === 0 (all_passed === true)
 *
 * NON-CLAIM: a green result here demonstrates in-suite detection under the
 * modeled attacker only. It is not a proof of safety, and it says nothing about
 * the DAB gateway/verifier TCB, whose receipt shape is a known open gap (see
 * docs/artifact/repository_inventory.md §7.5).
 */

import { runMutationSuite } from "./attacks/mutation.ts";
import { runReplaySuite } from "./attacks/replay.ts";
import { runUnicodeSuite } from "./attacks/unicode.ts";
import { runConcurrencySuite } from "./attacks/concurrency.ts";
import { runAllFormalGames } from "./formal_games.ts";
import { runPerformanceBenchmark } from "./performance.ts";

interface DetectionResult {
  attack: string;
  detected: boolean;
  [key: string]: unknown;
}

function parseTrials(argv: string[]): number {
  const flagIndex = argv.indexOf("--trials");
  if (flagIndex !== -1 && argv[flagIndex + 1] !== undefined) {
    const parsed = Number.parseInt(argv[flagIndex + 1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const fromEnv = process.env.GHOST_DAB_TRIALS;
  if (fromEnv !== undefined) {
    const parsed = Number.parseInt(fromEnv, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 10_000;
}

function allDetected(results: DetectionResult[]): boolean {
  return results.length > 0 && results.every((r) => r.detected === true);
}

export function runAll(trials: number) {
  const attacks = {
    mutation: runMutationSuite() as DetectionResult[],
    replay: runReplaySuite() as DetectionResult[],
    unicode: runUnicodeSuite() as DetectionResult[],
    concurrency: runConcurrencySuite() as DetectionResult[],
  };

  const formalGames = runAllFormalGames(trials);
  const performance = runPerformanceBenchmark({
    iterations: Math.min(trials, 10_000),
    payloadSize: 1024,
  });

  const attacksAllDetected =
    allDetected(attacks.mutation) &&
    allDetected(attacks.replay) &&
    allDetected(attacks.unicode) &&
    allDetected(attacks.concurrency);

  return {
    protocol: "Ghost-Ark DAB Tier-0",
    trials,
    attacks,
    formal_games: formalGames,
    performance,
    // Compatibility fields consumed by dab/reproduce.sh:
    global_advantage: formalGames.global_advantage,
    all_passed: attacksAllDetected && formalGames.all_passed === true,
  };
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  const report = runAll(parseTrials(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.all_passed ? 0 : 1;
}
