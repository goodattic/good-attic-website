import {numericId} from './stage1-model.js';
import {aliasIdEqual,exactPhoneClients,possiblePlaceholderPair} from './phone-placeholder-alias.js';
export const ALIAS_CLIENT_QUERY='query AliasClients($after:String){account{id} clients(first:100,after:$after){nodes{id name lastName createdAt isArchived phones{number} emails{address}}pageInfo{hasNextPage endCursor}}}';
const address='street1 street2 city province postalCode country';
export const ALIAS_IDENTITY_QUERY=`query AliasIdentity($id:EncodedId!,$propertiesAfter:String,$invoicesAfter:String){account{id} client(id:$id){id
 billingAddress{${address}} clientProperties(first:100,after:$propertiesAfter){nodes{id address{${address}}}pageInfo{hasNextPage endCursor}}
 invoices(first:100,after:$invoicesAfter){nodes{id createdAt}pageInfo{hasNextPage endCursor}}}}`;
export const ALIAS_HISTORY_QUERY=`query AliasHistory($id:EncodedId!,$requestsAfter:String,$quotesAfter:String,$jobsAfter:String){account{id} client(id:$id){id name lastName createdAt isArchived phones{number} emails{address}
 requests(first:100,after:$requestsAfter){nodes{id createdAt requestStatus assessment{id startAt isComplete completedAt} quotes(first:1){nodes{id}}}pageInfo{hasNextPage endCursor}}
 quotes(first:100,after:$quotesAfter){nodes{id createdAt}pageInfo{hasNextPage endCursor}}
 jobs(first:100,after:$jobsAfter){nodes{id createdAt}pageInfo{hasNextPage endCursor}}}}`;
function checked(data,accountId,clientId) {
 if(!aliasIdEqual(data.account?.id,accountId)||clientId&&!aliasIdEqual(data.client?.id,clientId))throw Error('alias_account_or_client_mismatch');
}
function page(conn,key,cursors,seen) {
 if(!Array.isArray(conn?.nodes)||!conn.pageInfo)throw Error('alias_incomplete_history');
 if(!conn.pageInfo.hasNextPage)return false;
 const cursor=conn.pageInfo.endCursor,k=key+':'+cursor;
 if(!cursor||seen.has(k))throw Error('alias_repeated_cursor');seen.add(k);cursors[key]=cursor;return true;
}
async function addressFingerprint(a) {
 if(!a?.street1?.trim())return null;
 const normalized=['street1','street2','city','province','postalCode','country'].map(k=>String(a[k]||'').trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')).join('|');
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
 return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function readAliasIdentity({gql,marketKey,accountId,clientId}) {
 const fingerprints=new Set(),invoices=new Map(),cursors={propertiesAfter:null,invoicesAfter:null},seen=new Set();let more;
 do {
  const b=await gql(marketKey,ALIAS_IDENTITY_QUERY,{id:clientId,...cursors});checked(b,accountId,clientId);
  const c=b.client;
  more=page(c.clientProperties,'propertiesAfter',cursors,seen);more=page(c.invoices,'invoicesAfter',cursors,seen)||more;
  for(const a of [c.billingAddress,...c.clientProperties.nodes.map(p=>p.address)]) {const hash=await addressFingerprint(a);if(hash)fingerprints.add(hash);}
  for(const i of c.invoices.nodes){if(!i.id||!Number.isFinite(Date.parse(i.createdAt)))throw Error('alias_invoice_time_missing');invoices.set(i.id,i.createdAt);}
 }while(more);
 return {alias_identity_complete:true,alias_address_fingerprints:[...fingerprints],alias_invoice_dates:[...invoices.values()]};
}
export async function readAliasCandidates({gql,marketKey,accountId,callerPhone,originalClientId}) {
 const clients=[],cursors={after:null},seen=new Set();let more;
 do {const b=await gql(marketKey,ALIAS_CLIENT_QUERY,cursors);checked(b,accountId);more=page(b.clients,'after',cursors,seen);clients.push(...b.clients.nodes.map(c=>({...c,market_key:marketKey})));}while(more);
 const matches=exactPhoneClients(clients,marketKey,callerPhone),objects=[];
 if(!possiblePlaceholderPair(matches,callerPhone))return {clients:matches,objects};
 for(const c of matches) {
  const cursors={requestsAfter:null,quotesAfter:null,jobsAfter:null},seen=new Set(),found=new Map();let more;
  do {
   const b=await gql(marketKey,ALIAS_HISTORY_QUERY,{id:c.id,...cursors});checked(b,accountId,c.id);
   Object.assign(c,Object.fromEntries(Object.entries(b.client).filter(([k])=>!['requests','quotes','jobs'].includes(k))));more=false;
   for(const type of ['request','quote','job']) {
    const conn=b.client[type+'s'];more=page(conn,type+'sAfter',cursors,seen)||more;
    for(const obj of conn.nodes){if(!obj.id||!Number.isFinite(Date.parse(obj.createdAt)))throw Error('alias_object_time_missing');found.set(type+':'+numericId(obj.id),{market_key:marketKey,object_type:type,object_id:obj.id,client_id:c.id,current_present:true,object:obj});}
   }
  }while(more);
  c.history_complete=true;Object.assign(c,await readAliasIdentity({gql,marketKey,accountId,clientId:c.id}));objects.push(...found.values());
 }
 return {clients:matches,objects};
}
