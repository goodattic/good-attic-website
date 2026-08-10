import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  _private as oauth,
  onRequestGet,
} from "../functions/api/jobber/oauth/callback.js";

class AuthD1 {
  constructor({ fail = false, commitThenThrow = false } = {}) {
    this.fail = fail;
    this.commitThenThrow = commitThenThrow;
    this.rows = new Map();
    this.locks = new Map();
    this.authWrites = 0;
  }

  prepare(sql) {
    const database = this;
    if (sql.includes("jobber_oauth_callback:verify_jobber_auth")) {
      return {
        bind(accountKey) {
          return {
            async first() {
              if (database.fail) throw new Error("D1 unavailable");
              const row = database.rows.get(accountKey);
              return row ? { ...row } : null;
            },
          };
        },
      };
    }

    if (sql.includes("jobber_oauth_callback:ensure_process_lock")) {
      return {
        bind(lockName, updatedAt) {
          return {
            async run() {
              if (database.fail) throw new Error("D1 unavailable");
              if (!database.locks.has(lockName)) {
                database.locks.set(lockName, {
                  leaseToken: null,
                  leaseExpiresAt: null,
                  updatedAt,
                });
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    }

    if (sql.includes("jobber_oauth_callback:acquire_process_lock")) {
      return {
        bind(leaseToken, leaseExpiresAt, updatedAt, lockName, now) {
          return {
            async run() {
              if (database.fail) throw new Error("D1 unavailable");
              const lock = database.locks.get(lockName);
              if (
                !lock
                || (
                  lock.leaseToken
                  && lock.leaseExpiresAt !== null
                  && lock.leaseExpiresAt > now
                )
              ) {
                return { meta: { changes: 0 } };
              }
              database.locks.set(lockName, {
                leaseToken,
                leaseExpiresAt,
                updatedAt,
              });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    }

    if (sql.includes("jobber_oauth_callback:release_process_lock")) {
      return {
        bind(updatedAt, lockName, leaseToken) {
          return {
            async run() {
              if (database.fail) throw new Error("D1 unavailable");
              const lock = database.locks.get(lockName);
              if (!lock || lock.leaseToken !== leaseToken) {
                return { meta: { changes: 0 } };
              }
              database.locks.set(lockName, {
                leaseToken: null,
                leaseExpiresAt: null,
                updatedAt,
              });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    }

    assert.match(sql, /jobber_oauth_callback:upsert_jobber_auth/);
    return {
      bind(...bindings) {
        return {
          async run() {
            if (database.fail) throw new Error("D1 unavailable");
            const [accountKey, accessToken, accessExpiresAt, refreshToken, updatedAt] = bindings;
            const previous = database.rows.get(accountKey);
            database.authWrites += 1;
            database.rows.set(accountKey, {
              accountKey,
              accessToken,
              accessExpiresAt,
              refreshToken,
              updatedAt,
              access_token: accessToken,
              access_expires_at: accessExpiresAt,
              refresh_token: refreshToken,
              refresh_revision: Number(previous?.refresh_revision || 0) + 1,
              refresh_status: "ready",
              refresh_lease_token: null,
              refresh_lease_expires_at: null,
              last_error_code: null,
            });
            if (database.commitThenThrow) {
              throw new Error("D1 response lost after commit");
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    };
  }
}

const EXPECTED_ACCOUNT_IDS = {
  ut: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==",
  mo_stl: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQ1Mw==",
  mo_kc: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMTkxOTgyNA==",
};

function verifiedAccount(route) {
  return {
    ok: true,
    account: {
      id: route.expectedAccountId,
      name: route.accountLabel,
    },
  };
}

async function signedState(market, secret, source) {
  const body = Buffer.from(JSON.stringify({
    market,
    ...(source ? { source } : {}),
    ts: Date.now(),
  })).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return `${body}.${Buffer.from(signature).toString("base64url")}`;
}

class RefreshTokenKV {
  constructor() {
    this.values = new Map();
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

test("maps OAuth markets to authoritative D1 account keys", () => {
  assert.equal(oauth.getAuthAccountKey(oauth.getMarketRoute("ut")), "utah");
  assert.equal(oauth.getAuthAccountKey(oauth.getMarketRoute("mo_stl")), "stl");
  assert.equal(oauth.getAuthAccountKey(oauth.getMarketRoute("mo_kc")), "kc");
});

test("isolates Google and Angi OAuth connections by source and market", () => {
  assert.equal(oauth.getAuthAccountKey(oauth.getMarketRoute("ut", "google")), "utah_google");
  assert.equal(oauth.getAuthAccountKey(oauth.getMarketRoute("mo_stl", "google")), "stl_google");
  assert.equal(oauth.getAuthAccountKey(oauth.getMarketRoute("mo_kc", "google")), "kc_google");
  assert.equal(oauth.getAuthAccountKey(oauth.getMarketRoute("ut", "angi")), "utah_angi");
  assert.equal(oauth.getMarketRoute("mo_stl", "angi"), null);
  assert.equal(oauth.getMarketRoute("mo_kc", "homeadvisor"), null);
  assert.equal(oauth.getMarketRoute("ut", "unknown-source"), null);
});

test("hard-pins every OAuth market to its authoritative Jobber account ID", () => {
  for (const [marketKey, expectedAccountId] of Object.entries(EXPECTED_ACCOUNT_IDS)) {
    const route = oauth.getMarketRoute(marketKey);
    assert.equal(route.expectedAccountId, expectedAccountId);
    assert.equal(
      oauth.requireExpectedJobberAccount(route, verifiedAccount(route)).id,
      expectedAccountId,
    );
  }
});

test("checkpoints access, refresh, and expiry in D1 and mirrors refresh to KV", async () => {
  const database = new AuthD1();
  const kv = new RefreshTokenKV();
  const route = oauth.getMarketRoute("ut");
  const before = Date.now();
  const result = await oauth.persistAuthorizedJobberTokens(
    {
      ANGI_ROUTER_DB: database,
      JOBBER_TOKEN_STORE: kv,
    },
    route,
    {
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expires_in: 1800,
    },
    verifiedAccount(route),
  );

  assert.equal(result.accountKey, "utah");
  assert.equal(result.d1Persisted, true);
  assert.equal(result.kvPersisted, true);
  const row = database.rows.get("utah");
  assert.equal(row.accessToken, "new-access-token");
  assert.equal(row.refreshToken, "new-refresh-token");
  assert.equal(row.refresh_revision, 1);
  assert.equal(row.refresh_status, "ready");
  assert.ok(row.accessExpiresAt >= before + 1_799_000);
  assert.equal(
    kv.values.get("jobber_refresh_token:JOBBER_REFRESH_TOKEN_SLC"),
    "new-refresh-token",
  );
});

test("OAuth reauthorization clears an unknown refresh fence and advances its revision", async () => {
  const database = new AuthD1();
  const route = oauth.getMarketRoute("ut");
  database.rows.set("utah", {
    access_token: "old-access",
    access_expires_at: Date.now() - 1,
    refresh_token: "uncertain-refresh",
    refresh_revision: 12,
    refresh_status: "refresh_outcome_unknown",
    refresh_lease_token: "old-lease",
    refresh_lease_expires_at: Date.now() - 1,
    last_error_code: "provider_transport_unknown",
  });

  await oauth.persistAuthorizedJobberTokens(
    { ANGI_ROUTER_DB: database },
    route,
    {
      access_token: "reauthorized-access",
      refresh_token: "reauthorized-refresh",
      expires_in: 3600,
    },
    verifiedAccount(route),
  );

  const row = database.rows.get("utah");
  assert.equal(row.refresh_revision, 13);
  assert.equal(row.refresh_status, "ready");
  assert.equal(row.refresh_lease_token, null);
  assert.equal(row.refresh_lease_expires_at, null);
  assert.equal(row.last_error_code, null);
});

test("verifies an OAuth checkpoint when the D1 success response is lost", async () => {
  const database = new AuthD1({ commitThenThrow: true });
  const route = oauth.getMarketRoute("mo_kc");
  const result = await oauth.persistAuthorizedJobberTokens(
    { ANGI_ROUTER_DB: database },
    route,
    {
      access_token: "kc-access",
      refresh_token: "kc-refresh",
      expires_in: 3600,
    },
    verifiedAccount(route),
  );
  assert.equal(result.d1Persisted, true);
  assert.equal(database.rows.get("kc")?.refresh_token, "kc-refresh");
});

test("a compatibility KV failure does not invalidate an authoritative D1 checkpoint", async () => {
  const database = new AuthD1();
  const route = oauth.getMarketRoute("mo_stl");
  const result = await oauth.persistAuthorizedJobberTokens(
    {
      ANGI_ROUTER_DB: database,
      JOBBER_TOKEN_STORE: {
        async put() {
          throw new Error("KV unavailable");
        },
      },
    },
    route,
    {
      access_token: "stl-access",
      refresh_token: "stl-refresh",
      expires_in: 3600,
    },
    verifiedAccount(route),
  );
  assert.equal(result.d1Persisted, true);
  assert.equal(result.kvPersisted, false);
  assert.equal(database.rows.get("stl")?.refresh_token, "stl-refresh");
});

test("checkpoints a source-specific token without overwriting the website connection", async () => {
  const database = new AuthD1();
  const kv = new RefreshTokenKV();
  database.rows.set("utah", {
    accountKey: "utah",
    accessToken: "website-access",
    refreshToken: "website-refresh",
  });
  const route = oauth.getMarketRoute("ut", "google");

  const result = await oauth.persistAuthorizedJobberTokens(
    {
      ANGI_ROUTER_DB: database,
      JOBBER_TOKEN_STORE: kv,
    },
    route,
    {
      access_token: "google-access",
      refresh_token: "google-refresh",
      expires_in: 1800,
    },
    verifiedAccount(route),
  );

  assert.equal(result.accountKey, "utah_google");
  assert.equal(database.rows.get("utah")?.refreshToken, "website-refresh");
  assert.equal(database.rows.get("utah_google")?.refreshToken, "google-refresh");
  assert.equal(
    kv.values.get("jobber_refresh_token:JOBBER_REFRESH_TOKEN_GOOGLE_SLC"),
    "google-refresh",
  );
});

test("verifies a signed source in OAuth state and rejects tampering", async () => {
  const setupKey = "test-only-oauth-setup-key";
  const googleState = await signedState("ut", setupKey, "google");
  const route = await oauth.verifyState({ JOBBER_OAUTH_SETUP_KEY: setupKey }, googleState);
  assert.equal(route.authAccountKey, "utah_google");

  const [body, signature] = googleState.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  payload.source = "angi";
  const tamperedBody = Buffer.from(JSON.stringify(payload)).toString("base64url");
  await assert.rejects(
    oauth.verifyState(
      { JOBBER_OAUTH_SETUP_KEY: setupKey },
      `${tamperedBody}.${signature}`,
    ),
    (error) => error?.name === "OAuthSetupError" && error?.status === 401,
  );
});

test("fails closed before reporting OAuth success when authoritative D1 checkpoint fails", async () => {
  const database = new AuthD1({ fail: true });
  const kv = new RefreshTokenKV();
  await assert.rejects(
    oauth.persistAuthorizedJobberTokens(
      {
        ANGI_ROUTER_DB: database,
        JOBBER_TOKEN_STORE: kv,
      },
      oauth.getMarketRoute("mo_stl"),
      {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
      },
      verifiedAccount(oauth.getMarketRoute("mo_stl")),
    ),
    (error) => error?.name === "OAuthSetupError" && error?.status === 503,
  );
  assert.equal(kv.values.size, 0);
});

test("rejects a wrong Utah account before any D1 or KV token persistence", async () => {
  const database = new AuthD1();
  const kv = new RefreshTokenKV();
  await assert.rejects(
    oauth.persistAuthorizedJobberTokens(
      {
        ANGI_ROUTER_DB: database,
        JOBBER_TOKEN_STORE: kv,
      },
      oauth.getMarketRoute("ut"),
      {
        access_token: "wrong-account-access",
        refresh_token: "wrong-account-refresh",
        expires_in: 3600,
      },
      {
        ok: true,
        account: {
          id: EXPECTED_ACCOUNT_IDS.mo_stl,
          name: "Good Attic - Saint Louis",
        },
      },
    ),
    (error) => error?.name === "OAuthSetupError" && error?.status === 409,
  );
  assert.equal(database.authWrites, 0);
  assert.equal(database.rows.size, 0);
  assert.equal(kv.values.size, 0);
});

test("callback locks before exchange and releases after rejecting a wrong Utah account", async () => {
  const database = new AuthD1();
  const kv = new RefreshTokenKV();
  const setupKey = "test-only-oauth-setup-key";
  const state = await signedState("ut", setupKey);
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/api/oauth/token")) {
      assert.ok(database.locks.get("utah_jobber_process")?.leaseToken);
      return Response.json({
        access_token: "wrong-account-access",
        refresh_token: "wrong-account-refresh",
        expires_in: 3600,
      });
    }
    if (String(url).includes("/api/graphql")) {
      return Response.json({
        data: {
          account: {
            id: EXPECTED_ACCOUNT_IDS.mo_stl,
            name: "Good Attic - Saint Louis",
          },
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await onRequestGet({
      request: new Request(
        `https://example.com/api/jobber/oauth/callback?code=single-use-code&state=${encodeURIComponent(state)}`,
      ),
      env: {
        ANGI_ROUTER_DB: database,
        JOBBER_TOKEN_STORE: kv,
        JOBBER_OAUTH_SETUP_KEY: setupKey,
        JOBBER_CLIENT_ID_SLC: "client-id",
        JOBBER_CLIENT_SECRET_SLC: "client-secret",
      },
    });

    assert.equal(response.status, 409);
    assert.deepEqual(calls, [
      "https://api.getjobber.com/api/oauth/token",
      "https://api.getjobber.com/api/graphql",
    ]);
    assert.equal(database.authWrites, 0);
    assert.equal(database.rows.size, 0);
    assert.equal(kv.values.size, 0);
    assert.equal(database.locks.get("utah_jobber_process")?.leaseToken, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails closed without D1 and does not fall back to KV-only persistence", async () => {
  const kv = new RefreshTokenKV();
  const route = oauth.getMarketRoute("ut");
  await assert.rejects(
    oauth.persistAuthorizedJobberTokens(
      { JOBBER_TOKEN_STORE: kv },
      route,
      {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
      },
      verifiedAccount(route),
    ),
    (error) => error?.name === "OAuthSetupError" && error?.status === 503,
  );
  assert.equal(kv.values.size, 0);
});

test("serializes OAuth reauthorization with the shared per-account Jobber lock", async () => {
  const database = new AuthD1();
  const env = { ANGI_ROUTER_DB: database };
  const route = oauth.getMarketRoute("ut");
  const firstLock = await oauth.acquireJobberProcessLock(env, route);

  await assert.rejects(
    oauth.acquireJobberProcessLock(env, route),
    (error) => error?.name === "OAuthSetupError" && error?.status === 503,
  );

  await oauth.releaseJobberProcessLock(env, firstLock);
  const nextLock = await oauth.acquireJobberProcessLock(env, route);
  assert.notEqual(nextLock.leaseToken, firstLock.leaseToken);
  await oauth.releaseJobberProcessLock(env, nextLock);
});

test("schema inspection is access-token-only and cannot rotate a refresh token", async () => {
  const source = await readFile(
    new URL("../scripts/inspect-jobber-schema.mjs", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("api/oauth/token"), false);
  assert.equal(source.includes("grant_type"), false);
  assert.match(source, /JOBBER_ACCESS_TOKEN/);
});
