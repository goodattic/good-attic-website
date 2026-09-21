import { resolveQuoteAttribution } from "../../../server/jobber-quote-attribution.js";

export async function onRequestPost(context) {
  return resolveQuoteAttribution(context);
}
