import { _private as leadHelpers } from '../functions/api/leads.js';
import { _private as contacts } from './jobber-contact-resolver.js';
import { QUO_UNKNOWN_CLIENT_NAME } from './quo-client-name.js';
import { normalizeAcknowledgementPhone as normalizePhone, canonicalJobberId, sourceHash } from './acknowledgement-source.js';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_PAGES = 20;
const LEASE_MS = 120_000;
const MESSAGE_NOTE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MARKET_INPUT = {utah:'ut', stl:'mo_stl', kc:'mo_kc'};
const NUMBERS = {
  utah: {id:'PNqw8amabk', number:'+13853364442'},
  stl: {id:'PN6LVKAV9A', number:'+13149312620'},
  kc: {id:'PNZBZnj8mz', number:'+18164340308'},
};
const QUERIES = {
  phones: `query GoodAtticQuoIntakePhones($searchTerm:String!,$after:String) {
    account { id }
    clientPhones(searchTerm:$searchTerm, first:100, after:$after) {
      nodes { id number normalizedPhoneNumber client {id isArchived} contact {id} }
      pageInfo {hasNextPage endCursor}
    }
  }`,
  requests: `query GoodAtticQuoIntakeRequests($id:EncodedId!,$after:String) {
    account {id} client(id:$id) {id isArchived
      requests(first:100,after:$after) {nodes {id} pageInfo {hasNextPage endCursor}}
    }
  }`,
  jobs: `query GoodAtticQuoIntakeJobs($id:EncodedId!,$after:String) {
    account {id} client(id:$id) {id isArchived
      jobs(first:100,after:$after) {nodes {id} pageInfo {hasNextPage endCursor}}
    }
  }`,
  client: `query GoodAtticQuoIntakeClient($id:EncodedId!) {
    account {id} client(id:$id) {id isArchived phones {number normalizedPhoneNumber}}
  }`,
  account: 'query GoodAtticQuoIntakeAccount {account {id}}',
  noteParent: 'query GoodAtticQuoNoteParent($id:EncodedId!) {account {id} request(id:$id) {id client {id}}}',
  messageNoteParent: 'query GoodAtticQuoMessageNoteParent($id:EncodedId!) {account {id} request(id:$id) {id createdAt requestStatus assessment {id} client {id isArchived}}}',
};
const MUTATIONS = {
  client: `mutation GoodAtticQuoIntakeClient($input:ClientCreateInput!) {
    clientCreate(input:$input) {client {id phones {number normalizedPhoneNumber}} userErrors {message path}}
  }`,
  request: `mutation GoodAtticQuoIntakeRequest($input:RequestCreateInput!) {
    requestCreate(input:$input) {request {id jobberWebUri client {id}} userErrors {message path}}
  }`,
  note: `mutation GoodAtticQuoIntakeNote($requestId:EncodedId!,$input:RequestCreateNoteInput!) {
    requestCreateNote(requestId:$requestId,input:$input) {requestNote {id} userErrors {message path}}
  }`,
};
const FINAL_STATES = new Set(['completed','held','suppressed']);
const WRITE_STATES = new Set(['client_creating','request_creating','note_creating']);
const CALL_ATTRIBUTION_MARKETS = new Set(['utah','stl']);
const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const canonical = (v,type) => canonicalJobberId(v,type);
const validOperation = v => typeof v==='string' && /^[A-Za-z0-9:_-]{1,240}$/.test(v);
const isObject = v => v && typeof v==='object' && !Array.isArray(v);
const nowFor = deps => typeof deps.now==='function' ? deps.now() : Date.now();
class IntakeError extends Error {
  constructor(code,status=503,uncertain=false) {super(code);this.code=code;this.status=status;this.uncertain=uncertain;}
}
function routeInput(input) {
  const route=contacts.ROUTES.get(input?.account_id);
  const market=input?.market;
  if(!route || MARKET_INPUT[market]!==route.marketKey || input.phone_number_id!==NUMBERS[market]?.id
    || normalizePhone(input.phone)!==input.phone) throw new IntakeError('intake_identity_invalid',400);
  return {route, identity:{account_id:route.expectedAccountId,market,phone:input.phone,phone_number_id:input.phone_number_id}};
}
function cleanSource(source,identity,now) {
  if(!isObject(source) || Object.keys(source).some(k=>!['type','id','event_id','occurred_at','occurred_at_original','conversation_id','from','to','status','direction','answered_at','completed_at','duration','first_time_caller_status','text','media','quo_url','summary','transcript','voicemail','contact_id','first_name','last_name'].includes(k))) throw new IntakeError('intake_source_invalid',400);
  if(!['call','message'].includes(source.type) || !validOperation(source.id) || !validOperation(source.event_id)
    || !validOperation(source.conversation_id) || normalizePhone(source.from)!==identity.phone
    || normalizePhone(source.to)!==NUMBERS[identity.market].number
    || typeof source.status!=='string' || !source.status || source.status.length>80
    || typeof source.occurred_at!=='string' || !Number.isFinite(Date.parse(source.occurred_at))
    || Date.parse(source.occurred_at)>now+300_000) throw new IntakeError('intake_source_invalid',400);
  const originalOccurredAt=source.occurred_at_original ?? source.occurred_at;
  if(typeof originalOccurredAt!=='string'||!Number.isFinite(Date.parse(originalOccurredAt))||Date.parse(originalOccurredAt)>now+300_000||Date.parse(originalOccurredAt)!==Date.parse(source.occurred_at)) throw new IntakeError('intake_source_invalid',400);
  const result={type:source.type,id:source.id,event_id:source.event_id,occurred_at:new Date(source.occurred_at).toISOString(),occurred_at_original:originalOccurredAt,conversation_id:source.conversation_id,from:identity.phone,to:NUMBERS[identity.market].number,status:source.status,direction:source.direction||'incoming'};
  if(result.direction!=='incoming') throw new IntakeError('intake_source_invalid',400);
  if(source.first_time_caller_status!=null) {
    if(typeof source.first_time_caller_status!=='string'||source.first_time_caller_status.length>64||/[\u0000-\u001f\u007f]/.test(source.first_time_caller_status)) throw new IntakeError('intake_source_invalid',400);
    result.first_time_caller_status=source.first_time_caller_status;
  }
  for(const key of ['answered_at','completed_at']) if(source[key]!=null) {
    if(typeof source[key]!=='string'||!Number.isFinite(Date.parse(source[key]))||Date.parse(source[key])>now+300_000)throw new IntakeError('intake_source_invalid',400);
    result[key]=new Date(source[key]).toISOString();
  }
  if(source.contact_id!=null) {
    if(!validOperation(source.contact_id))throw new IntakeError('intake_source_invalid',400);
    result.contact_id=source.contact_id;
  }
  for(const key of ['first_name','last_name']) if(source[key]!=null) {
    if(!result.contact_id||typeof source[key]!=='string'||source[key].length>200||/[\u0000-\u001f\u007f]/.test(source[key]))throw new IntakeError('intake_source_invalid',400);
    result[key]=source[key].trim();
  }
  if(source.duration!=null) {
    if(!Number.isFinite(source.duration)||source.duration<0||source.duration>86400*7)throw new IntakeError('intake_source_invalid',400);
    result.duration=source.duration;
  }
  for(const key of ['text','summary','transcript','voicemail']) if(source[key]!=null) {
    if(typeof source[key]!=='string'||source[key].length>48_000)throw new IntakeError('intake_source_invalid',400);
    result[key]=source[key];
  }
  if(source.media!=null) {
    if(!Array.isArray(source.media)||source.media.length>30)throw new IntakeError('intake_source_invalid',400);
    result.media=source.media.map(value=>safeUrl(value,false));
  }
  if(source.quo_url!=null)result.quo_url=safeUrl(source.quo_url,true);
  return result;
}
function safeUrl(value,quo) {
  if(typeof value!=='string'||value.length>4096)throw new IntakeError('intake_source_invalid',400);
  let url;try {url=new URL(value);} catch {throw new IntakeError('intake_source_invalid',400);}
  if(url.protocol!=='https:'||url.username||url.password||url.port||(quo&&!['my.quo.com','app.quo.com','app.openphone.com'].includes(url.hostname)))throw new IntakeError('intake_source_invalid',400);
  return url.href;
}
async function inputFor({request,env},allowed) {
  if(request.method!=='POST')throw new IntakeError('method_not_allowed',405);
  if(!await contacts.authorized(request,env.CONTACT_SYNC_BROKER_SECRET))throw new IntakeError('unauthorized',401);
  if(Number(request.headers.get('Content-Length'))>MAX_BODY_BYTES)throw new IntakeError('payload_too_large',413);
  let text,input;try{text=await request.text();}catch{throw new IntakeError('invalid_body',400);}
  if(new TextEncoder().encode(text).length>MAX_BODY_BYTES)throw new IntakeError('payload_too_large',413);
  try{input=JSON.parse(text);}catch{throw new IntakeError('invalid_json',400);}
  if(!isObject(input)||Object.keys(input).some(key=>!allowed.includes(key)))throw new IntakeError('invalid_input',400);
  if(!env.ANGI_ROUTER_DB?.prepare)throw new IntakeError('jobber_authoritative_database_unavailable');
  return input;
}
async function read(deps,env,token,route,query,variables={}) {
  const response=await deps.jobberGraphql(env,token.accessToken,query,variables);
  // A populated, conflicting account is never re-labelled as a permissions
  // problem, even when GraphQL also returns partial data and errors.
  if(response?.data?.account?.id!=null&&!contacts.sameId(response.data.account.id,route.expectedAccountId,'Account'))throw new IntakeError('jobber_account_mismatch',409);
  if(response?.errors?.length) {
    // Match Jobber's observed explicit object-authorization error only. Other
    // GraphQL/transport failures remain retryable; raw provider text stays out
    // of the public response. This applies to reads, never mutation outcomes.
    if(response.errors.some(error=>typeof error?.message==='string'&&/^An object of type [A-Za-z][A-Za-z0-9_]* was hidden due to permissions\.?$/u.test(error.message)))throw new IntakeError('jobber_permission_denied',403);
    throw new IntakeError('jobber_read_failed');
  }
  if(!contacts.sameId(response?.data?.account?.id,route.expectedAccountId,'Account'))throw new IntakeError('jobber_account_mismatch',409);
  return response.data;
}
const permissionDenied=error=>error instanceof IntakeError&&error.code==='jobber_permission_denied';
function page(connection,seen) {
  if(!isObject(connection)||!Array.isArray(connection.nodes)||connection.nodes.length>100
    ||typeof connection.pageInfo?.hasNextPage!=='boolean')throw new IntakeError('intake_history_incomplete');
  const next=connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  if(connection.pageInfo.hasNextPage && (typeof next!=='string'||!next||next.length>1000||seen.has(next)||connection.nodes.length===0))throw new IntakeError('intake_history_incomplete');
  if(next)seen.add(next);
  return next;
}
async function exactClient(env,deps,token,route,identity,clientId) {
  const data=await read(deps,env,token,route,QUERIES.client,{id:clientId});
  const client=data.client;
  if(!contacts.sameId(client?.id,clientId,'Client')||typeof client.isArchived!=='boolean'
    ||!Array.isArray(client.phones)||client.phones.length>1000)throw new IntakeError('known_client_unavailable');
  let matches=false;
  for(const phone of client.phones) {
    if(!phone||typeof phone.number!=='string'||(phone.normalizedPhoneNumber!==null&&typeof phone.normalizedPhoneNumber!=='string'))throw new IntakeError('intake_phone_identity_conflict',409);
    const raw=normalizePhone(phone.number),normalized=normalizePhone(phone.normalizedPhoneNumber);
    if((phone.number.trim()&&!raw)||(phone.normalizedPhoneNumber&&!normalized)||(raw&&normalized&&raw!==normalized))throw new IntakeError('intake_phone_identity_conflict',409);
    if((normalized||raw)===identity.phone)matches=true;
  }
  if(!matches)throw new IntakeError('known_client_phone_changed',409);
  return client;
}
async function classify(env,deps,token,route,identity,knownClientId=null) {
  const matches=new Map();
  for(const searchTerm of [identity.phone,identity.phone.slice(2)]) {
    let after=null;const seen=new Set();let complete=false;
    for(let index=0;index<MAX_PAGES;index++) {
      const data=await read(deps,env,token,route,QUERIES.phones,{searchTerm,after});
      const connection=data.clientPhones;const next=page(connection,seen);
      for(const entry of connection.nodes) {
        if(!entry||typeof entry.number!=='string'||!canonical(entry.client?.id,'Client')||typeof entry.client.isArchived!=='boolean')throw new IntakeError('intake_history_incomplete');
        const raw=normalizePhone(entry.number),normalized=normalizePhone(entry.normalizedPhoneNumber);
        if(entry.normalizedPhoneNumber!=null&&!normalized)throw new IntakeError('intake_history_incomplete');
        if(normalized&&raw&&raw!==normalized)throw new IntakeError('intake_phone_identity_conflict',409);
        if((normalized||raw)===identity.phone)matches.set(canonical(entry.client.id,'Client'),entry.client.isArchived);
      }
      if(!next){complete=true;break;}after=next;
    }
    if(!complete)throw new IntakeError('intake_history_incomplete');
  }
  // A client returned by a completed create can be readable by ID before phone
  // search indexes it. Only a saved selected/created ID may fill that one gap;
  // all search pages still run and any other matching client remains a conflict.
  if(knownClientId&&!matches.has(knownClientId)) {
    if(!canonical(knownClientId,'Client'))throw new IntakeError('invalid_known_client',409);
    const client=await exactClient(env,deps,token,route,identity,knownClientId);
    matches.set(knownClientId,client.isArchived);
  }
  const base={...identity,client_id:null,request_ids:[],job_ids:[],history_complete:true,retryable:false};
  if(matches.size>1)return {...base,classification:'held_shared_phone',reason:'multiple_clients_share_phone'};
  if(!matches.size)return {...base,classification:'eligible_new_client',reason:'phone_not_in_destination_account'};
  const [clientId,initialArchived]=[...matches.entries()][0];let archived=initialArchived;base.client_id=clientId;
  try {for(const kind of ['requests','jobs']) {
    let after=null;const seen=new Set(),ids=new Set();let complete=false;
    for(let index=0;index<MAX_PAGES;index++) {
      const data=await read(deps,env,token,route,QUERIES[kind],{id:clientId,after});
      if(!contacts.sameId(data.client?.id,clientId,'Client')||typeof data.client.isArchived!=='boolean')throw new IntakeError('intake_history_incomplete');
      archived ||= data.client.isArchived;
      const connection=data.client[kind],next=page(connection,seen);
      for(const node of connection.nodes) {
        const id=canonical(node?.id,kind==='requests'?'Request':'Job');
        if(!id||ids.has(id))throw new IntakeError('intake_history_incomplete');
        ids.add(id);
      }
      if(!next){complete=true;break;}after=next;
    }
    if(!complete)throw new IntakeError('intake_history_incomplete');
    base[kind==='requests'?'request_ids':'job_ids']=[...ids];
  }}catch(error) {
    if(permissionDenied(error)) {
      // Preserve diagnostic context only after both complete phone searches
      // found one client and a fresh direct read confirms its current phone.
      // Known IDs are evidence of existence, never proof of absent history.
      try {await exactClient(env,deps,token,route,identity,clientId);}
      catch(verificationError) {
        if(verificationError instanceof IntakeError&&verificationError.status===409)throw verificationError;
        throw error;
      }
      error.verifiedHistory={client_id:clientId,request_ids:base.request_ids,job_ids:base.job_ids};
    }
    throw error;
  }
  // Reconfirm the actual saved phone after the complete history reads. A phone
  // search hit alone must not authorize writing after staff change that client.
  const current=await exactClient(env,deps,token,route,identity,clientId);
  archived ||= current.isArchived;
  if(base.request_ids.length||base.job_ids.length)return {...base,classification:'suppressed_existing_customer',reason:'prior_request_or_job'};
  if(archived)return {...base,classification:'held_archived_client',reason:'archived_unused_client'};
  return {...base,classification:'eligible_unused_client',reason:'client_has_no_requests_or_jobs'};
}
function classificationError(identity,error) {
  return {ok:true,...identity,classification:'held_incomplete_history',reason:error instanceof IntakeError?error.code:'jobber_read_failed',client_id:null,request_ids:[],job_ids:[],...(permissionDenied(error)?error.verifiedHistory:{}),history_complete:false,retryable:!(error instanceof IntakeError&&(error.status===409||permissionDenied(error)))};
}
const IDENTITY_FIELDS=['account_id','market','phone','phone_number_id'];
export async function handleJobberQuoIntakeResolve(context,deps=leadHelpers) {
  try {
    const input=await inputFor(context,IDENTITY_FIELDS),{route,identity}=routeInput(input);
    try {
      const token=await deps.refreshJobberAccessToken(context.env,route);
      return json({ok:true,...await classify(context.env,deps,token,route,identity)});
    } catch(error) {return json(classificationError(identity,error));}
  }catch(error){return errorResponse(error);}
}
function errorResponse(error) {return json({ok:false,code:error instanceof IntakeError?error.code:'intake_broker_unavailable'},error instanceof IntakeError?error.status:503);}
async function getOperation(db,id) {return db.prepare('SELECT * FROM quo_intake_operations WHERE operation_id = ?').bind(id).first();}
async function run(db,sql,args) {const result=await db.prepare(sql).bind(...args).run();if(result?.success===false)throw new IntakeError('intake_checkpoint_failed');return result?.meta?.changes||0;}
function publicOperation(row,now=Date.now()) {
  const working=WRITE_STATES.has(row.operation_state);
  return {ok:true,account_id:row.account_id,market:row.market,phone:row.phone,phone_number_id:row.phone_number_id,
    operation_id:row.operation_id,operation_state:row.operation_state,classification:row.classification||null,reason:row.reason||null,
    client_id:row.client_id||null,request_id:row.request_id||null,note_id:row.note_id||null,jobberWebUri:row.jobber_web_uri||null,
    retryable:!FINAL_STATES.has(row.operation_state)&&(!working||Number(row.lease_expires_at)>now),
    uncertain:!!row.uncertain||(working&&Number(row.lease_expires_at)<=now)};
}
export async function handleJobberQuoIntakeStatus(context,deps=leadHelpers) {
  try {
    const input=await inputFor(context,['account_id','operation_id']);
    const route=contacts.ROUTES.get(input.account_id);
    if(!route||!validOperation(input.operation_id))throw new IntakeError('invalid_input',400);
    const row=await getOperation(context.env.ANGI_ROUTER_DB,input.operation_id);
    if(!row)throw new IntakeError('intake_operation_not_found',404);
    if(row.account_id!==route.expectedAccountId)throw new IntakeError('intake_operation_identity_conflict',409);
    return json(publicOperation(row,nowFor(deps)));
  }catch(error){return errorResponse(error);}
}
async function checkpoint(db,row,lease,state,fields={},now) {
  const allowed=['classification','reason','client_id','request_id','note_id','jobber_web_uri','uncertain'];
  if(Object.keys(fields).some(k=>!allowed.includes(k)))throw new IntakeError('intake_checkpoint_invalid');
  const entries=Object.entries(fields);
  const changed=await run(db,`UPDATE quo_intake_operations SET operation_state = ?, updated_at = ?${entries.map(([key])=>`, ${key} = ?`).join('')}
    WHERE operation_id = ? AND lease_token = ? AND lease_expires_at > ?`,
    [state,new Date(now).toISOString(),...entries.map(([,value])=>value),row.operation_id,lease,now]);
  if(changed!==1)throw new IntakeError('intake_lease_lost');
  Object.assign(row,{operation_state:state,updated_at:new Date(now).toISOString()},fields);
}
async function hold(db,row,lease,reason,now,uncertain=false) {
  await checkpoint(db,row,lease,'held',{reason,uncertain:uncertain?1:0},now);
  return row;
}
async function holdPermissionError(db,row,lease,error,now) {
  await checkpoint(db,row,lease,'held',{reason:error.code,classification:row.classification||'held_incomplete_history',
    ...(!row.client_id&&error.verifiedHistory?.client_id?{client_id:error.verifiedHistory.client_id}:{})},now);
  return row;
}
function mutationData(result,key,objectKey,type) {
  const payload=result?.data?.[key];
  if(result?.errors?.length||!isObject(payload)||!Array.isArray(payload.userErrors))throw new IntakeError('jobber_write_outcome_unknown',503,true);
  const object=payload[objectKey];
  if(payload.userErrors.length) {
    if(object?.id)throw new IntakeError('jobber_write_outcome_unknown',503,true);
    throw new IntakeError(`${key}_rejected`,422);
  }
  if(!canonical(object?.id,type))throw new IntakeError('jobber_write_outcome_unknown',503,true);
  return object;
}
function requestUrl(value,requestId) {
  let url;try{url=new URL(value);}catch{throw new IntakeError('jobber_write_outcome_unknown',503,true);}
  const numericId=atob(requestId).split('/').pop();
  if(url.protocol!=='https:'||url.hostname!=='secure.getjobber.com'||url.username||url.password||url.port||url.search||url.hash
    ||!new RegExp(`^/(?:requests|work_requests)/${numericId}/?$`).test(url.pathname))throw new IntakeError('jobber_write_outcome_unknown',503,true);
  return url.href;
}
function newClientNames(source) {
  const firstName=typeof source.first_name==='string'?source.first_name.trim():'';
  const lastName=typeof source.last_name==='string'?source.last_name.trim():'';
  if(firstName||lastName)return {...(firstName?{firstName}:{}),...(lastName?{lastName}:{})};
  return {firstName:source.type==='call'?source.from:QUO_UNKNOWN_CLIENT_NAME};
}
function noteMessage(row,source) {
  const lines=[row.operation_kind==='note'?`Good Attic Quo ${source.type==='message'?'text':'call'} update`:'Good Attic Quo incoming inquiry',
    `Source: Quo ${source.type==='message'?'text':'call'}`,`Operation ID: ${row.operation_id}`,
    `Market: ${row.market}`,`Customer phone: ${row.phone}`,`Market phone: ${source.to}`,`Quo phone number ID: ${row.phone_number_id}`,
    `Quo ${source.type} ID: ${source.id}`,`Quo event ID: ${source.event_id}`,`Quo conversation ID: ${source.conversation_id}`,
    `Received: ${source.occurred_at}`,`Status: ${source.status}`];
  if(row.operation_kind==='intake'&&row.classification==='eligible_new_client'
    &&!source.first_name?.trim()&&!source.last_name?.trim())lines.push('At initial capture: Name not yet collected; the temporary intake name is not a confirmed customer name.');
  for(const [key,label] of [['answered_at','Answered'],['completed_at','Completed'],['duration','Duration (seconds)'],['quo_url','Open in Quo'],['text','Customer text'],['summary','Call summary'],['transcript','Call transcript'],['voicemail','Voicemail']]) {
    if(source[key]!=null)lines.push(`${label}: ${source[key]}`);
  }
  if(source.media?.length)lines.push(`Media:\n${source.media.join('\n')}`);
  return lines.join('\n');
}
async function upsertCallAttribution(db,row,source,now) {
  if(row.operation_kind!=='intake'||source.type!=='call'||!CALL_ATTRIBUTION_MARKETS.has(row.market))return;
  const original=source.occurred_at_original||source.occurred_at;
  const utc=new Date(source.occurred_at).toISOString();
  const existing=await db.prepare('SELECT * FROM quo_call_attributions WHERE account_id = ? AND quo_call_id = ?').bind(row.account_id,source.id).first();
  if(existing) {
    for(const [key,value] of [['market',row.market],['phone_number_id',row.phone_number_id],['caller_phone',row.phone],['call_started_at_original',original],['call_started_at_utc',utc],['destination_number',source.to],['direction',source.direction],['final_status',source.status],['source_event_id',source.event_id],['conversation_id',source.conversation_id]]) {
      if(existing[key]!==value)throw new IntakeError('call_attribution_identity_conflict',409);
    }
    await run(db,`UPDATE quo_call_attributions SET duration_seconds = ?, first_time_caller_status = ?, jobber_request_id = ?, jobber_client_id = ?, updated_at = ?
      WHERE account_id = ? AND quo_call_id = ?`,[source.duration??null,source.first_time_caller_status??null,row.request_id||null,row.client_id||null,new Date(now).toISOString(),row.account_id,source.id]);
    return;
  }
  await run(db,`INSERT INTO quo_call_attributions
    (attribution_id,account_id,market,phone_number_id,quo_call_id,caller_phone,call_started_at_original,call_started_at_utc,destination_number,direction,final_status,duration_seconds,first_time_caller_status,jobber_request_id,jobber_client_id,source_event_id,conversation_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      `quo-call:${row.account_id}:${source.id}`,row.account_id,row.market,row.phone_number_id,source.id,row.phone,original,utc,source.to,source.direction,source.status,source.duration??null,source.first_time_caller_status??null,row.request_id||null,row.client_id||null,source.event_id,source.conversation_id,new Date(now).toISOString(),new Date(now).toISOString()
    ]);
}
async function createNote(env,deps,token,row,lease) {
  const db=env.ANGI_ROUTER_DB;
  await checkpoint(db,row,lease,'note_creating',{},nowFor(deps));
  try {
    const source=JSON.parse(row.source_json);
    const input={message:noteMessage(row,source),...(source.media?.length?{attachments:[...new Set(source.media)].map(url=>({url:safeUrl(url,false)}))}:{})};
    const result=await deps.jobberGraphql(env,token.accessToken,MUTATIONS.note,{requestId:row.request_id,input});
    const note=mutationData(result,'requestCreateNote','requestNote','RequestNote');
    await checkpoint(db,row,lease,'completed',{note_id:canonical(note.id,'RequestNote'),reason:'intake_recorded'},nowFor(deps));
  }catch(error) {
    await hold(db,row,lease,error instanceof IntakeError?error.code:'jobber_note_outcome_unknown',nowFor(deps),!(error instanceof IntakeError)||error.uncertain);
  }
  return row;
}
async function verifyMessageNoteParent(env,deps,token,route,identity,row) {
  // The original integration Request must remain the client's only inquiry.
  // classify exhausts both phone indexes and both histories, then directly
  // re-reads the client's current phone independently of the search index.
  const current=await classify(env,deps,token,route,identity,row.client_id);
  if(current.classification!=='suppressed_existing_customer'||current.client_id!==row.client_id
    ||!current.request_ids.includes(row.request_id))throw new IntakeError('intake_message_parent_history_changed',409);
  const data=await read(deps,env,token,route,QUERIES.messageNoteParent,{id:row.request_id});
  const request=data.request;
  if(!contacts.sameId(request?.id,row.request_id,'Request')||!contacts.sameId(request?.client?.id,row.client_id,'Client')
    ||request.client.isArchived!==false||typeof request.requestStatus!=='string'||!request.requestStatus
    ||(request.assessment!==null&&(!isObject(request.assessment)||typeof request.assessment.id!=='string'||!request.assessment.id))
    ||!Number.isFinite(Date.parse(request.createdAt)))throw new IntakeError('intake_message_request_not_new',409);
  return current.request_ids.length===1&&current.job_ids.length===0&&request.requestStatus==='new'&&request.assessment===null;
}
async function processIntake(env,deps,token,route,identity,input,row,lease) {
  const db=env.ANGI_ROUTER_DB;
  if(row.operation_state==='request_created') {
    await upsertCallAttribution(db,row,JSON.parse(row.source_json),nowFor(deps));
    return createNote(env,deps,token,row,lease);
  }
  let classification;
  try{classification=await classify(env,deps,token,route,identity,row.client_id);}catch(error){
    if(error instanceof IntakeError&&error.status===409)return hold(db,row,lease,error.code,nowFor(deps));
    if(permissionDenied(error))return holdPermissionError(db,row,lease,error,nowFor(deps));
    throw error instanceof IntakeError?error:new IntakeError('jobber_read_failed');
  }
  if(!classification.classification.startsWith('eligible_')) {
    await checkpoint(db,row,lease,classification.classification.startsWith('suppressed')?'suppressed':'held',
      {classification:row.classification||classification.classification,reason:classification.reason,...(!row.client_id&&classification.client_id?{client_id:classification.client_id}:{})},nowFor(deps));
    return row;
  }
  const expected=row.client_id||input.expected_client_id;
  if(classification.client_id!==expected) return hold(db,row,lease,'client_identity_changed_before_write',nowFor(deps));
  await checkpoint(db,row,lease,row.operation_state,{classification:row.classification||classification.classification},nowFor(deps));
  if(!row.client_id) {
    if(classification.client_id) {
      await checkpoint(db,row,lease,'client_created',{client_id:classification.client_id},nowFor(deps));
    }else {
      await checkpoint(db,row,lease,'client_creating',{},nowFor(deps));
      try {
        // Jobber requires a name. Use a visibly generic system placeholder only
        // for a new client whose canonical Quo contact has no actual name.
        const result=await deps.jobberGraphql(env,token.accessToken,MUTATIONS.client,{input:{
          phones:[{description:'MAIN',number:identity.phone,primary:true}],
          receivesReminders:false,receivesFollowUps:false,receivesQuoteFollowUps:false,
          receivesInvoiceFollowUps:false,receivesReviewRequests:false,
          sourceAttribution:{sourceText:'Quo'},
          ...newClientNames(JSON.parse(row.source_json)),
        }});
        const client=mutationData(result,'clientCreate','client','Client');
        // Persist the returned ID before validating any optional response data.
        await checkpoint(db,row,lease,'client_created',{client_id:canonical(client.id,'Client')},nowFor(deps));
        if(!Array.isArray(client.phones)||!client.phones.some(p=>(normalizePhone(p.normalizedPhoneNumber)||normalizePhone(p.number))===identity.phone))return hold(db,row,lease,'created_client_phone_mismatch',nowFor(deps));
      }catch(error) {
        return hold(db,row,lease,error instanceof IntakeError?error.code:'jobber_client_outcome_unknown',nowFor(deps),!(error instanceof IntakeError)||error.uncertain);
      }
    }
  }
  // A native Angi/website/staff Request could appear while client creation was
  // underway. Recheck the full destination history immediately before creating.
  let fresh;
  try{fresh=await classify(env,deps,token,route,identity,row.client_id);}catch(error){
    if(error instanceof IntakeError&&error.status===409)return hold(db,row,lease,error.code,nowFor(deps));
    if(permissionDenied(error))return holdPermissionError(db,row,lease,error,nowFor(deps));
    throw error;
  }
  if(fresh.classification!=='eligible_unused_client'||fresh.client_id!==row.client_id) return hold(db,row,lease,'inquiry_or_identity_changed_before_request',nowFor(deps));
  await checkpoint(db,row,lease,'request_creating',{},nowFor(deps));
  const source=JSON.parse(row.source_json);
  try {
    const result=await deps.jobberGraphql(env,token.accessToken,MUTATIONS.request,{input:{clientId:row.client_id,title:`Quo ${source.type==='message'?'text':'call'} inquiry [${source.id}]`}});
    const request=mutationData(result,'requestCreate','request','Request');
    await checkpoint(db,row,lease,'request_created',{request_id:canonical(request.id,'Request')},nowFor(deps));
    if(!contacts.sameId(request.client?.id,row.client_id,'Client'))return hold(db,row,lease,'created_request_client_mismatch',nowFor(deps));
    const uri=requestUrl(request.jobberWebUri,row.request_id);
    await checkpoint(db,row,lease,'request_created',{jobber_web_uri:uri},nowFor(deps));
  }catch(error) {
    return hold(db,row,lease,error instanceof IntakeError?error.code:'jobber_request_outcome_unknown',nowFor(deps),!(error instanceof IntakeError)||error.uncertain);
  }
  // The Request checkpoint remains authoritative if the local ledger is
  // temporarily unavailable; retrying can attach it without replaying Jobber.
  await upsertCallAttribution(db,row,source,nowFor(deps));
  return createNote(env,deps,token,row,lease);
}
async function handleWrite(context,deps,kind) {
  let row,lease;
  try {
    const allowed=[...IDENTITY_FIELDS,'operation_id','source',...(kind==='note'?['parent_operation_id','request_id']:['expected_client_id'])];
    const input=await inputFor(context,allowed),{route,identity}=routeInput(input);
    if(!validOperation(input.operation_id))throw new IntakeError('invalid_input',400);
    const source=cleanSource(input.source,identity,nowFor(deps));
    if(kind==='intake') {
      if(input.expected_client_id!==null&&!canonical(input.expected_client_id,'Client'))throw new IntakeError('invalid_input',400);
      input.expected_client_id=input.expected_client_id===null?null:canonical(input.expected_client_id,'Client');
    }else if(!validOperation(input.parent_operation_id)||input.parent_operation_id===input.operation_id||!canonical(input.request_id,'Request'))throw new IntakeError('invalid_input',400);
    if(context.env.QUO_INTAKE_WRITE_ENABLED!=='true')throw new IntakeError('quo_intake_writes_disabled',503);
    const cutoff=Date.parse(context.env.QUO_INTAKE_LIVE_SINCE);
    if(!Number.isFinite(cutoff)||Date.parse(source.occurred_at)<cutoff)throw new IntakeError('quo_intake_before_cutover',409);
    const db=context.env.ANGI_ROUTER_DB;
    let parent=null;
    if(kind==='note') {
      parent=await getOperation(db,input.parent_operation_id);
      const parentSource=parent?JSON.parse(parent.source_json):null;
      if(!parent||parent.operation_kind!=='intake'||!parent.request_id||!parent.jobber_web_uri||!['completed','request_created','held'].includes(parent.operation_state)
        ||IDENTITY_FIELDS.some(key=>parent[key]!==identity[key])||parent.request_id!==canonical(input.request_id,'Request')
        ||parentSource.conversation_id!==source.conversation_id)throw new IntakeError('intake_note_parent_mismatch',409);
      if(source.type==='message') {
        const parentTime=Date.parse(parentSource.occurred_at),messageTime=Date.parse(source.occurred_at);
        if(parent.operation_state!=='completed'||parent.uncertain||!['call','message'].includes(parentSource.type)||!Number.isFinite(parentTime)||parentTime<cutoff
          ||!['received','read'].includes(source.status)||(!source.text?.trim()&&!source.media?.length)
          ||/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|START|UNSTOP|HELP)$/iu.test((source.text||'').trim())
          ||messageTime<parentTime||messageTime>parentTime+MESSAGE_NOTE_WINDOW_MS
          ||nowFor(deps)-parentTime>MESSAGE_NOTE_WINDOW_MS)throw new IntakeError('intake_message_outside_new_inquiry',409);
        const originalSourceGuard=await db.prepare('SELECT operation_id FROM quo_intake_source_guards WHERE account_id = ? AND source_type = ? AND source_id = ?').bind(identity.account_id,parentSource.type,parentSource.id).first();
        const originalPhoneGuard=await db.prepare('SELECT operation_id FROM quo_intake_phone_guards WHERE account_id = ? AND phone_sha256 = ?').bind(identity.account_id,await sourceHash(identity.phone)).first();
        if(originalSourceGuard?.operation_id!==parent.operation_id||originalPhoneGuard?.operation_id!==parent.operation_id)throw new IntakeError('intake_message_parent_guard_conflict',409);
      }else if(parentSource.type!=='call'||parentSource.id!==source.id||parentSource.occurred_at!==source.occurred_at)throw new IntakeError('intake_note_parent_mismatch',409);
    }
    const intent={kind,...identity,source,expected_client_id:input.expected_client_id??null,parent_operation_id:input.parent_operation_id??null,request_id:input.request_id?canonical(input.request_id,'Request'):null};
    const hash=await sourceHash(JSON.stringify(intent)),timestamp=new Date(nowFor(deps)).toISOString();
    await run(db,`INSERT OR IGNORE INTO quo_intake_operations
      (operation_id,operation_kind,parent_operation_id,account_id,market,phone,phone_number_id,intent_sha256,source_json,operation_state,client_id,request_id,jobber_web_uri,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?)`,
      [input.operation_id,kind,input.parent_operation_id||null,identity.account_id,identity.market,identity.phone,identity.phone_number_id,hash,JSON.stringify(source),parent?.client_id||null,parent?.request_id||null,parent?.jobber_web_uri||null,timestamp,timestamp]);
    row=await getOperation(db,input.operation_id);
    if(!row||row.intent_sha256!==hash||row.account_id!==identity.account_id)throw new IntakeError('intake_operation_identity_conflict',409);
    if(FINAL_STATES.has(row.operation_state))return json(publicOperation(row,nowFor(deps)));
    if(kind==='intake'||source.type==='message') {
      await run(db,'INSERT OR IGNORE INTO quo_intake_source_guards (account_id,source_type,source_id,operation_id,created_at) VALUES (?,?,?,?,?)',[identity.account_id,source.type,source.id,row.operation_id,timestamp]);
      const sourceGuard=await db.prepare('SELECT operation_id FROM quo_intake_source_guards WHERE account_id = ? AND source_type = ? AND source_id = ?').bind(identity.account_id,source.type,source.id).first();
      if(!sourceGuard)throw new IntakeError('intake_checkpoint_failed');
      if(sourceGuard.operation_id!==row.operation_id) {
        await run(db,"UPDATE quo_intake_operations SET operation_state = 'suppressed', reason = 'source_already_claimed', updated_at = ? WHERE operation_id = ? AND operation_state = 'pending'",[timestamp,row.operation_id]);
        return json(publicOperation(await getOperation(db,row.operation_id),nowFor(deps)));
      }
    }
    if(kind==='intake') {
      const phoneHash=await sourceHash(identity.phone);
      await run(db,'INSERT OR IGNORE INTO quo_intake_phone_guards (account_id,phone_sha256,operation_id,created_at) VALUES (?,?,?,?)',[identity.account_id,phoneHash,row.operation_id,timestamp]);
      const guard=await db.prepare('SELECT operation_id FROM quo_intake_phone_guards WHERE account_id = ? AND phone_sha256 = ?').bind(identity.account_id,phoneHash).first();
      if(!guard)throw new IntakeError('intake_checkpoint_failed');
      if(guard.operation_id!==row.operation_id) {
        await run(db,"UPDATE quo_intake_operations SET operation_state = 'suppressed', reason = 'phone_already_claimed', updated_at = ? WHERE operation_id = ? AND operation_state = 'pending'",[timestamp,row.operation_id]);
        return json(publicOperation(await getOperation(db,row.operation_id),nowFor(deps)));
      }
    }
    lease=crypto.randomUUID();
    const acquired=await run(db,`UPDATE quo_intake_operations SET lease_token = ?,lease_expires_at = ? WHERE operation_id = ? AND
      (lease_token IS NULL OR lease_expires_at <= ?) AND operation_state NOT IN ('completed','held','suppressed')`,[lease,nowFor(deps)+LEASE_MS,row.operation_id,nowFor(deps)]);
    if(acquired!==1)return json(publicOperation(await getOperation(db,row.operation_id),nowFor(deps)));
    row=await getOperation(db,row.operation_id);
    if(WRITE_STATES.has(row.operation_state)) {
      await hold(db,row,lease,'previous_jobber_write_outcome_unknown',nowFor(deps),true);
      return json(publicOperation(row,nowFor(deps)));
    }
    const token=await deps.refreshJobberAccessToken(context.env,route);
    await read(deps,context.env,token,route,QUERIES.account);
    if(kind==='note') {
      if(source.type==='message') {
        try{
          if(!await verifyMessageNoteParent(context.env,deps,token,route,identity,row)){
            await checkpoint(db,row,lease,'suppressed',{reason:'existing_customer_or_request_progressed'},nowFor(deps));
            return json(publicOperation(row,nowFor(deps)));
          }
        }
        catch(error){if(error instanceof IntakeError&&error.status===409){await hold(db,row,lease,error.code,nowFor(deps));return json(publicOperation(row,nowFor(deps)));}throw error;}
        await createNote(context.env,deps,token,row,lease);
      }else {
        const verified=await read(deps,context.env,token,route,QUERIES.noteParent,{id:row.request_id});
        if(!contacts.sameId(verified.request?.id,row.request_id,'Request')||!contacts.sameId(verified.request?.client?.id,row.client_id,'Client'))await hold(db,row,lease,'intake_note_request_identity_changed',nowFor(deps));
        else await createNote(context.env,deps,token,row,lease);
      }
    }
    else await processIntake(context.env,deps,token,route,identity,input,row,lease);
    return json(publicOperation(row,nowFor(deps)));
  }catch(error) {
    // If a provider may have accepted a write, the persisted *_creating marker
    // remains the authority even if writing the terminal hold itself failed.
    if(row&&lease) {
      try {
        const current=await getOperation(context.env.ANGI_ROUTER_DB,row.operation_id);
        if(current?.lease_token===lease&&WRITE_STATES.has(current.operation_state)) {
          await hold(context.env.ANGI_ROUTER_DB,current,lease,'jobber_write_outcome_unknown',nowFor(deps),true);
          return json(publicOperation(current,nowFor(deps)));
        }
        if(current?.lease_token===lease&&!FINAL_STATES.has(current.operation_state)&&permissionDenied(error)) {
          await holdPermissionError(context.env.ANGI_ROUTER_DB,current,lease,error,nowFor(deps));
          return json(publicOperation(current,nowFor(deps)));
        }
      }catch{}
    }
    return errorResponse(error);
  }finally {
    if(row&&lease)try{await run(context.env.ANGI_ROUTER_DB,'UPDATE quo_intake_operations SET lease_token = NULL,lease_expires_at = NULL WHERE operation_id = ? AND lease_token = ?',[row.operation_id,lease]);}catch{}
  }
}
/** Explicit operator recovery of a proven partial create, never a new intent. */
export async function handleJobberQuoIntakeResume(context,deps=leadHelpers) {
  let row,lease;
  try {
    const input=await inputFor(context,[...IDENTITY_FIELDS,'operation_id','expected_client_id']);
    const {route,identity}=routeInput(input),clientId=canonical(input.expected_client_id,'Client');
    if(!validOperation(input.operation_id)||!clientId)throw new IntakeError('invalid_input',400);
    const db=context.env.ANGI_ROUTER_DB;
    row=await getOperation(db,input.operation_id);
    if(!row)throw new IntakeError('intake_operation_not_found',404);
    if(row.operation_kind!=='intake'||IDENTITY_FIELDS.some(key=>row[key]!==identity[key])||row.client_id!==clientId)throw new IntakeError('intake_recovery_identity_conflict',409);
    if(row.operation_state==='completed')return json(publicOperation(row,nowFor(deps)));
    // A repeated request during active work is a status read, not another write.
    if(!FINAL_STATES.has(row.operation_state))return json(publicOperation(row,nowFor(deps)));
    if(row.operation_state!=='held'||row.reason!=='inquiry_or_identity_changed_before_request'
      ||row.classification!=='eligible_new_client'||row.uncertain||row.request_id||row.note_id||row.jobber_web_uri)throw new IntakeError('intake_recovery_not_safe',409);
    if(context.env.QUO_INTAKE_WRITE_ENABLED!=='true')throw new IntakeError('quo_intake_writes_disabled',503);
    let source;try{source=cleanSource(JSON.parse(row.source_json),identity,nowFor(deps));}catch{throw new IntakeError('intake_recovery_source_invalid',409);}
    const sourceTime=Date.parse(source.occurred_at),cutoff=Date.parse(context.env.QUO_INTAKE_LIVE_SINCE);
    if(!Number.isFinite(cutoff)||sourceTime<cutoff||nowFor(deps)-sourceTime>24*60*60*1000)throw new IntakeError('intake_recovery_outside_cutover',409);
    const original={kind:'intake',...identity,source,expected_client_id:null,parent_operation_id:null,request_id:null};
    if(await sourceHash(JSON.stringify(original))!==row.intent_sha256)throw new IntakeError('intake_recovery_intent_conflict',409);
    const sourceGuard=await db.prepare('SELECT operation_id FROM quo_intake_source_guards WHERE account_id = ? AND source_type = ? AND source_id = ?').bind(identity.account_id,source.type,source.id).first();
    const phoneGuard=await db.prepare('SELECT operation_id FROM quo_intake_phone_guards WHERE account_id = ? AND phone_sha256 = ?').bind(identity.account_id,await sourceHash(identity.phone)).first();
    if(sourceGuard?.operation_id!==row.operation_id||phoneGuard?.operation_id!==row.operation_id)throw new IntakeError('intake_recovery_guard_conflict',409);
    lease=crypto.randomUUID();
    const acquired=await run(db,`UPDATE quo_intake_operations SET lease_token = ?,lease_expires_at = ? WHERE operation_id = ?
      AND operation_state = 'held' AND reason = 'inquiry_or_identity_changed_before_request' AND classification = 'eligible_new_client'
      AND client_id = ? AND request_id IS NULL AND note_id IS NULL AND jobber_web_uri IS NULL AND uncertain = 0
      AND (lease_token IS NULL OR lease_expires_at <= ?)`,[lease,nowFor(deps)+LEASE_MS,row.operation_id,clientId,nowFor(deps)]);
    if(acquired!==1)return json(publicOperation(await getOperation(db,row.operation_id),nowFor(deps)));
    row=await getOperation(db,row.operation_id);
    await checkpoint(db,row,lease,'client_created',{reason:'operator_resume_requested'},nowFor(deps));
    const token=await deps.refreshJobberAccessToken(context.env,route);
    await processIntake(context.env,deps,token,route,identity,{expected_client_id:null},row,lease);
    return json(publicOperation(row,nowFor(deps)));
  }catch(error) {
    if(row&&lease)try {
      const current=await getOperation(context.env.ANGI_ROUTER_DB,row.operation_id);
      if(current?.lease_token===lease&&WRITE_STATES.has(current.operation_state)) {
        await hold(context.env.ANGI_ROUTER_DB,current,lease,'jobber_write_outcome_unknown',nowFor(deps),true);
        return json(publicOperation(current,nowFor(deps)));
      }
    }catch{}
    return errorResponse(error);
  }finally {
    if(row&&lease)try{await run(context.env.ANGI_ROUTER_DB,'UPDATE quo_intake_operations SET lease_token = NULL,lease_expires_at = NULL WHERE operation_id = ? AND lease_token = ?',[row.operation_id,lease]);}catch{}
  }
}
export const handleJobberQuoIntakeWrite=(context,deps=leadHelpers)=>handleWrite(context,deps,'intake');
export const handleJobberQuoIntakeNote=(context,deps=leadHelpers)=>handleWrite(context,deps,'note');
export const _private={QUERIES,MUTATIONS,MAX_BODY_BYTES,MAX_PAGES,LEASE_MS,MESSAGE_NOTE_WINDOW_MS,NUMBERS,CALL_ATTRIBUTION_MARKETS,cleanSource,routeInput,classify,publicOperation,noteMessage,newClientNames,upsertCallAttribution};
