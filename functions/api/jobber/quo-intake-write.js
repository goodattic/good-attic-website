import { handleJobberQuoIntakeWrite } from '../../../server/jobber-quo-intake.js';
export const onRequest = context => handleJobberQuoIntakeWrite(context);
