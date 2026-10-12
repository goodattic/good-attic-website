import { replayMatchedCallQuotes } from "../../../server/jobber-quote-attribution.js";

export async function onRequestPost(context) {
  return replayMatchedCallQuotes(context);
}
