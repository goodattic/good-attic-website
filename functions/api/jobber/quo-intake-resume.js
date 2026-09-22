import { handleJobberQuoIntakeResume } from '../../../server/jobber-quo-intake.js';

export const onRequest = context => handleJobberQuoIntakeResume(context);
