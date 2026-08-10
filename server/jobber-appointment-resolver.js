import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";
import { _private as leadHelpers } from "../functions/api/leads.js";

const MAX_RESOLVER_BODY_BYTES = 32 * 1024;
const APPOINTMENT_EVENT_NAME = "jobber.appointment_scheduled.v1";

const ASSESSMENT_QUERY = `
  query GoodAtticAppointmentScheduled($id: EncodedId!) {
    assessment(id: $id) {
      id
      startAt
      endAt
      title
      client {
        id
        name
        email
        phone
        defaultEmails
        defaultPhones
      }
      request {
        id
        jobberWebUri
        contactName
        email
        phone
      }
      property {
        id
        jobberWebUri
      }
    }
  }
`;

const ROUTES_BY_ACCOUNT_ID = new Map(
  ["ut", "mo_stl", "mo_kc"].map((marketKey) => {
    const route = getJobberOAuthRoute(marketKey, "website");
    return [route.expectedAccountId, route];
  }),
);

function clean(value, max = 500) {
  if (!["string", "number", "bigint"].includes(typeof value)) return "";
  return String(value).trim().slice(0, max);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
}

function constantTimeEqualBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function bearerAuthorized(request, expectedSecret) {
  const secret = clean(expectedSecret, 1000);
  if (!secret) return false;
  const authorization = clean(request.headers.get("Authorization"), 1200);
  const provided = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const [expectedDigest, providedDigest] = await Promise.all([
    sha256(secret),
    sha256(provided),
  ]);
  return Boolean(provided) && constantTimeEqualBytes(expectedDigest, providedDigest);
}

function validOccurredAt(value) {
  const occurredAt = clean(value, 80);
  return occurredAt && Number.isFinite(Date.parse(occurredAt))
    ? occurredAt
    : new Date().toISOString();
}

function firstValue(...values) {
  for (const value of values.flat()) {
    const candidate = clean(value, 500);
    if (candidate) return candidate;
  }
  return "";
}

export function buildAppointmentSignal({ route, accountId, assessment, occurredAt }) {
  const eventId = `jobber-assessment:${accountId}:${assessment.id}`;
  return {
    event_name: APPOINTMENT_EVENT_NAME,
    event_id: eventId,
    event_occurred_at: validOccurredAt(occurredAt),
    route_to_sales_pipeline: true,
    market_key: route.marketKey,
    market_name: route.accountLabel,
    appointment_type: "assessment",
    appointment_start_at: clean(assessment.startAt, 80),
    appointment_end_at: clean(assessment.endAt, 80),
    appointment_title: clean(assessment.title, 500),
    jobber_account_id: accountId,
    jobber_assessment_id: clean(assessment.id, 500),
    jobber_request_id: clean(assessment.request?.id, 500),
    jobber_client_id: clean(assessment.client?.id, 500),
    jobber_property_id: clean(assessment.property?.id, 500),
    jobber_request_url: clean(assessment.request?.jobberWebUri, 1000),
    contact_name: firstValue(
      assessment.request?.contactName,
      assessment.client?.name,
    ),
    email: firstValue(
      assessment.request?.email,
      assessment.client?.email,
      assessment.client?.defaultEmails || [],
    ),
    phone: firstValue(
      assessment.request?.phone,
      assessment.client?.phone,
      assessment.client?.defaultPhones || [],
    ),
  };
}

export async function handleJobberAppointmentResolve({ request, env }) {
  if (!await bearerAuthorized(request, env.JOBBER_APPOINTMENT_BROKER_SECRET)) {
    return jsonResponse({ ok: false, code: "unauthorized" }, 401);
  }

  if (!env.ANGI_ROUTER_DB || typeof env.ANGI_ROUTER_DB.prepare !== "function") {
    return jsonResponse({
      ok: false,
      code: "jobber_authoritative_database_unavailable",
    }, 503);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_RESOLVER_BODY_BYTES) {
    return jsonResponse({ ok: false, code: "payload_too_large" }, 413);
  }

  let input;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ ok: false, code: "invalid_json" }, 400);
  }

  const accountId = clean(input?.account_id, 500);
  const assessmentId = clean(input?.assessment_id, 500);
  const route = ROUTES_BY_ACCOUNT_ID.get(accountId);
  if (!route || !assessmentId) {
    return jsonResponse({ ok: false, code: "unknown_jobber_object" }, 400);
  }
  if (clean(input?.market_key, 40) && clean(input.market_key, 40) !== route.marketKey) {
    return jsonResponse({ ok: false, code: "market_account_mismatch" }, 409);
  }

  try {
    const token = await leadHelpers.refreshJobberAccessToken(env, route);
    const result = await leadHelpers.jobberGraphql(
      env,
      token.accessToken,
      ASSESSMENT_QUERY,
      { id: assessmentId },
    );
    const assessment = result?.data?.assessment;
    if (!assessment?.id) {
      return jsonResponse({ ok: false, code: "assessment_not_found" }, 404);
    }
    if (!assessment.startAt || !assessment.endAt) {
      return jsonResponse({
        ok: true,
        status: "not_scheduled",
        jobber_assessment_id: assessment.id,
      });
    }

    const signal = buildAppointmentSignal({
      route,
      accountId,
      assessment,
      occurredAt: input?.occurred_at,
    });
    return jsonResponse({ ok: true, status: "scheduled", signal });
  } catch (error) {
    const status = Number(error?.status || 0);
    return jsonResponse({
      ok: false,
      code: clean(error?.details?.code, 120) || "jobber_resolve_failed",
    }, status >= 400 && status <= 599 ? status : 503);
  }
}

export const _private = {
  APPOINTMENT_EVENT_NAME,
  ASSESSMENT_QUERY,
  MAX_RESOLVER_BODY_BYTES,
  ROUTES_BY_ACCOUNT_ID,
  bearerAuthorized,
  constantTimeEqualBytes,
  firstValue,
  validOccurredAt,
};
