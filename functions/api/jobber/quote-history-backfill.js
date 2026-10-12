import { backfillHistoricalCallQuotes } from "../../../server/jobber-quote-attribution.js";

export async function onRequestPost(context) {
  return backfillHistoricalCallQuotes(context);
}
