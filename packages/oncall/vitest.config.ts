import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // The telemetry monitor suite provisions a workspace and writes to the
    // column store: one file at a time, and a budget that survives a cold
    // ClickHouse.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
