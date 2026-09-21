const CUSTOM_FIELD_NAMES = ["Original Lead ID", "Original Source", "Campaign"];
const CUSTOM_FIELDS_TIMEOUT_MS = 10 * 1000;

const CLIENT_CUSTOM_FIELDS_MUTATION = `
  mutation GoodAtticClientCustomFields($clientId: EncodedId!, $attributes: ClientUpdateAttributes!) {
    clientUpdate(input: { clientId: $clientId, attributes: $attributes }) {
      client {
        id
      }
      userErrors {
        message
        path
      }
    }
  }
`;

const MARKET_CONFIG_KEYS = {
  ut: "JOBBER_CUSTOM_FIELD_DEFINITIONS_UT",
  mo_stl: "JOBBER_CUSTOM_FIELD_DEFINITIONS_MO_STL",
  mo_kc: "JOBBER_CUSTOM_FIELD_DEFINITIONS_MO_KC",
  general: "JOBBER_CUSTOM_FIELD_DEFINITIONS_GENERAL",
};

function cleanScalar(value, max = 500) {
  if (!["string", "number", "bigint"].includes(typeof value)) return "";
  return String(value).trim().slice(0, max);
}

export function parseCustomFieldDefinitions(raw) {
  const definitions = new Map();
  for (const pair of cleanScalar(raw, 4000).split(";")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = cleanScalar(pair.slice(0, separator), 120);
    const definitionId = cleanScalar(pair.slice(separator + 1), 200);
    if (name && definitionId) definitions.set(name, definitionId);
  }
  return definitions;
}

export function campaignFromLead(lead) {
  try {
    const url = new URL(cleanScalar(lead?.source_url, 5000));
    return cleanScalar(url.searchParams.get("utm_campaign"), 200);
  } catch {
    return "";
  }
}

export function buildClientCustomFieldValues(lead, requestId) {
  const requestIdValue = cleanScalar(requestId, 200);
  const sourceValue = cleanScalar(lead?.source_label, 120);
  const campaignValue = campaignFromLead(lead);
  return [
    ["Original Lead ID", requestIdValue ? `jobber-request:${requestIdValue}` : ""],
    ["Original Source", sourceValue],
    ["Campaign", campaignValue],
  ];
}

export async function applyClientCustomFields(env, accessToken, clientId, lead, requestId) {
  if (env?.EXTERNAL_API_WRITES_ENABLED !== "true") {
    return { ok: false, skipped: true, reason: "external_api_writes_disabled" };
  }
  if (!cleanScalar(clientId, 200)) {
    return { ok: false, skipped: true, reason: "missing_client_id" };
  }

  const configKey = MARKET_CONFIG_KEYS[cleanScalar(lead?.market_key, 40)] || MARKET_CONFIG_KEYS.general;
  const definitions = parseCustomFieldDefinitions(env?.[configKey]);
  if (definitions.size === 0) {
    return { ok: false, skipped: true, reason: "definitions_not_configured", configKey };
  }

  const attributes = [];
  const unmatched = [];
  for (const [name, value] of buildClientCustomFieldValues(lead, requestId)) {
    if (!value) continue;
    const definitionId = definitions.get(name);
    if (!definitionId) {
      unmatched.push(name);
      continue;
    }
    attributes.push({ definitionId, valueText: value.slice(0, 200) });
  }

  if (attributes.length === 0) {
    return {
      ok: false,
      skipped: true,
      reason: "no_mappable_values",
      unmatched,
    };
  }

  try {
    const response = await fetch("https://api.getjobber.com/api/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${cleanScalar(accessToken, 4000)}`,
        "Content-Type": "application/json",
        "X-JOBBER-GRAPHQL-VERSION": cleanScalar(env?.JOBBER_GRAPHQL_VERSION, 40) || "2025-04-16",
      },
      body: JSON.stringify({
        query: CLIENT_CUSTOM_FIELDS_MUTATION,
        variables: { clientId, attributes },
      }),
      signal: AbortSignal.timeout(CUSTOM_FIELDS_TIMEOUT_MS),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    const userErrors = data?.data?.clientUpdate?.userErrors || [];
    if (!response.ok || data?.errors?.length || userErrors.length) {
      return {
        ok: false,
        skipped: false,
        reason: "jobber_rejected",
        status: response.status,
        userErrors,
      };
    }
    return {
      ok: true,
      applied: attributes.length,
      unmatched,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      reason: "network_error",
      message: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

export const _private = {
  CLIENT_CUSTOM_FIELDS_MUTATION,
  CUSTOM_FIELD_NAMES,
  MARKET_CONFIG_KEYS,
};
