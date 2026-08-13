/**
 * A per-test time budget derived from the work the test actually does.
 *
 * WHY THIS EXISTS. `vitest.config.ts` sets `testTimeout: 15000`. That is a
 * *per-test* budget applied to every test regardless of cost, and it cannot be
 * right for a test whose runtime scales with a corpus: the cross-language
 * differential suites spawn a fresh interpreter once per fixture, sequentially,
 * so their cost is (fixtures × process startup) and grows every time a fixture
 * is added.
 *
 * Measured 2026-08-12: `tests/differential/pythonVerifierCorpus.test.ts` and
 * `tests/differential/nodeIndependentVerifier.test.ts` passed in isolation
 * (9/9 in 5.85s) and timed out at 15s during a full `npm test` on a loaded
 * machine. Nothing was wrong with the assertions; the budget was wrong.
 *
 * `make unit` already passes `--test-timeout=60000` and calls the reason
 * "a load-tolerant timeout". That flag does not reach `npm test`, and
 * `npm run validate` — which is what CI runs — calls `npm test`. So the
 * tolerance existed in one entry point and not in the one that gates merges.
 *
 * WHY DERIVED RATHER THAN A LARGER CONSTANT. A constant would be a second
 * magic number, and it would silently become wrong the next time the corpus
 * grows — which is precisely the drift this repository pins everywhere else.
 * The budget below is `spawns × PER_SPAWN_MS`, floored, so adding fixtures
 * raises the budget by construction.
 *
 * WHAT THIS DOES NOT DO. It does not make a hanging test pass. A test that
 * never completes still fails; only the threshold between "slow because the
 * machine is busy" and "broken" moves, and it moves in proportion to the
 * declared work. It is not a licence to let these suites get slower: if a
 * corpus-driven test needs more than its derived budget, the cost per fixture
 * has changed and that is worth knowing.
 */

/**
 * Allowance per subprocess spawn. Interpreter startup dominates: a `python3`
 * or `node` process that loads a verifier and exits costs on the order of
 * 100-200ms unloaded, and several times that when the suite is saturating
 * every core. 2s per spawn is deliberately generous against that ceiling.
 */
export const PER_SPAWN_MS = 2_000;

/** Floor, so a small corpus still gets more than the suite-wide default. */
export const CORPUS_TIMEOUT_FLOOR_MS = 30_000;

/**
 * Budget for a test that spawns one subprocess per item over `spawns` items.
 * Pass it as vitest's third `it()` argument.
 */
export function corpusTimeoutMs(spawns: number, floorMs = CORPUS_TIMEOUT_FLOOR_MS): number {
  if (!Number.isFinite(spawns) || spawns < 0) {
    throw new Error(`corpusTimeoutMs: spawn count must be a non-negative finite number, received ${spawns}`);
  }
  return Math.max(floorMs, Math.ceil(spawns) * PER_SPAWN_MS);
}
