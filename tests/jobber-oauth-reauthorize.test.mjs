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
