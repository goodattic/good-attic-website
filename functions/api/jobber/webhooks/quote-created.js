import { handleJobberQuoteWebhook } from "../../../../server/jobber-quote-webhook.js";

export async function onRequestPost(context) {
  return handleJobberQuoteWebhook(context);
}
