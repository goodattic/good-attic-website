import { handleJobberAuthorizationHealth } from "../../../../server/jobber-auth-health.js";

export async function onRequestPost(context) {
  return handleJobberAuthorizationHealth(context);
}
