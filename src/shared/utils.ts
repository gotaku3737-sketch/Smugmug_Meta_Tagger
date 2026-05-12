// ============================================================
// SmugMug Face Tagger — Shared Utilities
// ============================================================

/**
 * Resolves after a given number of milliseconds.
 * Useful for yielding to the event loop or simple delays.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
