import { handleJobberPhase2Webhook } from "../../../../server/jobber-phase2-webhook.js";

export async function onRequestPost(context) {
  return handleJobberPhase2Webhook(context);
}
