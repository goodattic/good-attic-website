import { handleJobberContactResolve } from "../../../server/jobber-contact-resolver.js";

export async function onRequestPost(context) {
  return handleJobberContactResolve(context);
}
