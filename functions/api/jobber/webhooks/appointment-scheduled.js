import { handleJobberAppointmentWebhook } from "../../../../server/jobber-appointment-webhook.js";

export async function onRequestPost(context) {
  return handleJobberAppointmentWebhook(context);
}
