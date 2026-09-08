import { handleJobberQuoIntakeStatus } from '../../../server/jobber-quo-intake.js';
export const onRequest = context => handleJobberQuoIntakeStatus(context);
