import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Unit tests for the app's own logic — the arithmetic behind a screen, never
 * the screen. `@/` has to be declared here because Next resolves it from
 * tsconfig and vitest does not read that.
 */
export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
