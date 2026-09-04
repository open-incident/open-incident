import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker image: `NEXT_OUTPUT=standalone pnpm build` produces .next/standalone
  // (a standalone server traced over the whole monorepo). Without the variable,
  // a classic build — `next start` and the smoke suite stay unchanged.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  // The user guide is read from docs/guide at request time: the standalone
  // image must carry the chapters and their illustrations.
  outputFileTracingIncludes: {
    "/app/docs/[slug]": ["../../docs/guide/**/*"],
    "/app/docs/img/[file]": ["../../docs/guide/img/**/*"],
    "/app/docs": ["../../docs/guide/**/*"],
  },
  transpilePackages: [
    "@openincident/ui",
    "@openincident/config",
    "@openincident/crypto",
    "@openincident/db",
    "@openincident/auth",
    "@openincident/mail",
    "@openincident/webhooks",
    "@openincident/oncall",
    "@openincident/chat",
    "@openincident/statuspages",
    "@openincident/ai",
    "@openincident/storage",
    "@openincident/trackers",
    "@openincident/docs",
    "@openincident/catalog",
    "@openincident/ee-web",
    "@openincident/qa",
  ],
  // postgres.js, nodemailer and BullMQ stay on the Node side.
  serverExternalPackages: ["postgres", "nodemailer", "bullmq", "ioredis"],
};

export default nextConfig;
