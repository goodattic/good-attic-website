import { resolveQuoClientFirstName } from './quo-client-name.js';
import { getJobberOAuthRoute } from "../functions/api/jobber/oauth/config.js";
import { _private as leadHelpers } from "../functions/api/leads.js";

const MAX_BODY_BYTES = 8 * 1024;
const TOPIC_TYPES = new Map([
  ["CLIENT_CREATE", "Client"],
  ["CLIENT_UPDATE", "Client"],
  ["REQUEST_CREATE", "Request"],
  ["REQUEST_UPDATE", "Request"],
]);
const ROUTES = new Map(["ut", "mo_stl", "mo_kc"].flatMap((market) => {
  const route = getJobberOAuthRoute(market, "website");
  return [[route.expectedAccountId, route], [route.expectedAccountId.replace(/=+$/, ""), route]];
}));

// A narrow contact-only broker: the caller cannot supply GraphQL or receive
// tokens. Token rotation remains inside the website's existing D1 authority.
const CLIENT_FIELDS = `
  id firstName lastName companyName isCompany updatedAt
  phones { id number normalizedPhoneNumber primary description smsAllowed }
  emails { id address primary description }
`;
const QUERIES = {
  Client: `query GoodAtticContactSyncClient($id: EncodedId!) {
    account { id }
    client(id: $id) { ${CLIENT_FIELDS} }
  }`,
  Request: `query GoodAtticContactSyncRequestClient($id: EncodedId!) {
    account { id }
    request(id: $id) { id client { ${CLIENT_FIELDS} } }
  }`,
};

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function validId(value, model) {
  if (typeof value !== "string" || value.length > 500) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const decoded = atob(value);
    const canonical = btoa(decoded);
    return (canonical === value || canonical.replace(/=+$/, "") === value)
      && new RegExp(`^gid://Jobber/${model}/[1-9][0-9]*$`).test(decoded);
  } catch {
    return false;
  }
}

function sameId(left, right, model) {
  return validId(left, model) && validId(right, model)
    && left.replace(/=+$/, "") === right.replace(/=+$/, "");
}

async function authorized(request, secret) {
  if (typeof secret !== "string" || !secret || secret.length > 1000) return false;
  const header = request.headers.get("Authorization") || "";
  if (header.length > 1200) return false;
  const provided = header.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!provided) return false;
  const digest = async (value) => new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(value),
  ));
  const [left, right] = await Promise.all([digest(secret), digest(provided)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function text(value, max, nullable = false) {
  return (nullable && value === null)
    || (typeof value === "string" && value.length <= max);
}

function contactFromResponse(client) {
  if (!client || !validId(client.id, "Client")
    || !text(client.firstName, 1000) || !text(client.lastName, 1000)
    || !text(client.companyName, 1000, true) || typeof client.isCompany !== "boolean"
    || !text(client.updatedAt, 80) || !Number.isFinite(Date.parse(client.updatedAt))
    || !Array.isArray(client.phones) || !Array.isArray(client.emails)
    || client.phones.length > 1000 || client.emails.length > 1000) return null;

  const phones = [];
  for (const phone of client.phones) {
    if (!phone || !text(phone.id, 500) || !phone.id || !text(phone.number, 200)
      || !text(phone.normalizedPhoneNumber, 200, true)
      || !text(phone.description, 200) || typeof phone.primary !== "boolean"
      || typeof phone.smsAllowed !== "boolean") return null;
    phones.push({
      id: phone.id, number: phone.number,
      normalizedPhoneNumber: phone.normalizedPhoneNumber,
      primary: phone.primary, description: phone.description, smsAllowed: phone.smsAllowed,
    });
  }
  const emails = [];
  for (const email of client.emails) {
    if (!email || !text(email.id, 500) || !email.id || !text(email.address, 1000)
      || !text(email.description, 200) || typeof email.primary !== "boolean") return null;
    emails.push({
      id: email.id, address: email.address,
      primary: email.primary, description: email.description,
    });
  }
  return {
    id: btoa(atob(client.id)), firstName: client.firstName, lastName: client.lastName,
    companyName: client.companyName, isCompany: client.isCompany,
    updatedAt: client.updatedAt, phones, emails,
  };
}

export async function handleJobberContactResolve({ request, env }, dependencies = leadHelpers) {
  if (request.method !== "POST") return json({ ok: false, code: "method_not_allowed" }, 405);
  if (!await authorized(request, env.CONTACT_SYNC_BROKER_SECRET)) {
    return json({ ok: false, code: "unauthorized" }, 401);
  }
  const length = request.headers.get("Content-Length");
  if (length && Number(length) > MAX_BODY_BYTES) return json({ ok: false, code: "payload_too_large" }, 413);

  let raw;
  try {
    raw = await request.text();
  } catch {
    return json({ ok: false, code: "invalid_body" }, 400);
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json({ ok: false, code: "payload_too_large" }, 413);
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return json({ ok: false, code: "invalid_json" }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["account_id", "topic", "item_id"].includes(key))) {
    return json({ ok: false, code: "invalid_input" }, 400);
  }
  const route = ROUTES.get(input.account_id);
  const type = TOPIC_TYPES.get(input.topic);
  if (!route || !type || !validId(input.item_id, type)) {
    return json({ ok: false, code: "unknown_jobber_object" }, 400);
  }
  if (!env.ANGI_ROUTER_DB || typeof env.ANGI_ROUTER_DB.prepare !== "function") {
    return json({ ok: false, code: "jobber_authoritative_database_unavailable" }, 503);
  }

  try {
    const result = dependencies.jobberGraphqlWithAuthorizationRecovery
      ? await dependencies.jobberGraphqlWithAuthorizationRecovery(env, route, QUERIES[type], { id: input.item_id })
      : await (async () => { const token = await dependencies.refreshJobberAccessToken(env, route); return dependencies.jobberGraphql(env, token.accessToken, QUERIES[type], { id: input.item_id }); })();
    if (result?.errors?.length) return json({ ok: false, code: "jobber_resolve_failed" }, 503);
    if (!result?.data?.account?.id) return json({ ok: false, code: "jobber_response_invalid" }, 502);
    if (!sameId(result.data.account.id, route.expectedAccountId, "Account")) {
      return json({ ok: false, code: "jobber_account_mismatch" }, 409);
    }
    const object = result.data[type === "Client" ? "client" : "request"];
    if (object === null) return json({ ok: false, code: "jobber_object_not_found" }, 404);
    if (!object || !sameId(object.id, input.item_id, type)) {
      return json({ ok: false, code: "jobber_object_mismatch" }, 409);
    }
    const client = contactFromResponse(type === "Client" ? object : object.client);
    if (!client) return json({ ok: false, code: "jobber_response_invalid" }, 502);
    client.firstName = await resolveQuoClientFirstName(env, route.expectedAccountId, client);
    return json({ ok: true, account_id: route.expectedAccountId, market_key: route.marketKey, client });
  } catch {
    // Provider, D1, and OAuth errors may contain credentials or customer data.
    // Their details stay inside the token owner; callers get a stable code only.
    return json({ ok: false, code: "jobber_resolve_failed" }, 503);
  }
}

export const _private = { MAX_BODY_BYTES, QUERIES, ROUTES, TOPIC_TYPES, validId, sameId, authorized };
