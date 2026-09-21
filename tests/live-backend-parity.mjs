export const liveCommit = "74c9c8d1aef2d6cd6ef56aa913753451e70f056b";
export const releaseParent = "0ebc4ec7bfe3fbd07547409bf09fc57dc5f3a9df";

// These exact live bytes are checked in release-synchronization.test.mjs.
export const liveBackendFiles = [
  "migrations/0007_quo_call_attributions.sql",
  "server/jobber-quo-intake.js",
  "server/quo-client-name.js",
  "tests/jobber-quo-intake.test.mjs",
  "tests/quo-phone-display.test.mjs",
];
export const synchronizationFiles = [
  ...liveBackendFiles,
  "tests/approved-operational-hashes.mjs",
  "tests/asset-delivery-helpers.mjs",
  "tests/protected-guide-header.test.mjs",
  "tests/modal-focus.test.mjs",
  "tests/live-backend-parity.mjs",
  "tests/release-synchronization.test.mjs",
];
