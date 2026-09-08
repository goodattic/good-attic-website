const SCHEMA_VERSION = "2026-09-01";
const FIELDFLOW_WIRE_VERSION = "2026-07-31";
const MAX_ATTEMPTS = 3;

const MARKET_ROUTES = {
  ut: {
    slug: "slc",
    tokenKey: "FIELDFLOW_ATTRIBUTION_TOKEN_SLC",
  },
  mo_stl: {
    slug: "stl",
    tokenKey: "FIELDFLOW_ATTRIBUTION_TOKEN_STL",
  },
  mo_kc: {
    slug: "kc",
    tokenKey: "FIELDFLOW_ATTRIBUTION_TOKEN_KC",
  },
};

function cleanScalar(value, max = 500) {
  if (!["string", "number", "bigint"].includes(typeof value)) return "";
  return String(value).trim().slice(0, max);
}

function parseUrl(value) {
  try {
    return new URL(cleanScalar(value, 5000));
  } catch {
    return null;
  }
}

function readAttributionSignal(payload, field, prefix = "") {
  const landing = (prefix ? [payload?.[`${prefix}_landing_page`]] : [
    payload?.ad_landing_page,
    payload?.source_url,
    payload?.page_url,
  ])
    .map(parseUrl)
    .find(Boolean);
  return cleanScalar(landing?.searchParams.get(field), 500)
    || cleanScalar(payload?.[prefix ? `${prefix}_${field}` : field], 500);
}

function safeReferrerOrigin(value) {
  const referrer = cleanScalar(value, 2048);
  if (!referrer) return "";
  if (referrer.toLowerCase() === "google") return "google";
  if (/^(?:www\.)?google\.[a-z]{2,}(?:\.[a-z]{2})?$/i.test(referrer)) {
    return referrer.toLowerCase().replace(/^www\./, "");
  }
  const url = parseUrl(referrer);
  if (!url || !["http:", "https:"].includes(url.protocol)) return "";
  return url.origin;
}

function compactRecord(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== "" && value !== null && value !== undefined),
  );
}

export function buildWebsiteAttribution(payload, lead, jobber) {
  // Source identity is server-classified in /api/leads; editable form labels
  // never override the canonical Google Ads or Organic Online contract.
  // Fieldflow receives paid markers only after that server classification has
  // validated their freshness and shape. HighLevel still receives the raw
  // attribution payload for audit; this prevents stale/future markers from
  // reclassifying an Organic Online record downstream.
  const verifiedGoogleAds =
    cleanScalar(lead?.source_key, 50) === "google" &&
    cleanScalar(lead?.source_detail, 100) === "google_ads";
  // Use the whole visit selected by the server, never a saved click ID mixed
  // with the returning visitor's unrelated campaign or referrer.
  const reason = cleanScalar(lead?.source_reason, 2000);
  const prefix = verifiedGoogleAds && reason.startsWith("paid_touch_")
    ? "paid_touch"
    : verifiedGoogleAds && reason.startsWith("first_touch_")
      ? "first_touch"
      : "";
  const signal = (field) => readAttributionSignal(payload, field, prefix);
  return compactRecord({
    schema_version: SCHEMA_VERSION,
    jobber_request_id: cleanScalar(jobber?.request_id, 255),
    submission_id: cleanScalar(lead?.submission_id, 255),
    occurred_at: cleanScalar(lead?.submitted_at, 64),
    lead_source: cleanScalar(lead?.source_label, 100),
    source_key: cleanScalar(lead?.source_key, 50),
    source_detail: cleanScalar(lead?.source_detail, 100),
    source_reason: cleanScalar(lead?.source_reason, 2000) || "server_classified",
    self_reported_source: cleanScalar(lead?.self_reported_source, 80),
    self_reported_source_detail: cleanScalar(lead?.self_reported_source_detail, 80),
    gclid: verifiedGoogleAds ? signal("gclid") : "",
    gbraid: verifiedGoogleAds ? signal("gbraid") : "",
    wbraid: verifiedGoogleAds ? signal("wbraid") : "",
    gad_source: verifiedGoogleAds ? signal("gad_source") : "",
    utm_source: verifiedGoogleAds ? signal("utm_source") : "",
    utm_medium: verifiedGoogleAds ? signal("utm_medium") : "",
    utm_campaign: signal("utm_campaign"),
    referrer: safeReferrerOrigin(prefix
      ? payload?.[`${prefix}_referrer`]
      : payload?.ad_referrer || payload?.referrer),
  });
}

export function buildAngiAttribution(angi, requestId) {
  const providerLeadId = cleanScalar(angi?.leadOid, 255);
  const entityId = cleanScalar(angi?.spEntityId, 64);
  const submissionId = entityId && providerLeadId
    ? `angi:${entityId}:${providerLeadId}`
    : "";
  return compactRecord({
    schema_version: SCHEMA_VERSION,
    jobber_request_id: cleanScalar(requestId, 255),
    provider_lead_id: providerLeadId,
    provider_name: "Angi",
    submission_id: submissionId,
    occurred_at: cleanScalar(angi?.sourceEventAt || angi?.receivedAt, 64),
    lead_source: "Angi",
    source_reason: "server_routed_angi_provider",
    request_title: providerLeadId ? `[Angi ${providerLeadId}]` : "",
  });
}

export function buildFieldflowWireRecord(record) {
  if (![SCHEMA_VERSION, FIELDFLOW_WIRE_VERSION].includes(record?.schema_version)) {
    throw new Error("unsupported_attribution_schema");
  }
  // The deployed receiver still speaks the July contract. Keep the richer
  // source record intact for audit; send only fields that receiver accepts.
  const {
    self_reported_source,
    self_reported_source_detail,
    ...wire
  } = record;
  wire.schema_version = FIELDFLOW_WIRE_VERSION;
  if (wire.source_key === "website" && wire.source_detail === "ai_referral") {
    wire.source_detail = "organic_online";
  }
  return wire;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function submitFieldflowAttribution(env, marketKey, record) {
  const route = MARKET_ROUTES[marketKey];
  if (!route) {
    return {
      ok: false,
      attempts: 0,
      status: 0,
      reason: "unsupported_market",
    };
  }

  const baseUrl = cleanScalar(env?.FIELDFLOW_ATTRIBUTION_BASE_URL, 2048)
    .replace(/\/+$/, "");
  const token = cleanScalar(env?.[route.tokenKey], 4000);
  if (!baseUrl || !token) {
    return {
      ok: false,
      attempts: 0,
      status: 0,
      reason: "missing_configuration",
    };
  }

  let wireRecord;
  try {
    wireRecord = buildFieldflowWireRecord(record);
  } catch {
    return { ok: false, attempts: 0, status: 0, reason: "unsupported_attribution_schema" };
  }

  let lastStatus = 0;
  let lastReason = "network_error";
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      const response = await fetch(`${baseUrl}/${route.slug}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(wireRecord),
      });
      lastStatus = response.status;
      if (response.ok) {
        return {
          ok: true,
          attempts: attempt,
          status: response.status,
        };
      }

      lastReason = "receiver_rejected";
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
    } catch {
      lastReason = "network_error";
      if (attempt === MAX_ATTEMPTS) break;
    }

    await wait(250 * attempt);
  }

  return {
    ok: false,
    attempts,
    status: lastStatus,
    reason: lastReason,
  };
}

export const _private = {
  MARKET_ROUTES,
  SCHEMA_VERSION,
  readAttributionSignal,
  safeReferrerOrigin,
};
