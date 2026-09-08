import { handleJobberQuoIntakeNote } from '../../../server/jobber-quo-intake.js';
export const onRequest = context => handleJobberQuoIntakeNote(context);
