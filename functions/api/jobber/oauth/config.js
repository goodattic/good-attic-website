const MARKET_ALIASES = {
  slc: "ut",
  ut: "ut",
  stl: "mo_stl",
  mo_stl: "mo_stl",
  kc: "mo_kc",
  mo_kc: "mo_kc",
};

const MARKET_DEFINITIONS = {
  ut: {
    accountLabel: "Salt Lake City",
    accountKey: "utah",
    expectedAccountId: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==",
    suffix: "SLC",
  },
  mo_stl: {
    accountLabel: "St. Louis",
    accountKey: "stl",
    expectedAccountId: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQ1Mw==",
    suffix: "STL",
  },
  mo_kc: {
    accountLabel: "Kansas City",
    accountKey: "kc",
    expectedAccountId: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMTkxOTgyNA==",
    suffix: "KC",
  },
};

const SOURCE_ALIASES = {
  website: "website",
  web: "website",
  google: "google",
  google_ads: "google",
  angi: "angi",
  angieslist: "angi",
  homeadvisor: "angi",
};

const SOURCE_DEFINITIONS = {
  website: {
    label: "Website",
    clientIdEnvKey: null,
    clientSecretEnvKey: null,
    refreshTokenPrefix: "JOBBER_REFRESH_TOKEN",
  },
  google: {
    label: "Google",
    clientIdEnvKey: "JOBBER_CLIENT_ID_GOOGLE",
    clientSecretEnvKey: "JOBBER_CLIENT_SECRET_GOOGLE",
    refreshTokenPrefix: "JOBBER_REFRESH_TOKEN_GOOGLE",
  },
  angi: {
    label: "Angi",
    clientIdEnvKey: "JOBBER_CLIENT_ID_ANGI",
    clientSecretEnvKey: "JOBBER_CLIENT_SECRET_ANGI",
    refreshTokenPrefix: "JOBBER_REFRESH_TOKEN_ANGI",
    allowedMarkets: new Set(["ut"]),
  },
};

function clean(value, max = 80) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function normalizeJobberSource(value) {
  const normalized = clean(value).toLowerCase().replace(/[\s-]+/g, "_");
  return SOURCE_ALIASES[normalized] || "";
}

export function getJobberOAuthRoute(marketValue, sourceValue = "website") {
  const marketKey = MARKET_ALIASES[clean(marketValue, 40).toLowerCase()];
  const rawSource = clean(sourceValue, 40);
  const sourceKey = rawSource ? normalizeJobberSource(rawSource) : "website";
  const market = MARKET_DEFINITIONS[marketKey];
  const source = SOURCE_DEFINITIONS[sourceKey];
  if (!market || !source) return null;
  if (source.allowedMarkets && !source.allowedMarkets.has(marketKey)) return null;

  const sourceSuffix = sourceKey === "website" ? "" : `_${sourceKey}`;
  return {
    marketKey,
    sourceKey,
    sourceLabel: source.label,
    accountLabel: market.accountLabel,
    expectedAccountId: market.expectedAccountId,
    authAccountKey: `${market.accountKey}${sourceSuffix}`,
    processLockName: `${market.accountKey}${sourceSuffix}_jobber_process`,
    refreshTokenEnvKey: `${source.refreshTokenPrefix}_${market.suffix}`,
    clientIdEnvKey: source.clientIdEnvKey || `JOBBER_CLIENT_ID_${market.suffix}`,
    clientSecretEnvKey: source.clientSecretEnvKey || `JOBBER_CLIENT_SECRET_${market.suffix}`,
    fallbackClientIdEnvKey: sourceKey === "website" ? "JOBBER_CLIENT_ID" : "",
    fallbackClientSecretEnvKey: sourceKey === "website" ? "JOBBER_CLIENT_SECRET" : "",
  };
}

export const _private = {
  MARKET_ALIASES,
  MARKET_DEFINITIONS,
  SOURCE_DEFINITIONS,
};
