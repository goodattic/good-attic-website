import { _private as leadHelpers } from '../functions/api/leads.js';
import { _private as contactHelpers } from './jobber-contact-resolver.js';

const QUERY = `query GoodAtticNewRequestAlert($id: EncodedId!) {
  account { id }
  request(id:$id) {
    id createdAt title jobberWebUri source contactName phone email
    client { id name phone email leadSource }
    property { address { street1 street2 city province postalCode } }
  }
}`;
const MARKETS = { ut:'utah', mo_stl:'stl', mo_kc:'kc' };
const clean = (value, limit=500) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit) : '';
const json = (value, status=200) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

export async function handleJobberAlertResolve({request,env}, dependencies=leadHelpers) {
  if(request.method!=='POST') return json({ok:false,code:'method_not_allowed'},405);
  if(!await contactHelpers.authorized(request,env.CONTACT_SYNC_BROKER_SECRET)) return json({ok:false,code:'unauthorized'},401);
  if(Number(request.headers.get('Content-Length'))>8192) return json({ok:false,code:'payload_too_large'},413);
  let raw,input;
  try { raw=await request.text(); if(new TextEncoder().encode(raw).length>8192)return json({ok:false,code:'payload_too_large'},413);input=JSON.parse(raw); }
  catch{return json({ok:false,code:'invalid_input'},400);}
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['account_id','request_id'].includes(k)))return json({ok:false,code:'invalid_input'},400);
  const route=contactHelpers.ROUTES.get(input.account_id);
  if(!route||!contactHelpers.validId(input.request_id,'Request'))return json({ok:false,code:'unknown_jobber_object'},400);
  if(!env.ANGI_ROUTER_DB?.prepare)return json({ok:false,code:'jobber_authoritative_database_unavailable'},503);
  try {
    const token=await dependencies.refreshJobberAccessToken(env,route);
    const result=await dependencies.jobberGraphql(env,token.accessToken,QUERY,{id:input.request_id});
    if(result?.errors?.length)return json({ok:false,code:'jobber_resolve_failed'},503);
    if(!contactHelpers.sameId(result?.data?.account?.id,route.expectedAccountId,'Account'))return json({ok:false,code:'jobber_account_mismatch'},409);
    const r=result.data.request;
    if(r===null)return json({ok:false,code:'jobber_object_not_found'},404);
    if(!r||!contactHelpers.sameId(r.id,input.request_id,'Request'))return json({ok:false,code:'jobber_object_mismatch'},409);
    if(!contactHelpers.validId(r.client?.id,'Client')||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt)))return json({ok:false,code:'jobber_response_invalid'},502);
    let uri;
    try{uri=new URL(r.jobberWebUri);}catch{return json({ok:false,code:'jobber_url_invalid'},502);}
    if(uri.protocol!=='https:'||uri.hostname!=='secure.getjobber.com'||uri.username||uri.password)return json({ok:false,code:'jobber_url_invalid'},502);
    const address=r.property?.address;
    return json({ok:true,account_id:route.expectedAccountId,market:MARKETS[route.marketKey],request:{
      id:btoa(atob(r.id)),createdAt:new Date(r.createdAt).toISOString(),title:clean(r.title),jobberWebUri:uri.href,
      source:[clean(r.source,100),clean(r.client.leadSource,100)].filter(Boolean).join(' / '),
      phone:clean(r.phone||r.client.phone,200),email:clean(r.email||r.client.email,320),contactName:clean(r.contactName||r.client.name,200),
      address:address?['street1','street2','city','province','postalCode'].map(k=>clean(address[k],150)).filter(Boolean).join(', '):'',
      clientId:btoa(atob(r.client.id)),
    }});
  }catch{return json({ok:false,code:'jobber_resolve_failed'},503);}
}
export const _private={QUERY};
