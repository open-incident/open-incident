import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * One lint configuration for the whole monorepo — apps, packages and ee alike.
 * Kept deliberately small: the strict TypeScript options in tsconfig.base.json
 * already carry most of the weight, and a rule set nobody agrees with is a rule
 * set that gets switched off file by file.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/dist/**",
      "**/drizzle/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
      // Generated from a pinned rrweb by apps/web/scripts/build-rum-replay.mjs.
      // Linting somebody else's minified bundle reports six hundred problems
      // about code nobody here wrote and nobody here can fix.
      "apps/web/public/rum/oi-rum-replay.js",
      // Gradle's own HTML test reports ship a bundled script.
      "sdk/android/**/build/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    /*
     * The browser SDK, which is a script served to other people's pages rather
     * than anything this repository builds. It is still linted — it is the one
     * file here that runs on somebody else's site — but against the globals it
     * actually has, and as the plain ES5 it is deliberately written in so that
     * no build step stands between the source and what a page loads.
     */
    files: ["apps/web/public/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        history: "readonly",
        sessionStorage: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        Blob: "readonly",
        PerformanceObserver: "readonly",
      },
    },
  },
  {
    /* Build scripts. Node, not a browser and not Next. */
    files: ["apps/*/scripts/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    rules: {
      // `_` prefixed parameters are the accepted way to name what a signature imposes.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Server actions and route handlers return promises Next.js awaits itself.
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
);
