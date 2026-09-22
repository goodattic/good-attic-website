import { _private as leadHelpers } from "../functions/api/leads.js";
import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";
import { createJobberPhase2Reader } from "../server/jobber-phase2-reader.js";
import { runReadOnlyBackfillWithReader } from "../server/google-ads-outcome-collection.js";

// Shadow-only scheduled backfill. The collector writes only the local outcome
// outbox; it never calls Jobber mutations or Google.
export async function runPhase2ShadowBackfill({ env, database = env.ANGI_ROUTER_DB, since = "2026-08-24T00:00:00Z" } = {}) {
  const reader = createJobberPhase2Reader({ tokenForMarket: async market => (await leadHelpers.refreshJobberAccessToken(env, getJobberOAuthRoute(market, "website"))).accessToken });
  const results = {};
  for (const market_key of ["ut", "mo_stl"]) results[market_key] = await runReadOnlyBackfillWithReader({ database, market_key, since, reader });
  return { ok: true, mode: "shadow", since, results };
}

export default { async scheduled(_event, env) { return runPhase2ShadowBackfill({ env }); } };
