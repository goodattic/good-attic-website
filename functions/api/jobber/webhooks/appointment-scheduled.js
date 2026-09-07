import { handleJobberContactFanout } from "../../../../server/jobber-contact-fanout.js";

export async function onRequestPost(context) {
  return handleJobberContactFanout(context);
}
