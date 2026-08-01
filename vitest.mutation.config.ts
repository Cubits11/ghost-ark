import { defineConfig } from "vitest/config";

import { MUTATION_TEST_SCOPE } from "./tools/experiments/mutationScope";

/**
 * Vitest configuration used ONLY by Stryker for experiment E10 (mutation score).
 *
 * The default `vitest.config.ts` runs all 142 test files. Stryker re-runs the
 * suite once per surviving mutant, so the full include list makes E10
 * computationally infeasible (the full suite takes ~76s; a few hundred mutants
 * would take days).
 *
 * The narrowed include list below is NOT a convenience. It is the declared test
 * scope of the measurement: E10's mutation score answers "do the tests that
 * claim to cover the receipt trust kernel actually detect changes to it?", and
 * the honest denominator for that question is the tests that import the kernel.
 * Including unrelated tests would inflate nothing and cost everything, but
 * EXCLUDING a test that does cover the kernel would inflate the score by hiding
 * a mutant that something else would have killed.
 *
 * `tests/unit/experiments/mutationScope.test.ts` pins both halves of the scope
 * against the real import graph, so a kernel file added without a covering test,
 * or a covering test dropped from this list, fails CI rather than silently
 * shrinking the denominator.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [...MUTATION_TEST_SCOPE.testFiles],
    testTimeout: 15000,
    restoreMocks: true
  }
});
