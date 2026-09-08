import { handleJobberAcknowledgementResolve } from '../../../server/jobber-acknowledgement-resolver.js';
export async function onRequestPost(context) { return handleJobberAcknowledgementResolve(context); }
