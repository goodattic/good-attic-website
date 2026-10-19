// A phone conversion needs a reviewed Jobber milestone or a connected,
// two-speaker Quo call. This module performs no writes or Google requests.
import {qualifiedReaderFailure} from './qualified-phone-reader-diagnostics.js';

export const FOLLOW_UP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const ORIGINAL_CALL_CLOCK_SKEW_MS = 120 * 1000;

const validTime = value => Number.isFinite(Date.parse(value || ''));
const normalized = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const e164 = value => /^\+\d{10,15}$/.test(value || '') ? value : null;

export function jobberLeadProof({request, client, disposition} = {}) {
 if (!request?.id || !client?.id) return {ok:false, reason:'jobber_request_missing'};
 if (client.isArchived !== false) return {ok:false, reason:'jobber_client_archived_or_unknown'};
 const status = normalized(request.requestStatus);
 if (!status) return {ok:false, reason:'jobber_request_status_unknown'};
 if (['archived', 'junk', 'spam'].includes(status)) return {ok:false, reason:'jobber_request_archived_or_junk'};
 if (disposition) return {ok:false, reason:'jobber_lead_excluded'};
 const assessment = request.assessment;
 const scheduled = assessment?.id && validTime(assessment.startAt);
 const completed = assessment?.id && (assessment.isComplete === true || validTime(assessment.completedAt));
 const quoted = Array.isArray(request.quotes?.nodes) && request.quotes.nodes.some(quote => Boolean(quote?.id));
 return {ok:true, milestone:completed?'assessment_completed':scheduled?'assessment_scheduled':quoted?'quote':null};
}

export function twoWayQuoProof({call, transcript, callerPhone, phoneNumberId, googleCallAt} = {}) {
 const caller = e164(callerPhone);
 const start = Date.parse(googleCallAt || '');
 const callAt = Date.parse(call?.createdAt || '');
 const answeredAt = Date.parse(call?.answeredAt || '');
 if (!caller || !phoneNumberId || !Number.isFinite(start) || !Number.isFinite(callAt) || !Number.isFinite(answeredAt)) return false;
 if (callAt < start - ORIGINAL_CALL_CLOCK_SKEW_MS || callAt > start + FOLLOW_UP_WINDOW_MS
  || answeredAt < start - ORIGINAL_CALL_CLOCK_SKEW_MS || answeredAt > start + FOLLOW_UP_WINDOW_MS) return false;
 if (call.phoneNumberId !== phoneNumberId || !call.participants?.includes(caller)) return false;
 if (!['incoming', 'outgoing'].includes(call.direction) || call.status !== 'completed') return false;
 if (!Number.isFinite(Number(call.duration)) || Number(call.duration) < 60) return false;
 if (call.aiHandled && call.aiHandled !== 'none') return false;
 if (transcript?.callId !== call.id || transcript.status !== 'completed' || !Array.isArray(transcript.dialogue)) return false;
 const turns = transcript.dialogue.filter(turn => typeof turn?.content === 'string' && turn.content.trim());
 const callerSpoke = turns.some(turn => turn.identifier === caller);
 const staffSpoke = turns.some(turn => typeof turn.userId === 'string' && /^US/.test(turn.userId)
  && turn.identifier !== caller && call.participants.includes(turn.identifier));
 return callerSpoke && staffSpoke;
}

export async function quoConversationProof({apiKey, callerPhone, phoneNumberId, googleCallAt, fetcher = fetch} = {}) {
 if (!apiKey) return {ok:false, reason:'quo_proof_unavailable'};
 const caller = e164(callerPhone);
 const start = Date.parse(googleCallAt || '');
 if (!caller || !/^PN[\w-]+$/.test(phoneNumberId || '') || !Number.isFinite(start)) {
  return {ok:false, reason:'quo_proof_fields_missing'};
 }
 const seen = new Set();
 let pageToken = null;
 let transcriptUnavailable = false;
 let transcriptFailure = null;
 for (let page = 0; page < 20; page++) {
  const url = new URL('https://api.quo.com/v1/calls');
  url.searchParams.set('phoneNumberId', phoneNumberId);
  url.searchParams.set('participants', caller);
  url.searchParams.set('createdAfter', new Date(start - ORIGINAL_CALL_CLOCK_SKEW_MS - 1000).toISOString());
  url.searchParams.set('createdBefore', new Date(start + FOLLOW_UP_WINDOW_MS + 1000).toISOString());
  url.searchParams.set('maxResults', '100');
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  let response, body;
  try {
   response = await fetcher(url.toString(), {headers:{Authorization:apiKey}, redirect:'manual', signal:AbortSignal.timeout(20000)});
   if(response.status>=300&&response.status<400)throw Error('reader_external_redirect_blocked');
   body = await response.json();
   if (!response.ok || !Array.isArray(body?.data))throw Error('quo_calls_read_failed');
  } catch(error) { return {ok:false, reason:'quo_read_unavailable',reader_failure:qualifiedReaderFailure(error,{step:'quo_calls',api:'quo',http_status:response?.status})}; }
  for (const call of body.data) {
   if (!call?.id || !/^AC[\w-]+$/.test(call.id)) return {ok:false, reason:'quo_history_incomplete'};
   if (call.phoneNumberId !== phoneNumberId || !call.participants?.includes(caller)
       || call.status !== 'completed' || !validTime(call.answeredAt)
       || !Number.isFinite(Number(call.duration)) || Number(call.duration) < 60
       || (call.aiHandled && call.aiHandled !== 'none')) continue;
   const callAt = Date.parse(call.createdAt || '');
   if (!Number.isFinite(callAt) || callAt < start - ORIGINAL_CALL_CLOCK_SKEW_MS || callAt > start + FOLLOW_UP_WINDOW_MS) continue;
   let transcriptResponse, transcriptBody;
   try {
    transcriptResponse = await fetcher(`https://api.quo.com/v1/call-transcripts/${call.id}`,
      {headers:{Authorization:apiKey}, redirect:'manual', signal:AbortSignal.timeout(20000)});
    if(transcriptResponse.status>=300&&transcriptResponse.status<400)throw Error('reader_external_redirect_blocked');
    transcriptBody = await transcriptResponse.json();
    if (!transcriptResponse.ok || !transcriptBody?.data)throw Error('quo_transcript_read_failed');
   } catch(error) { transcriptUnavailable = true;transcriptFailure=qualifiedReaderFailure(error,{step:'quo_transcript',api:'quo',http_status:transcriptResponse?.status});continue; }
   if (twoWayQuoProof({call, transcript:transcriptBody.data, callerPhone:caller,
       phoneNumberId, googleCallAt})) return {ok:true, callId:call.id};
  }
  if (!body.nextPageToken) return {ok:false, reason:transcriptUnavailable?'quo_transcript_unavailable':'no_two_way_quo_conversation',...(transcriptFailure?{reader_failure:transcriptFailure}:{})};
  if (seen.has(body.nextPageToken)) return {ok:false, reason:'quo_history_incomplete'};
  seen.add(body.nextPageToken);
  pageToken = body.nextPageToken;
 }
 return {ok:false, reason:'quo_history_incomplete'};
}
