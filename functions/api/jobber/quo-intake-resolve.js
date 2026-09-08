import { handleJobberQuoIntakeResolve } from '../../../server/jobber-quo-intake.js';
export const onRequest = context => handleJobberQuoIntakeResolve(context);
