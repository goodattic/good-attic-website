import { _private as leadHelpers } from '../functions/api/leads.js';
import { _private as contactHelpers } from './jobber-contact-resolver.js';
import { getJobberOAuthRoute } from '../functions/api/jobber/oauth/config.js';

const QUERY = 'query GoodAtticJobberAuthHealth { account { id } }';
const MARKET_INPUT = { utah: 'ut', stl: 'mo_stl', kc: 'mo_kc' };
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function handleJobberAuthHealth({ request, env }, dependencies = leadHelpers) {
  if (request.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405);
  if (!await contactHelpers.authorized(request, env.CONTACT_SYNC_BROKER_SECRET)) return json({ ok: false, code: 'unauthorized' }, 401);
  let input;
  try { input = await request.json(); } catch { return json({ ok: false, code: 'invalid_input' }, 400); }
  if (!input || typeof input.market !== 'string' || !Object.hasOwn(MARKET_INPUT, input.market) || Object.keys(input).some(k => k !== 'market')) {
    return json({ ok: false, code: 'invalid_input' }, 400);
  }
  const route = getJobberOAuthRoute(MARKET_INPUT[input.market], 'website');
  try {
    const token = await dependencies.refreshJobberAccessToken(env, route);
    const result = await dependencies.jobberGraphql(env, token.accessToken, QUERY, {});
    const accountId = result?.data?.account?.id;
    if (result?.errors?.length || !contactHelpers.sameId(accountId, route.expectedAccountId, 'Account')) {
      return json({ ok: true, healthy: false, market: input.market, code: 'jobber_account_check_failed' });
    }
    return json({ ok: true, healthy: true, market: input.market, account_id: route.expectedAccountId });
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : typeof error?.details?.code === 'string' ? error.details.code : 'jobber_health_check_failed';
    return json({ ok: true, healthy: false, market: input.market, code });
  }
}

export const _private = { QUERY };
