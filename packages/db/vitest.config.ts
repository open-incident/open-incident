import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // Integration tests share one database: run them in one file at a time.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
