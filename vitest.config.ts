import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "infra/cdk/test/**/*.test.ts", "packages/**/*.test.ts"],
    // 60s, matching `VITEST_TIMEOUT_MS ?= 60000` in the Makefile, which calls that value
    // "a load-tolerant timeout". Until 2026-08-12 this was 15000, so `make unit` was
    // load-tolerant and `npm test` was not — and CI runs `npm run validate`, which calls
    // `npm test`. The gate that decides merges had the stricter budget, so the flakes
    // landed there: three CDK stack tests and two cross-language differentials timed out
    // on a saturated machine while passing in 7s and 5.85s respectively in isolation.
    // Nothing was wrong with any of them; the budget was a unit-test budget applied to
    // tests whose cost is dominated by CDK app synthesis or interpreter startup.
    // A hung test now takes 60s to fail instead of 15s. That is the price, it is paid
    // once per hang, and it buys a gate whose red means "broken" rather than "busy".
    testTimeout: 60000,
    restoreMocks: true
  }
});
