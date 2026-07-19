import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "infra/cdk/test/**/*.test.ts", "packages/**/*.test.ts"],
    testTimeout: 15000,
    restoreMocks: true
  }
});
