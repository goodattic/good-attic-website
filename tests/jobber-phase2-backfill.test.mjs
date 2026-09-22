import test from "node:test";
import assert from "node:assert/strict";
import { runPhase2ShadowBackfill } from "../workers/jobber-phase2-backfill.js";

test("Phase 2 backfill is disabled unless explicitly enabled", async () => {
  const result = await runPhase2ShadowBackfill({ env: { PHASE2_SHADOW_ENABLED: "false" } });
  assert.deepEqual(result, { ok: true, mode: "disabled", processed: 0 });
});
