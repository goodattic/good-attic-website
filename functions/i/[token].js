export async function onRequestGet({request,env,params}) {
  const token=String(params.token||'');
  if(env.EXTERNAL_API_WRITES_ENABLED!=='true'||!env.CONTACT_SYNC_SERVICE||!/^[-a-zA-Z0-9_]{20,100}$/.test(token))return new Response('This call link is unavailable.',{status:404,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
  try{return await env.CONTACT_SYNC_SERVICE.fetch(new Request(`https://contact-sync/call/${token}`,{method:'GET'}));}
  catch{return new Response('This call link is temporarily unavailable. Please open Quo directly.',{status:503,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});}
}
