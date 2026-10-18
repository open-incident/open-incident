/**
 * Runs once when the server starts. Configuration that is wrong should stop
 * the process here, not fail on the first request that needs it.
 */
export async function register() {
  const { assertStorageConfig } = await import("@openincident/storage");
  assertStorageConfig();
  // The chat adapter's "person on call for the service" (see lib/chat-on-call.ts).
  if (process.env.NEXT_RUNTIME === "nodejs") await import("@/lib/chat-on-call");
}
