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
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_` prefixed parameters are the accepted way to name what a signature imposes.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Server actions and route handlers return promises Next.js awaits itself.
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
);
