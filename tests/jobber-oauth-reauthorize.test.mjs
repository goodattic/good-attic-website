import assert from "node:assert/strict";
import { test } from "node:test";

import { onRequestGet } from "../functions/api/jobber/oauth/reauthorize.js";

test("accepts the public Utah and St. Louis market aliases", async () => {
  for (const market of ["slc", "stl"]) {
    const response = await onRequestGet({
      request: new Request(`https://goodattic.energy/api/jobber/oauth/reauthorize?market=${market}`),
      env: {
        JOBBER_OAUTH_SETUP_KEY: "test-setup-key",
        JOBBER_CLIENT_ID_SLC: "slc-client-id",
        JOBBER_CLIENT_SECRET_SLC: "slc-client-secret",
        JOBBER_CLIENT_ID_STL: "stl-client-id",
        JOBBER_CLIENT_SECRET_STL: "stl-client-secret",
      },
    });
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location"), /api\.getjobber\.com\/api\/oauth\/authorize/);
  }
});

test("continues to exclude Kansas City from the reauthorization helper", async () => {
  const response = await onRequestGet({
    request: new Request("https://goodattic.energy/api/jobber/oauth/reauthorize?market=kc"),
    env: { JOBBER_OAUTH_SETUP_KEY: "test-setup-key", JOBBER_CLIENT_ID_KC: "kc-client-id" },
  });
  assert.equal(response.status, 400);
});

test('public reconnect permits only the KC Google source app and signs that route into OAuth state', async () => {
  const env = {
    JOBBER_OAUTH_SETUP_KEY: 'test-setup-key',
    JOBBER_CLIENT_ID_GOOGLE: 'google-client-id',
    JOBBER_CLIENT_SECRET_GOOGLE: 'google-client-secret',
    JOBBER_OAUTH_REDIRECT_URI: 'https://goodattic.energy/api/jobber/oauth/callback',
  };
  const response = await onRequestGet({
    request: new Request('https://goodattic.energy/api/jobber/oauth/reauthorize?market=kc&source=google'),
    env,
  });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.searchParams.get('client_id'), env.JOBBER_CLIENT_ID_GOOGLE);
  assert.equal(location.searchParams.get('redirect_uri'), env.JOBBER_OAUTH_REDIRECT_URI);
  const [body] = location.searchParams.get('state').split('.');
  const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  assert.equal(state.market, 'mo_kc');
  assert.equal(state.source, 'google');
  for (const query of ['market=kc', 'market=kc&source=angi', 'market=stl&source=google']) {
    const blocked = await onRequestGet({
      request: new Request(`https://goodattic.energy/api/jobber/oauth/reauthorize?${query}`), env,
    });
    assert.equal(blocked.status, 400);
  }
});
