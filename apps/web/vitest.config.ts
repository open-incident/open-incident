import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Unit tests for the app's own logic — the arithmetic behind a screen, and the
 * one drawing that earned a test of its own by taking a page down. Journeys
 * are the smoke suite's job. `@/` has to be declared here because Next
 * resolves it from tsconfig and vitest does not read that.
 */
export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  // Next compiles JSX with the automatic runtime; esbuild defaults to the
  // classic one, and a component rendered here would ask for a `React` the
  // file never imports.
  esbuild: { jsx: "automatic" },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
