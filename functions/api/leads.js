import { getJobberOAuthRoute } from "./jobber/oauth/config.js";

const JOBBER_API_URL = "https://api.getjobber.com/api/graphql";
const JOBBER_TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const DEFAULT_JOBBER_GRAPHQL_VERSION = "2025-04-16";
const JOBBER_REFRESH_LEASE_MS = 2 * 60 * 1000;
const JOBBER_TOKEN_REQUEST_TIMEOUT_MS = 45 * 1000;
const GHL_MAX_ATTEMPTS = 3;
const ATTRIBUTION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const ATTRIBUTION_FUTURE_SKEW_MS = 5 * 60 * 1000;
const GOOGLE_PAID_MEDIA = new Set(["cpc", "ppc", "paidsearch", "paid-search", "sem"]);

const ATTRIBUTION_FIELDS = [
  "gclid",
  "gbraid",
  "wbraid",
  "gad_source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_id",
  "utm_term",
  "utm_content",
  "ad_landing_page",
  "ad_landing_page_path",
  "ad_referrer",
  "attribution_captured_at",
  "page_path",
  "page_market",
  "page_market_label",
  "page_service_context",
  "page_url",
];

const MARKET_ROUTES = {
  ut: {
    accountLabel: "Salt Lake City",
    authAccountKey: "utah",
    processLockName: "utah_jobber_process",
    refreshTokenEnvKey: "JOBBER_REFRESH_TOKEN_SLC",
    clientIdEnvKey: "JOBBER_CLIENT_ID_SLC",
    clientSecretEnvKey: "JOBBER_CLIENT_SECRET_SLC",
    fallbackClientIdEnvKey: "JOBBER_CLIENT_ID",
    fallbackClientSecretEnvKey: "JOBBER_CLIENT_SECRET",
    sourceKey: "website",
  },
  mo_stl: {
    accountLabel: "St. Louis",
    authAccountKey: "stl",
    processLockName: "stl_jobber_process",
    refreshTokenEnvKey: "JOBBER_REFRESH_TOKEN_STL",
    clientIdEnvKey: "JOBBER_CLIENT_ID_STL",
    clientSecretEnvKey: "JOBBER_CLIENT_SECRET_STL",
    fallbackClientIdEnvKey: "JOBBER_CLIENT_ID",
    fallbackClientSecretEnvKey: "JOBBER_CLIENT_SECRET",
    sourceKey: "website",
  },
  mo_kc: {
    accountLabel: "Kansas City",
    authAccountKey: "kc",
    processLockName: "kc_jobber_process",
    refreshTokenEnvKey: "JOBBER_REFRESH_TOKEN_KC",
    clientIdEnvKey: "JOBBER_CLIENT_ID_KC",
    clientSecretEnvKey: "JOBBER_CLIENT_SECRET_KC",
    fallbackClientIdEnvKey: "JOBBER_CLIENT_ID",
    fallbackClientSecretEnvKey: "JOBBER_CLIENT_SECRET",
    sourceKey: "website",
  },
  general: {
    accountLabel: "General",
    authAccountKey: "general",
    processLockName: "general_jobber_process",
    refreshTokenEnvKey: "JOBBER_REFRESH_TOKEN_GENERAL",
    clientIdEnvKey: "JOBBER_CLIENT_ID_GENERAL",
    clientSecretEnvKey: "JOBBER_CLIENT_SECRET_GENERAL",
    fallbackClientIdEnvKey: "JOBBER_CLIENT_ID",
    fallbackClientSecretEnvKey: "JOBBER_CLIENT_SECRET",
    sourceKey: "website",
  },
};

const JOBBER_CLIENT_CREATE_MUTATION = `
  mutation GoodAtticClientCreate($input: ClientCreateInput!) {
    clientCreate(input: $input) {
      client {
        id
        firstName
        lastName
        jobberWebUri
        clientProperties {
          nodes {
            id
            jobberWebUri
          }
        }
      }
      userErrors {
        message
        path
      }
    }
  }
`;

const JOBBER_REQUEST_CREATE_MUTATION = `
  mutation GoodAtticRequestCreate($input: RequestCreateInput!) {
    requestCreate(input: $input) {
      request {
        id
        title
        requestStatus
        jobberWebUri
        property {
          id
          jobberWebUri
        }
      }
      userErrors {
        message
        path
      }
    }
  }
`;

class LeadSubmissionError extends Error {
  constructor(message, status = 502, details = {}) {
    super(message);
    this.name = "LeadSubmissionError";
    this.status = status;
    this.details = details;
  }
}

function clean(value, max = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function cleanInline(value, max = 500) {
  return clean(value, max).replace(/\s+/g, " ");
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function splitName(fullName) {
  const parts = clean(fullName, 160).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1),
  };
}

function cleanList(value, max = 500) {
  if (Array.isArray(value)) {
    return value.map((item) => clean(item, max)).filter(Boolean).join(", ").slice(0, max);
  }
  return clean(value, max);
}

function normalizeZip(zip) {
  return clean(zip, 16).replace(/[^\d]/g, "").slice(0, 5);
}

function normalizePhone(phone) {
  const digits = clean(phone, 32).replace(/[^\d+]/g, "");
  return digits || clean(phone, 32);
}

function extractPathname(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function normalizeAttributionValue(value, max = 500) {
  return cleanInline(value, max).toLowerCase();
}

function normalizeAttributionMedium(value) {
  return normalizeAttributionValue(value, 80).replace(/[\s_]+/g, "-");
}

function parseAttributionUrl(value) {
  try {
    return new URL(clean(value, 5000));
  } catch {
    return null;
  }
}

function readAttributionSignal(payload, field) {
  const direct = cleanInline(payload[field], 500);
  const landing = parseAttributionUrl(payload.ad_landing_page || payload.source_url || payload.page_url);
  const fromLanding = landing ? cleanInline(landing.searchParams.get(field), 500) : "";
  return fromLanding || direct;
}

function isPlausibleGoogleClickId(value) {
  return /^[A-Za-z0-9._~-]{6,300}$/.test(cleanInline(value, 300));
}

function isGoogleSearchHost(hostname) {
  const host = clean(hostname, 300).toLowerCase().replace(/\.$/, "");
  return /^(?:www\.)?google\.(?:com|[a-z]{2,3}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host);
}

function hasFreshAttribution(payload, now = Date.now()) {
  const capturedAt = Date.parse(clean(payload.attribution_captured_at, 80));
  if (!Number.isFinite(capturedAt)) return false;
  const age = now - capturedAt;
  return age >= -ATTRIBUTION_FUTURE_SKEW_MS && age <= ATTRIBUTION_MAX_AGE_MS;
}

function classifyWebsiteLeadSource(payload, now = Date.now()) {
  if (!hasFreshAttribution(payload, now)) {
    return {
      key: "website",
      detail: "website_other",
      label: "Good Attic Website",
      reason: "missing_or_stale_attribution",
    };
  }

  const clickSignals = ["gclid", "gbraid", "wbraid"];
  for (const field of clickSignals) {
    if (isPlausibleGoogleClickId(readAttributionSignal(payload, field))) {
      return { key: "google", detail: "google_ads", label: "Google Ads", reason: field };
    }
  }

  const gadSource = readAttributionSignal(payload, "gad_source");
  if (/^\d{1,12}$/.test(gadSource)) {
    return { key: "google", detail: "google_ads", label: "Google Ads", reason: "gad_source" };
  }

  const utmSource = normalizeAttributionValue(readAttributionSignal(payload, "utm_source"), 80);
  const utmMedium = normalizeAttributionMedium(readAttributionSignal(payload, "utm_medium"));
  if (utmSource === "google" && GOOGLE_PAID_MEDIA.has(utmMedium)) {
    return { key: "google", detail: "google_ads", label: "Google Ads", reason: "google_paid_utm" };
  }

  const referrer = parseAttributionUrl(payload.ad_referrer);
  const googleReferrer = Boolean(referrer && isGoogleSearchHost(referrer.hostname));
  if ((utmSource === "google" && utmMedium === "organic") || googleReferrer) {
    return {
      key: "google",
      detail: "google_organic",
      label: "Google Organic",
      reason: googleReferrer ? "google_referrer" : "google_organic_utm",
    };
  }

  return {
    key: "website",
    detail: "website_other",
    label: "Good Attic Website",
    reason: "non_google_attribution",
  };
}

function inferMarket(payload) {
  const explicitMarket = clean(payload.page_market, 80).toLowerCase();
  if (explicitMarket && explicitMarket !== "general") {
    if (explicitMarket.includes("salt") || explicitMarket.includes("slc") || explicitMarket === "ut") {
      return "ut";
    }
    if (explicitMarket.includes("st. louis") || explicitMarket.includes("st louis") || explicitMarket.includes("stl")) {
      return "mo_stl";
    }
    if (explicitMarket.includes("kansas city") || explicitMarket.includes("kc")) {
      return "mo_kc";
    }
  }

  const sourcePath = [
    clean(payload.page_path, 500),
    extractPathname(clean(payload.source_url, 500)),
  ]
    .join(" ")
    .toLowerCase();

  if (sourcePath.includes("salt-lake-city-ut") || sourcePath.includes("-salt-lake-city")) {
    return "ut";
  }
  if (sourcePath.includes("st-louis-mo") || sourcePath.includes("-st-louis")) {
    return "mo_stl";
  }
  if (sourcePath.includes("kansas-city-mo") || sourcePath.includes("-kansas-city")) {
    return "mo_kc";
  }

  const state = clean(payload.state, 10).toUpperCase();
  if (state === "UT") return "ut";
  if (state === "KS") return "mo_kc";

  const zip = normalizeZip(payload.zip);
  if (/^(630|631|633)/.test(zip)) return "mo_stl";
  if (/^(640|641|644|645|646|647)/.test(zip)) return "mo_kc";

  return "general";
}

function buildLead(payload, submissionId = crypto.randomUUID(), source = null) {
  const suppliedFirstName = clean(payload.first_name, 80);
  const suppliedLastName = clean(payload.last_name, 80);
  const suppliedFullName = clean(payload.name, 160);
  const derivedFullName = [suppliedFirstName, suppliedLastName].filter(Boolean).join(" ");
  const { firstName, lastName } = splitName(suppliedFullName || derivedFullName);
  const marketKey = inferMarket(payload);
  const route = MARKET_ROUTES[marketKey] || MARKET_ROUTES.general;
  const leadSource = source || {
    key: "website",
    detail: "website_other",
    label: "Good Attic Website",
    reason: "explicit_non_website_flow",
  };

  return {
    first_name: suppliedFirstName || firstName,
    last_name: suppliedLastName || lastName,
    full_name: suppliedFullName || derivedFullName,
    phone: normalizePhone(payload.phone),
    email: clean(payload.email, 160),
    address: clean(payload.street_address || payload.address || payload.full_address, 240),
    city: clean(payload.city, 120),
    state: clean(payload.state, 10).toUpperCase(),
    zip: normalizeZip(payload.zip),
    service: cleanList(payload.project_type_label || payload.project_type || payload.service || "Attic insulation assessment", 160),
    message: clean(payload.additional_notes || payload.message || payload.notes, 2000),
    source_url: clean(payload.source_url || payload.page_url || payload.ad_landing_page, 500),
    page_path: clean(payload.page_path, 500),
    page_market: clean(payload.page_market, 120),
    consent: clean(payload.consent || payload.sms_consent, 500),
    submitted_at: new Date().toISOString(),
    submission_id: submissionId,
    market_key: marketKey,
    market_label: route.accountLabel,
    source_key: leadSource.key,
    source_detail: leadSource.detail,
    source_label: leadSource.label,
    source_reason: leadSource.reason,
  };
}

function buildAttribution(payload) {
  return ATTRIBUTION_FIELDS.reduce((attribution, field) => {
    attribution[field] = cleanInline(payload[field], 500);
    return attribution;
  }, {});
}

function normalizeProjectTypes(payload, lead) {
  const values = Array.isArray(payload.project_type)
    ? payload.project_type
    : payload.project_type
      ? [payload.project_type]
      : [lead.service];
  return values.map((value) => cleanInline(value, 80)).filter(Boolean);
}

function buildGhlLead(payload, lead, jobber) {
  const projectTypes = normalizeProjectTypes(payload, lead);
  const attribution = buildAttribution(payload);
  const fullAddress = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");

  return {
    first_name: lead.first_name,
    last_name: lead.last_name,
    name: lead.full_name,
    phone: lead.phone,
    email: lead.email,
    street_address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    postal_code: lead.zip,
    full_address: fullAddress,
    address: {
      street: lead.address,
      city: lead.city,
      state: lead.state,
      postal_code: lead.zip,
    },
    project_type: projectTypes,
    project_type_label: projectTypes.join(", ") || lead.service,
    services_requested: projectTypes.join(", ") || lead.service,
    preferred_day: cleanInline(payload.preferred_day, 60),
    preferred_date: cleanInline(payload.preferred_day, 60),
    preferred_time: cleanInline(payload.preferred_time, 80),
    additional_notes: lead.message,
    notes: lead.message,
    consent: lead.consent,
    lead_source: lead.source_label,
    source_key: lead.source_key,
    source_detail: lead.source_detail,
    source_reason: lead.source_reason,
    form_name: cleanInline(payload.form_name, 120),
    source_page: cleanInline(payload.source_page, 500) || lead.source_url,
    source_url: lead.source_url,
    market_key: lead.market_key,
    market_label: lead.market_label,
    submission_id: lead.submission_id,
    submitted_at: lead.submitted_at,
    jobber_account: jobber.account,
    jobber_client_id: jobber.client_id,
    jobber_client_url: jobber.client_url,
    jobber_property_id: jobber.property_id,
    jobber_property_url: jobber.property_url,
    jobber_request_id: jobber.request_id,
    jobber_request_url: jobber.request_url,
    ...attribution,
    attribution,
  };
}

function validateLead(lead) {
  const missing = [];
  if (!lead.full_name) missing.push("name");
  if (!lead.phone) missing.push("phone");
  if (!lead.email) missing.push("email");
  if (!lead.address) missing.push("address");
  if (!lead.city) missing.push("city");
  if (!lead.state) missing.push("state");
  if (!lead.zip) missing.push("zip");
  return missing;
}

function getJobberBrokerAccountKey(route) {
  if (route.authAccountKey) return route.authAccountKey;
  if (route.refreshTokenEnvKey === "JOBBER_REFRESH_TOKEN_SLC") return "utah";
  if (route.refreshTokenEnvKey === "JOBBER_REFRESH_TOKEN_STL") return "stl";
  if (route.refreshTokenEnvKey === "JOBBER_REFRESH_TOKEN_KC") return "kc";
  return "general";
}

function d1Changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

async function refreshJobberAccessTokenViaD1(env, route) {
  const database = env.ANGI_ROUTER_DB;
  const accountKey = getJobberBrokerAccountKey(route);
  const lockName = route.processLockName || `${accountKey}_jobber_process`;
  const cached = await database
    .prepare(`
      /* jobber_token_authority:select_auth */
      SELECT
        access_token,
        access_expires_at,
        refresh_token,
        COALESCE(refresh_revision, 0) AS refresh_revision,
        COALESCE(refresh_status, 'ready') AS refresh_status,
        refresh_lease_token,
        refresh_lease_expires_at,
        last_error_code
      FROM angi_router_jobber_auth
      WHERE account_key = ?
    `)
    .bind(accountKey)
    .first();
  if (
    (cached?.refresh_status || "ready") === "ready"
    && cached?.access_token
    && Number(cached.access_expires_at || 0) > Date.now() + 60_000
  ) {
    return {
      accessToken: clean(cached.access_token, 4000),
      tokenRotated: false,
      tokenPersisted: true,
    };
  }

  if (cached?.refresh_status === "refresh_outcome_unknown") {
    throw new LeadSubmissionError(
      "Jobber authorization needs to be reconnected before routing can continue.",
      503,
      {
        account: route.accountLabel,
        code: "jobber_refresh_outcome_unknown",
      },
    );
  }

  const leaseToken = crypto.randomUUID();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  await database
    .prepare(`
      /* jobber_token_authority:ensure_process_lock */
      INSERT OR IGNORE INTO angi_router_locks (
        lock_name, lease_token, lease_expires_at, updated_at
      ) VALUES (?, NULL, NULL, ?)
    `)
    .bind(lockName, nowIso)
    .run();
  const lock = await database
    .prepare(`
      /* jobber_token_authority:acquire_process_lock */
      UPDATE angi_router_locks
      SET lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE lock_name = ?
        AND (lease_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
    `)
    .bind(leaseToken, now + (4 * 60 * 1000), nowIso, lockName, now)
    .run();
  if (d1Changes(lock) !== 1) {
    throw new LeadSubmissionError("Jobber routing is temporarily busy.", 503, {
      account: route.accountLabel,
    });
  }

  try {
    const stored = await database
      .prepare(`
        /* jobber_token_authority:select_auth */
        SELECT
          access_token,
          access_expires_at,
          refresh_token,
          COALESCE(refresh_revision, 0) AS refresh_revision,
          COALESCE(refresh_status, 'ready') AS refresh_status,
          refresh_lease_token,
          refresh_lease_expires_at,
          last_error_code
        FROM angi_router_jobber_auth
        WHERE account_key = ?
      `)
      .bind(accountKey)
      .first();
    if (
      (stored?.refresh_status || "ready") === "ready"
      && stored?.access_token
      && Number(stored.access_expires_at || 0) > Date.now() + 60_000
    ) {
      return {
        accessToken: clean(stored.access_token, 4000),
        tokenRotated: false,
        tokenPersisted: true,
      };
    }

    if (stored?.refresh_status === "refresh_outcome_unknown") {
      throw new LeadSubmissionError(
        "Jobber authorization needs to be reconnected before routing can continue.",
        503,
        {
          account: route.accountLabel,
          code: "jobber_refresh_outcome_unknown",
        },
      );
    }

    if (stored?.refresh_status === "in_flight") {
      if (Number(stored.refresh_lease_expires_at || 0) > Date.now()) {
        throw new LeadSubmissionError("Jobber routing is temporarily busy.", 503, {
          account: route.accountLabel,
          code: "jobber_refresh_in_flight",
        });
      }

      try {
        await database
          .prepare(`
            /* jobber_token_authority:fence_expired_refresh */
            UPDATE angi_router_jobber_auth
            SET
              refresh_status = 'refresh_outcome_unknown',
              refresh_lease_token = NULL,
              refresh_lease_expires_at = NULL,
              last_error_code = 'refresh_lease_expired',
              updated_at = ?
            WHERE account_key = ?
              AND refresh_status = 'in_flight'
              AND refresh_revision = ?
              AND refresh_lease_token = ?
          `)
          .bind(
            new Date().toISOString(),
            accountKey,
            Number(stored.refresh_revision || 0),
            stored.refresh_lease_token,
          )
          .run();
      } catch {
        // An abandoned refresh is still fenced by its in-flight state.
      }
      throw new LeadSubmissionError(
        "Jobber authorization needs to be reconnected before routing can continue.",
        503,
        {
          account: route.accountLabel,
          code: "jobber_refresh_lease_expired",
        },
      );
    }

    const clientId = clean(env[route.clientIdEnvKey], 500)
      || clean(env[route.fallbackClientIdEnvKey], 500);
    const clientSecret = clean(env[route.clientSecretEnvKey], 1000)
      || clean(env[route.fallbackClientSecretEnvKey], 1000);
    // D1 is the sole production authority. Never replay a KV/env copy after a
    // rotating refresh token has been checkpointed (or may have been rotated).
    const refreshToken = clean(stored?.refresh_token, 4000);
    if (!clientId || !clientSecret || !refreshToken) {
      throw new LeadSubmissionError("Jobber lead routing is not configured yet.", 503, {
        account: route.accountLabel,
        code: "jobber_authoritative_token_missing",
      });
    }

    const refreshLeaseToken = crypto.randomUUID();
    const previousRevision = Number(stored.refresh_revision || 0);
    const refreshRevision = previousRevision + 1;
    const refreshStartedAt = Date.now();
    const claimed = await database
      .prepare(`
        /* jobber_token_authority:claim_refresh */
        UPDATE angi_router_jobber_auth
        SET
          refresh_revision = ?,
          refresh_status = 'in_flight',
          refresh_lease_token = ?,
          refresh_lease_expires_at = ?,
          last_error_code = NULL,
          updated_at = ?
        WHERE account_key = ?
          AND COALESCE(refresh_status, 'ready') = 'ready'
          AND COALESCE(refresh_revision, 0) = ?
          AND refresh_token = ?
      `)
      .bind(
        refreshRevision,
        refreshLeaseToken,
        refreshStartedAt + JOBBER_REFRESH_LEASE_MS,
        new Date(refreshStartedAt).toISOString(),
        accountKey,
        previousRevision,
        refreshToken,
      )
      .run();
    if (d1Changes(claimed) !== 1) {
      throw new LeadSubmissionError("Jobber routing is temporarily busy.", 503, {
        account: route.accountLabel,
        code: "jobber_refresh_claim_conflict",
      });
    }

    const markRefreshOutcomeUnknown = async (errorCode) => {
      try {
        await database
          .prepare(`
            /* jobber_token_authority:mark_refresh_unknown */
            UPDATE angi_router_jobber_auth
            SET
              refresh_status = 'refresh_outcome_unknown',
              refresh_lease_token = NULL,
              refresh_lease_expires_at = NULL,
              last_error_code = ?,
              updated_at = ?
            WHERE account_key = ?
              AND refresh_status = 'in_flight'
              AND refresh_revision = ?
              AND refresh_lease_token = ?
          `)
          .bind(
            clean(errorCode, 120),
            new Date().toISOString(),
            accountKey,
            refreshRevision,
            refreshLeaseToken,
          )
          .run();
      } catch {
        // Leaving the durable in-flight fence is safe. Once it expires, the
        // next caller promotes it to refresh_outcome_unknown instead of retrying.
      }
    };

    let response;
    try {
      response = await fetch(JOBBER_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).toString(),
        signal: AbortSignal.timeout(JOBBER_TOKEN_REQUEST_TIMEOUT_MS),
      });
    } catch {
      await markRefreshOutcomeUnknown("provider_transport_unknown");
      throw new LeadSubmissionError(
        "Jobber token refresh had an unknown outcome; reconnect before retrying.",
        503,
        {
          account: route.accountLabel,
          code: "jobber_refresh_transport_unknown",
        },
      );
    }
    const data = await safeJson(response);
    const nextAccessToken = clean(data?.access_token, 4000);
    const nextRefreshToken = clean(data?.refresh_token, 4000);
    if (!response.ok || !nextAccessToken || !nextRefreshToken) {
      await markRefreshOutcomeUnknown(`provider_response_${response.status || 0}_unknown`);
      throw new LeadSubmissionError(
        "Jobber token refresh did not return a safely checkpointable token pair; reconnect before retrying.",
        503,
        {
          account: route.accountLabel,
          status: response.status,
          code: "jobber_refresh_response_unknown",
          response: scrubJobberResponse(data),
        },
      );
    }

    const expiresInSeconds = Math.max(60, Math.min(7200, Number(data.expires_in) || 3600));
    const accessExpiresAt = Date.now() + (expiresInSeconds * 1000);
    let checkpointed = false;
    try {
      const persisted = await database
        .prepare(`
          /* jobber_token_authority:checkpoint_refresh */
          UPDATE angi_router_jobber_auth
          SET
            access_token = ?,
            access_expires_at = ?,
            refresh_token = ?,
            refresh_status = 'ready',
            refresh_lease_token = NULL,
            refresh_lease_expires_at = NULL,
            last_error_code = NULL,
            updated_at = ?
          WHERE account_key = ?
            AND refresh_status = 'in_flight'
            AND refresh_revision = ?
            AND refresh_lease_token = ?
        `)
        .bind(
          nextAccessToken,
          accessExpiresAt,
          nextRefreshToken,
          new Date().toISOString(),
          accountKey,
          refreshRevision,
          refreshLeaseToken,
        )
        .run();
      checkpointed = d1Changes(persisted) === 1;
    } catch {
      // A D1 response can be lost after the write commits. Verify below.
    }

    if (!checkpointed) {
      try {
        const verified = await database
          .prepare(`
            /* jobber_token_authority:verify_checkpoint */
            SELECT
              access_token,
              access_expires_at,
              refresh_token,
              COALESCE(refresh_revision, 0) AS refresh_revision,
              COALESCE(refresh_status, 'ready') AS refresh_status
            FROM angi_router_jobber_auth
            WHERE account_key = ?
          `)
          .bind(accountKey)
          .first();
        checkpointed = verified?.refresh_status === "ready"
          && Number(verified.refresh_revision || 0) === refreshRevision
          && clean(verified.access_token, 4000) === nextAccessToken
          && clean(verified.refresh_token, 4000) === nextRefreshToken
          && Number(verified.access_expires_at || 0) === accessExpiresAt;
      } catch {
        checkpointed = false;
      }
    }

    if (!checkpointed) {
      await markRefreshOutcomeUnknown("token_checkpoint_unknown");
      throw new LeadSubmissionError(
        "Jobber token refresh could not be verified; reconnect before retrying.",
        503,
        {
          account: route.accountLabel,
          code: "jobber_refresh_checkpoint_unknown",
        },
      );
    }
    return {
      accessToken: nextAccessToken,
      tokenRotated: nextRefreshToken !== refreshToken,
      tokenPersisted: true,
    };
  } finally {
    try {
      await database
        .prepare(`
          /* jobber_token_authority:release_process_lock */
          UPDATE angi_router_locks
          SET lease_token = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE lock_name = ? AND lease_token = ?
        `)
        .bind(new Date().toISOString(), lockName, leaseToken)
        .run();
    } catch {
      // The lease expires automatically.
    }
  }
}

async function refreshJobberAccessToken(env, route) {
  if (env.ANGI_ROUTER_DB && typeof env.ANGI_ROUTER_DB.prepare === "function") {
    return refreshJobberAccessTokenViaD1(env, route);
  }
  throw new LeadSubmissionError(
    "The authoritative Jobber token database is unavailable.",
    503,
    {
      account: route.accountLabel,
      code: "jobber_authoritative_database_unavailable",
    },
  );
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function scrubJobberResponse(data) {
  if (!data || typeof data !== "object") return data;
  const clone = JSON.parse(JSON.stringify(data));
  for (const key of ["access_token", "refresh_token", "client_secret"]) {
    if (key in clone) clone[key] = "[redacted]";
  }
  return clone;
}

async function jobberGraphql(env, accessToken, query, variables) {
  const response = await fetch(JOBBER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-JOBBER-GRAPHQL-VERSION": clean(env.JOBBER_GRAPHQL_VERSION, 40) || DEFAULT_JOBBER_GRAPHQL_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });

  const data = await safeJson(response);
  if (!response.ok || data?.errors?.length) {
    throw new LeadSubmissionError("Jobber GraphQL request failed.", response.status || 502, {
      status: response.status,
      response: scrubJobberResponse(data),
    });
  }

  return data;
}

function buildClientInput(lead, { includePhone = true } = {}) {
  const input = {
    firstName: lead.first_name || lead.full_name,
    lastName: lead.last_name,
    properties: [
      {
        name: "Service address",
        address: {
          street1: lead.address,
          city: lead.city,
          province: lead.state,
          postalCode: lead.zip,
          country: "United States",
        },
      },
    ],
  };

  if (lead.email) {
    input.emails = [
      {
        description: "MAIN",
        primary: true,
        address: lead.email,
      },
    ];
  }

  if (includePhone && lead.phone) {
    input.phones = [
      {
        description: "MAIN",
        primary: true,
        number: lead.phone,
      },
    ];
  }

  return input;
}

function getMutationUserErrors(result, mutationName) {
  return result?.data?.[mutationName]?.userErrors || [];
}

function buildRequestInstructions(lead) {
  const address = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
  const lines = [
    "Good Attic website form submission",
    `Lead source: ${lead.source_label}`,
    `Attribution reason: ${lead.source_reason}`,
    `Service requested: ${lead.service}`,
    `Service address: ${address}`,
    `Market route: ${lead.market_label}`,
    lead.message ? `Customer notes: ${lead.message}` : "Customer notes: None provided",
    lead.source_url ? `Source page: ${lead.source_url}` : "",
    lead.page_path ? `Page path: ${lead.page_path}` : "",
    lead.consent ? `Consent: ${lead.consent}` : "",
    `Submission ID: ${lead.submission_id}`,
    `Submitted: ${lead.submitted_at}`,
  ].filter(Boolean);

  return clean(lines.join("\n"), 4000);
}

function buildRequestInput(lead, clientId, propertyId) {
  const input = {
    clientId,
    title: clean(lead.service || "Website attic assessment", 240),
  };

  if (propertyId) input.propertyId = propertyId;
  return input;
}

function shouldRetryWithoutPhone(error) {
  const response = error?.details?.response;
  if (!response || response?.errors?.length) return false;
  const payload = response?.data?.clientCreate;
  if (!payload || payload?.client?.id) return false;
  const userErrors = Array.isArray(payload.userErrors) ? payload.userErrors : [];
  return userErrors.length > 0 && userErrors.some((userError) => (
    /phone|phones/i.test(JSON.stringify(userError))
  ));
}

async function createJobberClient(env, accessToken, lead) {
  try {
    const result = await jobberGraphql(env, accessToken, JOBBER_CLIENT_CREATE_MUTATION, {
      input: buildClientInput(lead, { includePhone: true }),
    });

    if (getMutationUserErrors(result, "clientCreate").length) {
      throw new LeadSubmissionError("Jobber did not accept the client lead.", 502, {
        response: scrubJobberResponse(result),
      });
    }

    return {
      result,
      phoneIncluded: true,
    };
  } catch (error) {
    if (!(error instanceof LeadSubmissionError) || !shouldRetryWithoutPhone(error)) {
      throw error;
    }

    const fallback = await jobberGraphql(env, accessToken, JOBBER_CLIENT_CREATE_MUTATION, {
      input: buildClientInput(lead, { includePhone: false }),
    });

    if (getMutationUserErrors(fallback, "clientCreate").length) {
      throw new LeadSubmissionError("Jobber did not accept the fallback client lead.", 502, {
        response: scrubJobberResponse(fallback),
      });
    }

    return {
      result: fallback,
      phoneIncluded: false,
    };
  }
}

async function createJobberRequest(env, accessToken, lead, clientId, propertyId) {
  const result = await jobberGraphql(env, accessToken, JOBBER_REQUEST_CREATE_MUTATION, {
    input: buildRequestInput(lead, clientId, propertyId),
  });

  if (getMutationUserErrors(result, "requestCreate").length) {
    throw new LeadSubmissionError("Jobber did not accept the work request.", 502, {
      response: scrubJobberResponse(result),
      clientId,
    });
  }

  const request = result?.data?.requestCreate?.request;
  if (!request?.id) {
    throw new LeadSubmissionError("Jobber did not return the created work request.", 502, {
      response: scrubJobberResponse(result),
      clientId,
    });
  }

  return request;
}

function enabledGoogleMarkets(env) {
  return new Set(
    clean(env.JOBBER_GOOGLE_ROUTING_MARKETS, 200)
      .toLowerCase()
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function resolveLeadJobberRoute(env, lead) {
  const websiteRoute = MARKET_ROUTES[lead.market_key];
  if (!websiteRoute) {
    throw new LeadSubmissionError(
      "No authoritative Jobber account is configured for this market.",
      422,
      {
        market: lead.market_key,
        code: "unsupported_jobber_market",
      },
    );
  }
  if (lead.source_key !== "google") {
    return { ...websiteRoute, attributionFallback: false };
  }

  const enabledMarkets = enabledGoogleMarkets(env);
  if (!enabledMarkets.has(lead.market_key)) {
    return { ...websiteRoute, attributionFallback: true };
  }

  const googleRoute = getJobberOAuthRoute(lead.market_key, "google");
  if (!googleRoute) {
    return { ...websiteRoute, attributionFallback: true };
  }

  return { ...googleRoute, attributionFallback: false };
}

async function submitLeadToJobber(env, lead) {
  const route = resolveLeadJobberRoute(env, lead);
  const token = await refreshJobberAccessToken(env, route);
  const created = await createJobberClient(env, token.accessToken, lead);
  const client = created.result?.data?.clientCreate?.client || {};
  const property = client.clientProperties?.nodes?.[0] || null;

  if (!client.id) {
    throw new LeadSubmissionError("Jobber did not return the created client.", 502, {
      account: route.accountLabel,
    });
  }

  const request = await createJobberRequest(
    env,
    token.accessToken,
    lead,
    client.id,
    property?.id || null,
  );

  return {
    account: route.accountLabel,
    account_id: route.expectedAccountId,
    market_key: lead.market_key,
    client_id: client.id || null,
    client_url: client.jobberWebUri || null,
    property_id: request.property?.id || property?.id || null,
    property_url: request.property?.jobberWebUri || property?.jobberWebUri || null,
    request_id: request.id,
    request_url: request.jobberWebUri || null,
    attributed_source: lead.source_label,
    jobber_source_app: route.sourceKey || "website",
    source_app_fallback: route.attributionFallback,
    phone_included: created.phoneIncluded,
    refresh_token_rotated: token.tokenRotated,
    refresh_token_persisted: token.tokenPersisted,
    custom_fields: { ok: false, skipped: true, reason: "wait_for_first_quote" },
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function submitLeadToGhl(env, ghlLead) {
  const webhookUrl = clean(env.GHL_WEBHOOK_URL, 2000);
  if (!webhookUrl) {
    return {
      ok: false,
      attempts: 0,
      status: 0,
      reason: "missing_configuration",
    };
  }

  let lastStatus = 0;
  let lastReason = "request_failed";

  for (let attempt = 1; attempt <= GHL_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(ghlLead),
      });

      lastStatus = response.status;
      if (response.ok) {
        return {
          ok: true,
          attempts: attempt,
          status: response.status,
        };
      }

      lastReason = "webhook_rejected";
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === GHL_MAX_ATTEMPTS) break;
    } catch {
      lastReason = "network_error";
      if (attempt === GHL_MAX_ATTEMPTS) break;
    }

    await wait(250 * attempt);
  }

  return {
    ok: false,
    attempts: GHL_MAX_ATTEMPTS,
    status: lastStatus,
    reason: lastReason,
  };
}

export async function onRequestPost({ request, env }) {
  let payload;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: "Invalid JSON payload." }, 400);
  }

  const source = classifyWebsiteLeadSource(payload || {});
  const lead = buildLead(payload || {}, crypto.randomUUID(), source);
  const missing = validateLead(lead);
  if (missing.length) {
    return jsonResponse({
      ok: false,
      message: "Please complete the required fields.",
      missing,
    }, 400);
  }

  try {
    const jobber = await submitLeadToJobber(env, lead);
    // Attribution is intentionally loaded only for website lead submission.
    // The private appointment resolver imports the Jobber helpers in this file
    // without bringing Fieldflow into its execution path.
    const {
      buildWebsiteAttribution,
      submitFieldflowAttribution,
    } = await import("../../server/fieldflow-attribution.js");
    const [ghl, fieldflow] = await Promise.all([
      submitLeadToGhl(env, buildGhlLead(payload, lead, jobber)),
      submitFieldflowAttribution(
        env,
        lead.market_key,
        buildWebsiteAttribution(payload, lead, jobber),
      ),
    ]);

    if (!ghl.ok) {
      console.error("HighLevel lead delivery failed after Jobber succeeded.", {
        submissionId: lead.submission_id,
        market: lead.market_key,
        attempts: ghl.attempts,
        status: ghl.status,
        reason: ghl.reason,
      });
    }
    if (!fieldflow.ok) {
      console.error("Fieldflow attribution delivery failed after Jobber succeeded.", {
        submissionId: lead.submission_id,
        market: lead.market_key,
        attempts: fieldflow.attempts,
        status: fieldflow.status,
        reason: fieldflow.reason,
      });
    }

    return jsonResponse({
      ok: true,
      message: ghl.ok ? "Lead sent to Jobber and HighLevel." : "Lead sent to Jobber.",
      jobber,
      ghl,
      fieldflow,
    });
  } catch (error) {
    if (error instanceof LeadSubmissionError) {
      return jsonResponse({
        ok: false,
        message: error.message,
        details: error.details,
      }, error.status);
    }

    return jsonResponse({
      ok: false,
      message: "Unexpected lead routing error.",
    }, 500);
  }
}

export const _private = {
  LeadSubmissionError,
  MARKET_ROUTES,
  buildLead,
  classifyWebsiteLeadSource,
  hasFreshAttribution,
  isGoogleSearchHost,
  inferMarket,
  validateLead,
  buildClientInput,
  buildRequestInput,
  buildRequestInstructions,
  buildGhlLead,
  refreshJobberAccessToken,
  jobberGraphql,
  createJobberClient,
  createJobberRequest,
  resolveLeadJobberRoute,
  submitLeadToJobber,
  submitLeadToGhl,
};
