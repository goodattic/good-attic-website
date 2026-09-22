import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  _private as health,
  checkSourceJobberAuthorizations,
  handleJobberAuthorizationHealth,
} from "../server/jobber-auth-health.js";

const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

const ACCOUNT_IDS = {
  utah_google: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==",
  stl_google: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQ1Mw==",
  kc_google: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMTkxOTgyNA==",
  utah_angi: "Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==",
};

class CachedAuthD1 {
  prepare(sql) {
    if (!sql.includes("jobber_token_authority:select_auth")) throw new Error(`Unexpected SQL: ${sql}`);
    return {
      bind: (accountKey) => ({
        async first() {
          return {
            access_token: `${accountKey}-access-token`,
            access_expires_at: Date.now() + 60 * 60 * 1000,
            refresh_token: `${accountKey}-refresh-token`,
            refresh_status: "ready",
          };
        },
      }),
    };
  }
}

test("checks only the configured Google and Angi source connections", async () => {
  globalThis.fetch = async (_url, options) => {
    const token = options.headers.Authorization.replace("bearer ", "");
    const accountKey = token.replace(/-access-token$/, "");
    return Response.json({ data: { account: { id: ACCOUNT_IDS[accountKey], name: accountKey } } });
  };
  const result = await checkSourceJobberAuthorizations({ ANGI_ROUTER_DB: new CachedAuthD1() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map(({ account_key, source_key }) => [account_key, source_key]), [
    ["utah_google", "google"],
    ["stl_google", "google"],
    ["kc_google", "google"],
    ["utah_angi", "angi"],
  ]);
  assert.ok(result.results.every((item) => item.token_rotated === false));
});

test("protects the health endpoint before reading token storage", async () => {
  const request = new Request("https://example.test/api/jobber/oauth/health-check", {
    method: "POST",
    headers: { Authorization: "Bearer wrong" },
  });
  const result = await handleJobberAuthorizationHealth({
    request,
    env: {
      JOBBER_AUTH_HEALTH_SECRET: "correct",
      ANGI_ROUTER_DB: { prepare() { throw new Error("database should not be touched"); } },
    },
  });
  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), { ok: false, code: "unauthorized" });
});

test("uses constant-time bearer authorization for the health endpoint", async () => {
  globalThis.fetch = async (_url, options) => {
    const token = options.headers.Authorization.replace("bearer ", "");
    const accountKey = token.replace(/-access-token$/, "");
    return Response.json({ data: { account: { id: ACCOUNT_IDS[accountKey], name: accountKey } } });
  };
  const request = new Request("https://example.test/api/jobber/oauth/health-check", {
    method: "POST",
    headers: { Authorization: "Bearer health-secret" },
  });
  const result = await handleJobberAuthorizationHealth({
    request,
    env: { JOBBER_AUTH_HEALTH_SECRET: "health-secret", ANGI_ROUTER_DB: new CachedAuthD1() },
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).ok, true);
});

assert.equal(health.SOURCE_ROUTES.some(([market, source]) => source === "website" || market === "general"), false);
