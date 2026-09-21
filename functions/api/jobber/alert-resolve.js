import {handleJobberAlertResolve} from '../../../server/jobber-alert-resolver.js';
export async function onRequestPost(context){return handleJobberAlertResolve(context);}
