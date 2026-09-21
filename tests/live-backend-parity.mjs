export const liveCommit = "ed94cc5";
export const releaseParent = "fb97b94";

// These exact live bytes are checked in release-synchronization.test.mjs.
export const liveBackendFiles = [
  "migrations/0008_quo_call_attributions.sql",
  "server/jobber-quo-intake.js",
  "tests/jobber-quo-intake.test.mjs",
  "tests/approved-operational-hashes.mjs",
];
export const synchronizationFiles = [
  ...liveBackendFiles,
  "server/acknowledgement-source.js",
  "server/jobber-acknowledgement-resolver.js",
  "server/jobber-contact-resolver.js",
  "server/quo-client-name.js",
  "tests/fixtures/acknowledgement-sources.sql",
  "tests/fixtures/quo-intake-operations.sql",
  "tests/approved-operational-hashes.mjs",
  "tests/asset-delivery-helpers.mjs",
  "tests/protected-guide-header.test.mjs",
  "tests/modal-focus.test.mjs",
  "tests/live-backend-parity.mjs",
  "tests/release-synchronization.test.mjs",
];
