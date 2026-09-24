import base from './stage3a-canary.js';
import {tick} from './stage1-shadow.js';
import {health} from '../server/stage2-health.js';
import {uploadCycle,uploadHealth} from '../server/data-manager-live.js';
export default {
 async scheduled(_event,env){
  try{await tick(env,'scheduled');}finally{console.log(JSON.stringify(await uploadCycle(env)));}
 },
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(path==='/health'&&request.method==='GET')return Response.json({...await health(env),...await uploadHealth(env)},{headers:{'Cache-Control':'no-store'}});
  if(path==='/uploads/tick'){
   if(!env.STAGE1_ADMIN_SECRET||request.headers.get('Authorization')!==`Bearer ${env.STAGE1_ADMIN_SECRET}`)return Response.json({error:'unauthorized'},{status:401});
   if(request.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405});
   try{return Response.json(await uploadCycle(env));}catch{return Response.json({error:'upload_cycle_failed'},{status:500});}
  }
  return base.fetch(request,env);
 }
};
