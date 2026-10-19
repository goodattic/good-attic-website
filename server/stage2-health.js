export function firstScheduledObservation(old, object, historical, cutoff, observedAt) {
  if (historical) return null;
  if (old?.first_scheduled_at) return old.first_scheduled_at;
  const assessment=object.assessment;
  if (!cutoff || !assessment?.startAt || !assessment?.endAt) return null;
  // Newly discovered assessments that ended before activation are historical too.
  if (![assessment.startAt,assessment.endAt,cutoff,observedAt].every(t=>Number.isFinite(Date.parse(t)))) return null;
  if (Date.parse(assessment.endAt)<Date.parse(cutoff)) return null;
  return observedAt;
}
export async function health(env) {
  const db=env.ANGI_ROUTER_DB;
  const since=new Date(Date.now()-86400000).toISOString();
  const latest=await db.prepare("SELECT completed_at FROM closed_loop_stage2_runs WHERE status='success' ORDER BY completed_at DESC LIMIT 1").first();
  const scheduled=await db.prepare("SELECT completed_at FROM closed_loop_stage2_runs WHERE status='success' AND trigger='scheduled' ORDER BY completed_at DESC LIMIT 1").first();
  const totals=await db.prepare("SELECT count(*) runs,COALESCE(sum(events_processed),0) events,COALESCE(sum(webhooks_processed),0) webhooks FROM closed_loop_stage2_runs WHERE status='success' AND completed_at>=?").bind(since).first();
  const unique=await db.prepare('SELECT count(*) count FROM closed_loop_stage1_events WHERE updated_at>=?').bind(since).first();
  const added=await db.prepare("SELECT count(*) count FROM google_ads_outcome_outbox WHERE upload_state='shadow' AND created_at>=?").bind(since).first();
  const cutoff=await db.prepare("SELECT value FROM closed_loop_stage1_control WHERE name='stage2_appointment_start_at'").first();
  return {mode:env.GOOGLE_ADS_UPLOAD_ENABLED==='true'?'live':'shadow',google_upload_enabled:env.GOOGLE_ADS_UPLOAD_ENABLED==='true',real_upload_transport:env.GOOGLE_ADS_UPLOAD_ENABLED==='true'?env.GOOGLE_ADS_TRANSPORT:null,validation_transport:'data_manager_api',markets:['ut','mo_stl','mo_kc'],last_successful_run_at:latest?.completed_at||null,last_successful_scheduled_run_at:scheduled?.completed_at||null,metrics_since:cutoff?.value||null,last_24h:{successful_runs:totals?.runs||0,events_processed:totals?.events||0,unique_events_touched:unique?.count||0,new_shadow_events:added?.count||0,webhooks_processed:totals?.webhooks||0},events_processed_definition:'Distinct outcome evaluations per successful run, summed across runs; repeated reconciliation is included.',customer_data_exposed:false};
}
