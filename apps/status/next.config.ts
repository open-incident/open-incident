import path from "node:path";
import type { NextConfig } from "next";

/**
 * The public status pages — a separate, minimal app. It reads one projection
 * (directory.status_snapshots) and nothing else of the product: no Redis, no
 * session, no tenant middleware. Subscribing writes through the database and
 * degrades gracefully when it is down.
 */
const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  transpilePackages: [
    "@openincident/ui",
    "@openincident/db",
    "@openincident/statuspages",
    "@openincident/mail",
    "@openincident/webhooks",
    "@openincident/crypto",
    "@openincident/config",
  ],
  serverExternalPackages: ["postgres", "nodemailer", "bullmq", "ioredis"],
};

export default nextConfig;
