/**
 * Runs once when the server starts. Configuration that is wrong should stop
 * the process here, not fail on the first request that needs it.
 */
export async function register() {
  const { assertStorageConfig } = await import("@openincident/storage");
  assertStorageConfig();
}
