const CUSTOM_FIELD_NAMES = ["Original Lead ID", "Original Source", "Campaign"];
const QUOTE_CUSTOM_FIELD_APPLICABILITY = "ALL_QUOTES";
const CUSTOM_FIELDS_TIMEOUT_MS = 10 * 1000;
const JOBBER_API_URL = "https://api.getjobber.com/api/graphql";

const CUSTOM_FIELD_CONFIGURATIONS_QUERY = `
  query GoodAtticCustomFieldConfigurations {
    customFieldConfigurations(first: 50) {
      pageInfo { hasNextPage }
      nodes {
        ... on CustomFieldConfigurationArea { __typename id name valueType appliesTo readOnly }
        ... on CustomFieldConfigurationDropdown { __typename id name valueType appliesTo readOnly }
        ... on CustomFieldConfigurationLink { __typename id name valueType appliesTo readOnly }
        ... on CustomFieldConfigurationNumeric { __typename id name valueType appliesTo readOnly }
        ... on CustomFieldConfigurationText { __typename id name valueType appliesTo readOnly }
        ... on CustomFieldConfigurationTrueFalse { __typename id name valueType appliesTo readOnly }
      }
    }
  }
`;

const QUOTE_CONTEXT_QUERY = `
  query GoodAtticQuoteContext($id: EncodedId!) {
    quote(id: $id) {
      id
      request { id client { id } }
      customFields {
        ... on CustomFieldText {
          id
          valueText
          customFieldConfiguration { id name }
        }
        ... on CustomFieldNumeric {
          id
          valueNumeric
          customFieldConfiguration { id name }
        }
        ... on CustomFieldDropdown {
          id
          customFieldConfiguration { id name }
        }
        ... on CustomFieldTrueFalse {
          id
          valueTrueFalse
          customFieldConfiguration { id name }
        }
        ... on CustomFieldArea {
          id
          valueArea { length width }
          customFieldConfiguration { id name }
        }
        ... on CustomFieldLink {
          id
          customFieldConfiguration { id name }
        }
      }
    }
  }
`;

const QUOTE_CUSTOM_FIELDS_MUTATION = `
  mutation GoodAtticQuoteCustomFields($quoteId: EncodedId!, $attributes: QuoteEditAttributes!) {
    quoteEdit(quoteId: $quoteId, attributes: $attributes) {
      quote { id }
      userErrors { message path }
    }
  }
`;

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

export function filterQuoteCustomFieldConfigurations(configurations = []) {
  return (Array.isArray(configurations) ? configurations : []).filter((configuration) => (
    configuration?.id
    && configuration?.name
    && configuration.appliesTo === QUOTE_CUSTOM_FIELD_APPLICABILITY
    && (configuration.__typename === "CustomFieldConfigurationText" || configuration.valueType === "TEXT")
    && configuration.readOnly === false
  ));
}

export function campaignFromLead(lead) {
  const direct = cleanScalar(lead?.campaign, 200);
  if (direct) return direct;
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

function classifyJobberFailure(response, data) {
  const message = JSON.stringify(data?.errors || data || {}).toLowerCase();
  if ([401, 403].includes(Number(response?.status)) || /permission|scope|unauthori[sz]|forbidden/.test(message)) {
    return "permission_denied";
  }
  return response?.ok ? "jobber_rejected" : "network_error";
}

async function jobberGraphql(env, accessToken, query, variables = {}) {
  const response = await fetch(JOBBER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${cleanScalar(accessToken, 4000)}`,
      "Content-Type": "application/json",
      "X-JOBBER-GRAPHQL-VERSION": cleanScalar(env?.JOBBER_GRAPHQL_VERSION, 40) || "2025-04-16",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(CUSTOM_FIELDS_TIMEOUT_MS),
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { response, data };
}

export async function resolveCustomFieldDefinitions(env, accessToken, options = {}) {
  if (!cleanScalar(accessToken, 4000)) return { ok: false, reason: "missing_access_token" };
  try {
    const { response, data } = await jobberGraphql(env, accessToken, CUSTOM_FIELD_CONFIGURATIONS_QUERY);
    if (!response.ok || data?.errors?.length) {
      return {
        ok: false,
        reason: classifyJobberFailure(response, data),
        status: response.status,
        errors: data?.errors || [],
      };
    }
    const configurations = Array.isArray(data?.data?.customFieldConfigurations?.nodes)
      ? data.data.customFieldConfigurations.nodes.filter((node) => node?.id && node?.name)
      : [];
    if (options.requireUniqueDefinitions) {
      if (data?.data?.customFieldConfigurations?.pageInfo?.hasNextPage !== false) {
        return { ok: false, reason: "definitions_incomplete" };
      }
      const names = configurations.filter((node) =>
        node.appliesTo === QUOTE_CUSTOM_FIELD_APPLICABILITY
          && CUSTOM_FIELD_NAMES.includes(node.name)).map((node) => node.name);
      if (new Set(names).size !== names.length) {
        return { ok: false, reason: "definitions_ambiguous" };
      }
    }
    const definitions = new Map(
      filterQuoteCustomFieldConfigurations(configurations)
        .filter((node) => CUSTOM_FIELD_NAMES.includes(node.name))
        .map((node) => [node.name, node.id]),
    );
    const missing = CUSTOM_FIELD_NAMES.filter((name) => !definitions.has(name));
    return {
      ok: missing.length === 0,
      reason: missing.length ? "definitions_missing" : undefined,
      definitions,
      configurations,
      missing,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "network_error",
      message: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

function nonBlank(value) {
  return cleanScalar(value, 500);
}

export function normalizeExistingCustomFields(customFields = []) {
  const values = new Map();
  for (const field of Array.isArray(customFields) ? customFields : []) {
    const configuration = field?.customFieldConfiguration || field?.configuration || {};
    const id = nonBlank(configuration.id || field?.customFieldConfigurationId || field?.configurationId);
    const name = nonBlank(configuration.name || field?.name || field?.label);
    const value = nonBlank(
      field?.valueText
      ?? field?.value
      ?? field?.valueString
      ?? field?.valueNumeric
      ?? (field?.valueTrueFalse === true ? "true" : field?.valueTrueFalse === false ? "false" : "")
      ?? (field?.valueArea ? `${field.valueArea.length}x${field.valueArea.width}` : ""),
    );
    if (id) values.set(`id:${id}`, value);
    if (name) values.set(`name:${name}`, value);
  }
  return values;
}

export function buildQuoteCustomFieldAttributes(definitions, lead, requestId, existingFields = [], options = {}) {
  const existing = normalizeExistingCustomFields(existingFields);
  const attributes = [];
  const skippedExisting = [];
  const missingValues = [];
  const conflictingExisting = [];
  for (const [name, value] of buildClientCustomFieldValues(lead, requestId)) {
    const definitionId = definitions?.get?.(name) || "";
    const valueText = nonBlank(value).slice(0, 200);
    const current = existing.get(`id:${definitionId}`) || existing.get(`name:${name}`) || "";
    if ((options.strictExistingValues && current && current !== valueText)
      || (options.requireBlankPaidFields && lead?.source_label === "Google Ads call"
        && ["Original Source", "Campaign"].includes(name) && current)) {
      conflictingExisting.push(name);
    }
    if (!valueText) {
      missingValues.push(name);
      continue;
    }
    if (!definitionId) continue;
    if (current) {
      skippedExisting.push(name);
      continue;
    }
    attributes.push({
      customFieldConfigurationId: definitionId,
      valueText,
    });
  }
  return { attributes, skippedExisting, missingValues, conflictingExisting };
}

export async function applyQuoteCustomFields(env, accessToken, quote, lead, requestId, options = {}) {
  if (env?.EXTERNAL_API_WRITES_ENABLED !== "true") {
    return { ok: false, skipped: true, reason: "external_api_writes_disabled" };
  }
  if (!quote?.id) return { ok: false, skipped: true, reason: "missing_quote_id" };
  const resolved = await resolveCustomFieldDefinitions(env, accessToken, options);
  if (!resolved.ok) return { ok: false, skipped: false, ...resolved };
  let currentQuote = quote;
  if (options.requireFreshQuote) {
    const fresh = await jobberGraphql(env, accessToken, QUOTE_CONTEXT_QUERY, { id: quote.id });
    if (!fresh.response.ok || fresh.data?.errors?.length) {
      return { ok: false, skipped: false, reason: classifyJobberFailure(fresh.response, fresh.data) };
    }
    currentQuote = fresh.data?.data?.quote;
    if (currentQuote?.id !== quote.id || currentQuote.request?.id !== options.expectedRequestId
      || currentQuote.request?.client?.id !== options.expectedClientId) {
      return { ok: false, skipped: true, reason: "quote_lineage_changed" };
    }
    if (typeof options.verifyLead !== "function" || !await options.verifyLead()) {
      return { ok: false, skipped: true, reason: "source_proof_changed" };
    }
  }
  const built = buildQuoteCustomFieldAttributes(
    resolved.definitions,
    lead,
    requestId,
    currentQuote.customFields,
    options,
  );
  if (built.conflictingExisting.length) {
    return { ok: false, skipped: true, reason: "quote_fields_conflict",
      conflictingExisting: built.conflictingExisting };
  }
  if (!built.attributes.length) {
    return {
      ok: false,
      skipped: true,
      reason: built.skippedExisting.length ? "values_already_present" : "no_mappable_values",
      skippedExisting: built.skippedExisting,
      missingValues: built.missingValues,
    };
  }
  try {
    const { response, data } = await jobberGraphql(
      env,
      accessToken,
      QUOTE_CUSTOM_FIELDS_MUTATION,
      { quoteId: quote.id, attributes: { customFields: built.attributes } },
    );
    const userErrors = data?.data?.quoteEdit?.userErrors || [];
    if (!response.ok || data?.errors?.length || userErrors.length
      || data?.data?.quoteEdit?.quote?.id !== quote.id) {
      return {
        ok: false,
        skipped: false,
        reason: classifyJobberFailure(response, data),
        status: response.status,
        userErrors,
        errors: data?.errors || [],
      };
    }
    if (options.requireFreshQuote) {
      const readback = await jobberGraphql(env, accessToken, QUOTE_CONTEXT_QUERY, { id: quote.id });
      if (!readback.response.ok || readback.data?.errors?.length) {
        return { ok: false, skipped: false,
          reason: classifyJobberFailure(readback.response, readback.data) };
      }
      const after = readback.data?.data?.quote;
      if (after?.id !== quote.id || after.request?.id !== options.expectedRequestId
        || after.request?.client?.id !== options.expectedClientId) {
        return { ok: false, skipped: true, reason: "quote_lineage_changed_after_write" };
      }
      const values = normalizeExistingCustomFields(after.customFields);
      if (buildClientCustomFieldValues(lead, requestId).some(([name, value]) =>
        (values.get(`id:${resolved.definitions.get(name)}`) || "") !== nonBlank(value).slice(0, 200))) {
        return { ok: false, skipped: false, reason: "quote_write_unverified" };
      }
    }
    return {
      ok: true,
      applied: built.attributes.length,
      appliedFields: [...resolved.definitions].filter(([, id]) =>
        built.attributes.some((attribute) => attribute.customFieldConfigurationId === id)).map(([name]) => name),
      skippedExisting: built.skippedExisting,
      missingValues: built.missingValues,
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

// A call's Google forwarding record can arrive after its Quote. Only upgrade
// the source we wrote for that same original Request; never replace a value
// that staff has changed or a campaign that is already populated.
export function buildGoogleCallQuoteReplayAttributes(definitions, quote, originalRequestId, campaign) {
  const existing = normalizeExistingCustomFields(quote?.customFields);
  const field = (name) => existing.get(`id:${definitions.get(name)}`) ?? "";
  const expectedLeadId = `jobber-request:${cleanScalar(originalRequestId, 200)}`;
  const campaignValue = cleanScalar(campaign, 200);
  if (!cleanScalar(originalRequestId, 200) || !campaignValue || field("Original Lead ID") !== expectedLeadId) {
    return { ok: false, reason: "original_lead_field_mismatch" };
  }
  const currentSource = field("Original Source");
  const currentCampaign = field("Campaign");
  if (currentSource === "Google Ads call" && currentCampaign === campaignValue) {
    return { ok: true, alreadyApplied: true, attributes: [] };
  }
  if (currentSource !== "Quo inbound call" || currentCampaign) {
    return { ok: false, reason: "quote_fields_changed" };
  }
  return {
    ok: true,
    alreadyApplied: false,
    attributes: [
      { customFieldConfigurationId: definitions.get("Original Source"), valueText: "Google Ads call" },
      { customFieldConfigurationId: definitions.get("Campaign"), valueText: campaignValue },
    ],
  };
}

export async function applyGoogleCallQuoteReplay(env, accessToken, quote, originalRequestId, campaign) {
  if (env?.EXTERNAL_API_WRITES_ENABLED !== "true") {
    return { ok: false, skipped: true, reason: "external_api_writes_disabled" };
  }
  const resolved = await resolveCustomFieldDefinitions(env, accessToken);
  if (!resolved.ok) return { ok: false, skipped: false, reason: resolved.reason || "definitions_missing" };
  const fresh = await jobberGraphql(env, accessToken, QUOTE_CONTEXT_QUERY, { id: quote.id });
  if (!fresh.response.ok || fresh.data?.errors?.length) {
    return { ok: false, skipped: false, reason: "verification_unavailable" };
  }
  const current = fresh.data?.data?.quote;
  if (current?.id !== quote.id || current.request?.id !== quote.request?.id
    || current.request?.client?.id !== quote.request?.client?.id) {
    return { ok: false, skipped: true, reason: "quote_lineage_changed" };
  }
  const built = buildGoogleCallQuoteReplayAttributes(resolved.definitions, current, originalRequestId, campaign);
  if (!built.ok) return { ok: false, skipped: true, reason: built.reason };
  if (built.alreadyApplied) return { ok: true, alreadyApplied: true, applied: 0 };
  try {
    const { response, data } = await jobberGraphql(env, accessToken, QUOTE_CUSTOM_FIELDS_MUTATION, {
      quoteId: quote.id,
      attributes: { customFields: built.attributes },
    });
    const userErrors = data?.data?.quoteEdit?.userErrors || [];
    if (!response.ok || data?.errors?.length || userErrors.length) {
      return { ok: false, skipped: false, reason: classifyJobberFailure(response, data), userErrors };
    }
    return { ok: true, alreadyApplied: false, applied: built.attributes.length };
  } catch {
    return { ok: false, skipped: false, reason: "network_error" };
  }
}

function googleCallQuoteFieldValues(definitions, quote) {
  const existing = normalizeExistingCustomFields(quote?.customFields);
  const field = (name) => existing.get(`id:${definitions.get(name)}`) ?? "";
  return {
    leadId: field("Original Lead ID"),
    source: field("Original Source"),
    campaign: field("Campaign"),
  };
}

export function buildGoogleCallQuoteDemotionAttributes(definitions, quote, originalRequestId, campaignWritten) {
  const expectedLeadId = `jobber-request:${cleanScalar(originalRequestId, 200)}`;
  const expectedCampaign = cleanScalar(campaignWritten, 200);
  const values = googleCallQuoteFieldValues(definitions, quote);
  if (!cleanScalar(originalRequestId, 200) || !expectedCampaign || values.leadId !== expectedLeadId) {
    return { ok: false, reason: "original_lead_field_mismatch" };
  }
  if (values.source === "Quo inbound call" && values.campaign === "") {
    return { ok: true, alreadyReverted: true, attributes: [] };
  }
  if (values.source !== "Google Ads call" || values.campaign !== expectedCampaign) {
    return { ok: false, reason: "quote_fields_changed" };
  }
  return {
    ok: true,
    attributes: [
      { customFieldConfigurationId: definitions.get("Original Source"), valueText: "Quo inbound call" },
      { customFieldConfigurationId: definitions.get("Campaign"), valueText: "" },
    ],
  };
}

export async function applyGoogleCallQuoteDemotion(env, accessToken, quote, originalRequestId, campaignWritten) {
  if (env?.EXTERNAL_API_WRITES_ENABLED !== "true") {
    return { ok: false, skipped: true, reason: "external_api_writes_disabled" };
  }
  const resolved = await resolveCustomFieldDefinitions(env, accessToken);
  if (!resolved.ok) return { ok: false, skipped: false, reason: resolved.reason || "definitions_missing" };
  const fresh = await jobberGraphql(env, accessToken, QUOTE_CONTEXT_QUERY, { id: quote.id });
  if (!fresh.response.ok || fresh.data?.errors?.length) {
    return { ok: false, skipped: false, reason: "verification_unavailable" };
  }
  const current = fresh.data?.data?.quote;
  if (current?.id !== quote.id || current.request?.id !== quote.request?.id
    || current.request?.client?.id !== quote.request?.client?.id) {
    return { ok: false, skipped: true, reason: "quote_lineage_changed" };
  }
  const built = buildGoogleCallQuoteDemotionAttributes(
    resolved.definitions, current, originalRequestId, campaignWritten,
  );
  if (!built.ok) return { ok: false, skipped: true, reason: built.reason };
  if (built.alreadyReverted) return { ok: true, alreadyReverted: true, applied: 0, verified: true };
  try {
    const { response, data } = await jobberGraphql(env, accessToken, QUOTE_CUSTOM_FIELDS_MUTATION, {
      quoteId: quote.id, attributes: { customFields: built.attributes },
    });
    const userErrors = data?.data?.quoteEdit?.userErrors || [];
    if (!response.ok || data?.errors?.length || userErrors.length) {
      return { ok: false, skipped: false, reason: classifyJobberFailure(response, data), userErrors };
    }
    const verified = await jobberGraphql(env, accessToken, QUOTE_CONTEXT_QUERY, { id: quote.id });
    if (!verified.response.ok || verified.data?.errors?.length) {
      return { ok: false, skipped: false, reason: "verification_unavailable" };
    }
    const values = googleCallQuoteFieldValues(resolved.definitions, verified.data?.data?.quote);
    if (values.leadId !== `jobber-request:${cleanScalar(originalRequestId, 200)}`
      || values.source !== "Quo inbound call" || values.campaign !== "") {
      return { ok: false, skipped: false, reason: "demotion_not_verified" };
    }
    return { ok: true, applied: built.attributes.length, verified: true };
  } catch {
    return { ok: false, skipped: false, reason: "network_error" };
  }
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
  CUSTOM_FIELD_CONFIGURATIONS_QUERY,
  QUOTE_CUSTOM_FIELD_APPLICABILITY,
  QUOTE_CONTEXT_QUERY,
  QUOTE_CUSTOM_FIELDS_MUTATION,
  MARKET_CONFIG_KEYS,
  classifyJobberFailure,
  filterQuoteCustomFieldConfigurations,
  jobberGraphql,
};
