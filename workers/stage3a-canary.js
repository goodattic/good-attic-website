import base from './stage1-shadow.js';
import {canaryStatus} from '../server/stage3a-canary.js';
export default {
 scheduled:base.scheduled,
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path!=='/stage3a-canary'&&path!=='/stage3a-canary-status')return base.fetch(request,env);
  if(!env.STAGE1_ADMIN_SECRET||request.headers.get('Authorization')!==`Bearer ${env.STAGE1_ADMIN_SECRET}`)return Response.json({error:'unauthorized'},{status:401});
  try{
   if(path==='/stage3a-canary')return Response.json({error:'canary_upload_route_permanently_closed'},{status:410});
   if(path==='/stage3a-canary-status'&&request.method==='GET')return Response.json(await canaryStatus(env),{headers:{'Cache-Control':'no-store'}});
   return Response.json({error:'method_not_allowed'},{status:405});
  }catch(e){return Response.json({error:e.message},{status:500});}
 }
};
