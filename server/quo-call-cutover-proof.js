const response = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

/** Read-only, fresh proof for the separate phone-attribution worker. */
export async function handleQuoCallCutoverProof({ request, env }, { now = () => Date.now() } = {}) {
  if (request.method !== 'POST') return response({ ok: false, code: 'method_not_allowed' }, 405);
  const secret = env.PHONE_STAGE_CUTOVER_SECRET;
  if (typeof secret !== 'string' || !secret) return response({ ok: false, code: 'cutover_proof_unconfigured' }, 503);
  if (request.headers.get('Authorization') !== `Bearer ${secret}`) return response({ ok: false }, 401);
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 128) return response({ ok: false, code: 'invalid_input' }, 400);
    input = JSON.parse(raw);
  } catch { return response({ ok: false, code: 'invalid_input' }, 400); }
  const nonce = input?.nonce;
  if (!input || Object.keys(input).length !== 1 || typeof nonce !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce)) {
    return response({ ok: false, code: 'invalid_input' }, 400);
  }
  if (!env.ANGI_ROUTER_DB?.prepare) return response({ ok: false, code: 'database_unavailable' }, 503);
  let pending;
  try {
    pending = await env.ANGI_ROUTER_DB.prepare(`SELECT COUNT(*) AS count FROM quo_intake_operations
      WHERE operation_state NOT IN ('completed','suppressed','held')`).first();
  } catch { return response({ ok: false, code: 'database_unavailable' }, 503); }
  if (!Number.isSafeInteger(pending?.count) || pending.count < 0) {
    return response({ ok: false, code: 'database_unavailable' }, 503);
  }
  return response({
    ok: true, service: 'good-attic-website-quo-intake', nonce,
    call_auto_request_enabled: env.QUO_CALL_AUTO_REQUEST_ENABLED !== 'false',
    in_flight_broker_writes: pending.count,
    verified_at: new Date(now()).toISOString(),
  });
}
