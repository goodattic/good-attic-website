import browserProof from './browser-proof-source.js';
import { onRequestPost as lead, _private as leadTools } from '../functions/api/leads.js';
import { onRequestPost as conversion } from '../functions/api/leads/conversion-signal.js';
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    const url = new URL(request.url);
    if (path === '/preview-unlock') {
      if (env.PREVIEW_SUBMISSIONS_ENABLED !== 'true') return new Response('Locked', {status:403});
      if (request.method === 'GET') return new Response('<form method="post"><label>Preview test access key<input name="key" type="password"></label><button>Unlock approved test session</button></form>',{headers:{'content-type':'text/html','cache-control':'no-store'}});
      const key = (await request.formData()).get('key');
      if (!env.PREVIEW_TEST_KEY || key !== env.PREVIEW_TEST_KEY) return new Response('Locked',{status:403});
      return new Response('<p>Approved test session unlocked.</p><a href="/salt-lake-city-ut/lp/attic-insulation/">Open Utah test page</a>',{headers:{'content-type':'text/html', 'set-cookie':`lp_test=${env.PREVIEW_TEST_KEY}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`}});
    }
    if (path === '/preview-browser-proof.js') return new Response(browserProof,{headers:{'content-type':'application/javascript','cache-control':'no-store'}});
    if (!path.startsWith('/api/')) {
      const response = await env.ASSETS.fetch(request);
      const testSession = env.PREVIEW_SUBMISSIONS_ENABLED === 'true' && env.PREVIEW_TEST_KEY && request.headers.get('cookie')?.split(';').some(v => v.trim() === `lp_test=${env.PREVIEW_TEST_KEY}`);
      if (testSession && path.includes('/lp/') && response.headers.get('content-type')?.includes('text/html')) {
        const headers = new Headers(response.headers); headers.delete('content-length'); headers.set('cache-control','no-store');
        return new Response((await response.text()).replace('</head>','<script src="/preview-browser-proof.js" defer></script></head>').replace('<script src="../../../script.e0b6cf2323b054a8.js"', '<script src="/preview-browser-proof.js" defer></script><script src="../../../script.e0b6cf2323b054a8.js"').replace('<script src="/preview-browser-proof.js" defer></script></head>','</head>'), {status:response.status,headers});
      }
      return response;
    }
    if (env.PREVIEW_SUBMISSIONS_ENABLED !== 'true') return new Response('Preview submissions are locked pending approval.', { status: 403 });
    const authorized = env.PREVIEW_TEST_KEY && request.headers.get('cookie')?.split(';').some(v => v.trim() === `lp_test=${env.PREVIEW_TEST_KEY}`);
    if (!authorized || request.method !== 'POST') return new Response('Forbidden', {status:403});
    if (path !== '/api/leads' && path !== '/api/leads/conversion-signal') return new Response('Not found', {status:404});
    // Only isolated preview D1 is bound; there is no production DB, KV or refresh token.
    const safeEnv = { ANGI_ROUTER_DB: env.PREVIEW_DB, EXTERNAL_API_WRITES_ENABLED: 'false', ACKNOWLEDGEMENT_SOURCE_ENABLED: 'false', JOBBER_GOOGLE_ROUTING_MARKETS: 'ut,mo_stl,mo_kc' };
    if (path.endsWith('/conversion-signal')) return conversion({request,env:safeEnv});
    const payload = await request.clone().json();
    if (payload.name !== 'TEST - DO NOT DELETE - Codex 2' || String(payload.phone || '').replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'') !== '6363629307' || payload.form_variant !== 'short_ad_landing' || payload.gclid || payload.gbraid || payload.wbraid) return new Response('Test-marked short forms only', {status:403});
    // Access tokens are short-lived and separately provisioned after approval.
    // Expired/missing tokens block before any lead mutation; refresh tokens are never cloned.
    const market = leadTools.shortAdMarketFor(payload);
    if (!market) return new Response('Unapproved landing-page path', {status:403});
    const route = leadTools.resolveLeadJobberRoute(safeEnv, leadTools.buildLead(payload, crypto.randomUUID(), leadTools.classifyWebsiteLeadSource(payload), market));
    const key = route.authAccountKey;
    const token = key && await env.PREVIEW_DB.prepare('SELECT access_token, access_expires_at FROM angi_router_jobber_auth WHERE account_key = ?').bind(key).first();
    if (!token?.access_token || token.access_expires_at < Date.now()+120000) return new Response('Preview account authorization needs provisioning', {status:503});
    const record = crypto.randomUUID();
    await env.PREVIEW_DB.prepare('INSERT INTO preview_test_leads (id, payload_json) VALUES (?, ?)').bind(record,JSON.stringify(payload)).run();
    const response = await lead({request,env:safeEnv,waitUntil:ctx.waitUntil.bind(ctx)});
    await env.PREVIEW_DB.prepare('UPDATE preview_test_leads SET response_json = ?, http_status = ? WHERE id = ?').bind(await response.clone().text(),response.status,record).run();
    return response;
  }
};
