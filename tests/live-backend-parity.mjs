export const liveCommit = "6756e12e9d526fa593d281be90f91d12e2b9b3cd";
export const releaseParent = "0ebc4ec7bfe3fbd07547409bf09fc57dc5f3a9df";

// These exact live bytes are checked in release-synchronization.test.mjs.
export const liveBackendFiles = [
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
