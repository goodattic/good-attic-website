import { handleJobberAppointmentResolve } from "../../../server/jobber-appointment-resolver.js";

export async function onRequestPost(context) {
  return handleJobberAppointmentResolve(context);
}
