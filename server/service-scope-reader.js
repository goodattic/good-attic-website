import {numericId} from './stage1-model.js';
import {serviceScopeFromText,combineServiceScopes} from './lead-service-scope.js';
export const REQUEST_SCOPE_FIELDS=`title notes(first:20){nodes{... on ClientNote{message} ... on RequestNote{message}}pageInfo{hasNextPage}}
 requestDetails{form{sections(first:20){nodes{items(first:20){nodes{... on FormTextInput{answer}}pageInfo{hasNextPage}}}pageInfo{hasNextPage}}}}`;
export function requestScopeFromObject(request={}) {
  const sections=request.requestDetails?.form?.sections;
  const incomplete=request.notes?.pageInfo?.hasNextPage||sections?.pageInfo?.hasNextPage||sections?.nodes?.some(s=>s.items?.pageInfo?.hasNextPage);
  const text=[request.title,...(request.notes?.nodes||[]).map(n=>n.message),
    ...(sections?.nodes||[]).flatMap(s=>(s.items?.nodes||[]).map(i=>i.answer))].filter(Boolean).join('\n');
  const scope=serviceScopeFromText(text,`jobber-request:${numericId(request.id)}`);
  if(incomplete&&!scope.in_scope_evidence)throw Error('scope_intake_incomplete');
  return scope;
}
export const WORK_SCOPE_QUERY = Object.freeze(Object.fromEntries(['quote','job'].map(type=>[type,
  `query WorkScope($id:EncodedId!,$after:String){account{id} ${type}(id:$id){id title createdAt client{id} lineItems(first:100,after:$after){nodes{id name description quantity}pageInfo{hasNextPage endCursor}}}}`])));
export const WORK_CATALOG_QUERY = `query WorkCatalog($id:EncodedId!,$quotesAfter:String,$jobsAfter:String){account{id} client(id:$id){id
 quotes(first:100,after:$quotesAfter){nodes{id createdAt}pageInfo{hasNextPage endCursor}}
 jobs(first:100,after:$jobsAfter){nodes{id createdAt}pageInfo{hasNextPage endCursor}}}}`;
export async function readWorkScope({gql,market,accountId,clientId,type,id}) {
  if(!WORK_SCOPE_QUERY[type])throw Error('scope_object_type_invalid');
  const scopes=[],seen=new Set();let after=null;
  do {
    const data=await gql(market,WORK_SCOPE_QUERY[type],{id,after});
    if(numericId(data.account?.id)!==numericId(accountId))throw Error('scope_account_mismatch');
    const obj=data[type];
    if(!obj)return null;
    if(numericId(obj.id)!==numericId(id)||numericId(obj.client?.id)!==numericId(clientId))throw Error('scope_client_mismatch');
    const conn=obj.lineItems;
    if(!conn?.pageInfo||!Array.isArray(conn.nodes))throw Error('scope_items_incomplete');
    scopes.push(serviceScopeFromText(obj.title,`jobber-${type}:${numericId(id)}`,{record:true}));
    for(const item of conn.nodes)if(Number(item.quantity)>0)scopes.push(serviceScopeFromText([item.name,item.description].filter(Boolean).join('\n'),
      `jobber-${type}:${numericId(id)}:item:${numericId(item.id)}`,{record:true}));
    after=conn.pageInfo.hasNextPage?conn.pageInfo.endCursor:null;
    if(conn.pageInfo.hasNextPage&&(!after||seen.has(after)))throw Error('scope_items_cursor_invalid');
    seen.add(after);
  }while(after);
  return combineServiceScopes(...scopes);
}
export async function readClientWorkScopes({gql,market,accountId,clientId,asOf=Date.now()}) {
  const rows=new Map(),cursors={quotesAfter:null,jobsAfter:null},seen=new Set();let more=true;
  while(more) {
    const data=await gql(market,WORK_CATALOG_QUERY,{id:clientId,...cursors});
    if(numericId(data.account?.id)!==numericId(accountId)||numericId(data.client?.id)!==numericId(clientId))throw Error('scope_account_or_client_mismatch');
    more=false;
    for(const type of ['quote','job']) {
      const conn=data.client[type+'s'];
      if(!conn?.pageInfo||!Array.isArray(conn.nodes))throw Error('scope_catalog_incomplete');
      for(const obj of conn.nodes)if(Date.parse(obj.createdAt)<=asOf)rows.set(`${type}:${obj.id}`,{type,id:obj.id,created_at:obj.createdAt});
      if(conn.pageInfo.hasNextPage) {const cursor=conn.pageInfo.endCursor,k=type+':'+cursor;
        if(!cursor||seen.has(k))throw Error('scope_catalog_cursor_invalid');seen.add(k);cursors[type+'sAfter']=cursor;more=true;}
    }
  }
  const scopes=[];
  for(const row of rows.values()) {
    const scope=await readWorkScope({gql,market,accountId,clientId,...row});
    if(!scope)throw Error('scope_record_disappeared');scopes.push({...scope,object_type:row.type,object_id:row.id,created_at:row.created_at});
  }
  return scopes;
}
