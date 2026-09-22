import { handleJobberAuthHealth } from '../../../../server/jobber-auth-health.js';
export async function onRequestPost(context) { return handleJobberAuthHealth(context); }
