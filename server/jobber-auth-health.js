import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";
import { _private as leadHelpers } from "../functions/api/leads.js";

const JOBBER_API_URL = "https://api.getjobber.com/api/graphql";
const AUTHORIZATION_CHECK_QUERY = `
  query GoodAtticAuthorizationHealth {
    account { id name }
  }
`;

const SOURCE_ROUTES = [
  ["ut", "google"],
  ["mo_stl", "google"],
  ["mo_kc", "google"],
  ["ut", "angi"],
];

function clean(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function constantTimeEqualBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function bearerAuthorized(request, expectedSecret) {
  const expected = clean(expectedSecret, 1000);
  const provided = clean(request.headers.get("Authorization"), 1200).match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!expected || !provided) return false;
  const [expectedDigest, providedDigest] = await Promise.all([sha256(expected), sha256(provided)]);
  return constantTimeEqualBytes(expectedDigest, providedDigest);
}

function errorCode(error) {
  const providerStatus = Number(error?.details?.status || error?.details?.response?.status);
  if ([401, 403].includes(providerStatus)) return "provider_unauthorized";
  if (typeof error?.details?.code === "string" && error.details.code.startsWith("jobber_")) {
    return error.details.code;
  }
  return "health_check_failed";
}

async function checkRoute(env, route) {
  try {
    const token = await leadHelpers.refreshJobberAccessToken(env, route);
    const result = await leadHelpers.jobberGraphql(env, token.accessToken, AUTHORIZATION_CHECK_QUERY, {});
    const account = result?.data?.account || {};
    if (account.id !== route.expectedAccountId) {
      return {
        ok: false,
        account_key: route.authAccountKey,
        market_key: route.marketKey,
        source_key: route.sourceKey,
        code: "account_mismatch",
      };
    }
    return {
      ok: true,
      account_id: account.id,
      account_key: route.authAccountKey,
      market_key: route.marketKey,
      source_key: route.sourceKey,
      token_rotated: Boolean(token.tokenRotated),
    };
  } catch (error) {
    return {
      ok: false,
      account_key: route.authAccountKey,
      market_key: route.marketKey,
      source_key: route.sourceKey,
      code: errorCode(error),
    };
  }
}

export async function checkSourceJobberAuthorizations(env) {
  const results = [];
  for (const [marketKey, sourceKey] of SOURCE_ROUTES) {
    const route = getJobberOAuthRoute(marketKey, sourceKey);
    results.push(await checkRoute(env, route));
  }
  return {
    ok: results.every((result) => result.ok),
    checked_at: new Date().toISOString(),
    results,
  };
}

export async function handleJobberAuthorizationHealth({ request, env }) {
  if (!await bearerAuthorized(request, env.JOBBER_AUTH_HEALTH_SECRET)) {
    return jsonResponse({ ok: false, code: "unauthorized" }, 401);
  }
  const result = await checkSourceJobberAuthorizations(env);
  return jsonResponse(result, result.ok ? 200 : 503);
}

export const _private = {
  AUTHORIZATION_CHECK_QUERY,
  SOURCE_ROUTES,
  bearerAuthorized,
  checkRoute,
  errorCode,
};
