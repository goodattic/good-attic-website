import assert from "node:assert/strict";
import { test } from "node:test";
import { handleJobberContactResolve, _private } from "../server/jobber-contact-resolver.js";
import { onRequestPost } from "../functions/api/jobber/contact-resolve.js";

const encoded = (model, number) => btoa(`gid://Jobber/${model}/${number}`);
const CLIENT_ID = encoded("Client", 123);
const REQUEST_ID = encoded("Request", 456);
const ACCOUNTS = [
  [encoded("Account", 2498432), "ut", "utah"],
  [encoded("Account", 2498453), "mo_stl", "stl"],
  [encoded("Account", 1919824), "mo_kc", "kc"],
];
const SECRET = "test-contact-broker-secret";
const ENV = { CONTACT_SYNC_BROKER_SECRET: SECRET, ANGI_ROUTER_DB: { prepare() { throw Error("unexpected database access"); } } };

function client(overrides = {}) {
  return {
    id: CLIENT_ID, firstName: "Test", lastName: "Customer", companyName: null,
    isCompany: false, updatedAt: "2026-09-07T23:00:00Z",
    phones: [{ id: encoded("ClientPhoneNumber", 1), number: "8165550101", normalizedPhoneNumber: "+18165550101", primary: true, description: "Main", smsAllowed: false }],
    emails: [{ id: encoded("Email", 2), address: "test@example.com", primary: true, description: "Main" }],
    ...overrides,
  };
}

function input(overrides = {}) {
  return { account_id: ACCOUNTS[0][0], topic: "CLIENT_CREATE", item_id: CLIENT_ID, ...overrides };
}

function context(body = input(), { secret = SECRET, env = ENV, method = "POST", headers = {} } = {}) {
  return {
    env,
    request: new Request("https://goodattic.energy/api/jobber/contact-resolve", {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...headers },
      ...(method !== "GET" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    }),
  };
}

function fakeDependencies(data, calls = []) {
  return {
    async refreshJobberAccessToken(env, route) {
      calls.push({ operation: "token", env, route });
      return { accessToken: "test-access-never-exposed" };
    },
    async jobberGraphql(env, token, query, variables) {
      calls.push({ operation: "query", env, token, query, variables });
      return { data };
    },
  };
}

for (const [accountId, market, authKey] of ACCOUNTS) {
  test(`resolves ${market} clients through the existing website token authority`, async () => {
    const calls = [];
    const c = client();
    const result = await handleJobberContactResolve(
      context(input({ account_id: accountId })),
      fakeDependencies({ account: { id: accountId }, client: c }, calls),
    );
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await result.json(), { ok: true, account_id: accountId, market_key: market, client: c });
    assert.equal(calls[0].route.authAccountKey, authKey);
    assert.equal(calls[0].route.sourceKey, "website");
    assert.deepEqual(calls[1].variables, { id: CLIENT_ID });
    assert.match(calls[1].query, /account \{ id \}/);
    assert.match(calls[1].query, /client\(id: \$id\)/);
    assert.doesNotMatch(calls[1].query, /mutation|messages|notes/);
  });
}

test("Request create and update resolve the Request's authoritative client", async () => {
  for (const topic of ["REQUEST_CREATE", "REQUEST_UPDATE"]) {
    const calls = [];
    const c = client({ firstName: "", lastName: "", companyName: "Test Company", isCompany: true, phones: [], emails: [] });
    const result = await handleJobberContactResolve(
      context(input({ topic, item_id: REQUEST_ID })),
      fakeDependencies({ account: { id: ACCOUNTS[0][0] }, request: { id: REQUEST_ID, client: c } }, calls),
    );
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).client, c);
    assert.deepEqual(calls[1].variables, { id: REQUEST_ID });
    assert.match(calls[1].query, /request\(id: \$id\)/);
  }
});

test("client update retains nullable values and preserves all phone/email rows", async () => {
  const c = client();
  c.phones.push({ ...c.phones[0], id: encoded("ClientPhoneNumber", 2), number: "extension 42", normalizedPhoneNumber: null, primary: false });
  c.emails.push({ ...c.emails[0], id: encoded("Email", 3), address: "second@example.com", primary: false });
  const response = await handleJobberContactResolve(context(input({ topic: "CLIENT_UPDATE" })), fakeDependencies({ account: { id: ACCOUNTS[0][0] }, client: c }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).client, c);
});

test("missing, incorrect, and oversized authorization cannot reach the token owner", async () => {
  const calls = [];
  for (const options of [{ secret: "wrong" }, { secret: "" }, { secret: "x".repeat(1300) }, { env: { ...ENV, CONTACT_SYNC_BROKER_SECRET: "" } }]) {
    const result = await handleJobberContactResolve(context(input(), options), fakeDependencies({}, calls));
    assert.equal(result.status, 401);
  }
  assert.equal(calls.length, 0);
});

test("unknown accounts, topics and mismatched encoded object types fail before token access", async () => {
  const calls = [];
  const invalid = [
    input({ account_id: encoded("Account", 99) }),
    input({ topic: "CLIENT_DESTROY" }),
    input({ topic: "client_create" }),
    input({ item_id: REQUEST_ID }),
    input({ topic: "REQUEST_UPDATE", item_id: CLIENT_ID }),
    input({ item_id: "123" }),
    input({ item_id: encoded("Client", 0) }),
    input({ item_id: `${CLIENT_ID}\n` }),
    input({ item_id: `${CLIENT_ID}=` }),
    input({ query: "mutation arbitraryOperation" }),
    null, [], 123,
  ];
  for (const body of invalid) {
    const result = await handleJobberContactResolve(context(body), fakeDependencies({}, calls));
    assert.equal(result.status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test("canonical unpadded Jobber IDs resolve to the same account and object", async () => {
  const response = await handleJobberContactResolve(context(input({
    account_id: ACCOUNTS[0][0].replace(/=+$/, ""),
    item_id: CLIENT_ID.replace(/=+$/, ""),
  })), fakeDependencies({ account: { id: ACCOUNTS[0][0].replace(/=+$/, "") }, client: client({ id: CLIENT_ID.replace(/=+$/, "") }) }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.account_id, ACCOUNTS[0][0]);
  assert.equal(body.client.id, CLIENT_ID);
});

test("body and method checks reject malformed or oversized requests without reads", async () => {
  const calls = [];
  for (const [ctx, status] of [
    [context("{broken"), 400],
    [context("é".repeat(_private.MAX_BODY_BYTES)), 413],
    [context(input(), { headers: { "Content-Length": String(_private.MAX_BODY_BYTES + 1) } }), 413],
    [context(input(), { method: "GET" }), 405],
  ]) {
    const response = await handleJobberContactResolve(ctx, fakeDependencies({}, calls));
    assert.equal(response.status, status);
  }
  assert.equal(calls.length, 0);
});

test("missing authoritative D1 never falls back to a second refresh-token store", async () => {
  const calls = [];
  const response = await handleJobberContactResolve(context(input(), { env: { CONTACT_SYNC_BROKER_SECRET: SECRET } }), fakeDependencies({}, calls));
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});

test("wrong-account credentials cannot leak a contact to another market", async () => {
  const response = await handleJobberContactResolve(context(), fakeDependencies({ account: { id: ACCOUNTS[1][0] }, client: client() }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { ok: false, code: "jobber_account_mismatch" });
});

test("missing or different objects are errors, never an empty successful contact", async () => {
  for (const [data, status, body] of [
    [{ account: { id: ACCOUNTS[0][0] }, client: null }, 404, input()],
    [{ account: { id: ACCOUNTS[0][0] }, client: client({ id: encoded("Client", 999) }) }, 409, input()],
    [{ account: { id: ACCOUNTS[0][0] }, request: { id: encoded("Request", 999), client: client() } }, 409, input({ topic: "REQUEST_CREATE", item_id: REQUEST_ID })],
    [{ account: { id: ACCOUNTS[0][0] }, request: { id: REQUEST_ID, client: null } }, 502, input({ topic: "REQUEST_CREATE", item_id: REQUEST_ID })],
    [{ client: client() }, 502, input()],
  ]) {
    const response = await handleJobberContactResolve(context(body), fakeDependencies(data));
    assert.equal(response.status, status);
    assert.equal("client" in await response.json(), false);
  }
});

test("incomplete provider payloads cannot erase good downstream contact fields", async () => {
  for (const c of [
    client({ emails: undefined }), client({ phones: null }), client({ firstName: null }),
    client({ updatedAt: "bad-date" }), client({ isCompany: "false" }),
    client({ phones: [{ number: "8165550101" }] }), client({ emails: [{ address: "test@example.com" }] }),
  ]) {
    const response = await handleJobberContactResolve(context(), fakeDependencies({ account: { id: ACCOUNTS[0][0] }, client: c }));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { ok: false, code: "jobber_response_invalid" });
  }
});

test("provider errors, OAuth details and unexpected fields are never returned", async () => {
  for (const operation of ["refreshJobberAccessToken", "jobberGraphql"]) {
    const dependencies = fakeDependencies({});
    dependencies[operation] = async () => { throw Object.assign(Error("secret-token customer@example.com"), { status: 401, details: { access_token: "secret" } }); };
    const response = await handleJobberContactResolve(context(), dependencies);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, code: "jobber_resolve_failed" });
  }
  const c = client({ access_token: "secret", unrelated_notes: "private" });
  const response = await handleJobberContactResolve(context(), fakeDependencies({ account: { id: ACCOUNTS[0][0] }, client: c }));
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal("access_token" in body.client, false);
  assert.equal("unrelated_notes" in body.client, false);
});

test("the deployed Pages wrapper uses the existing cached token helper and only one GraphQL read", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const database = {
    prepare(sql) {
      assert.match(sql, /jobber_token_authority:select_auth/);
      return { bind(accountKey) {
        assert.equal(accountKey, "kc");
        return { async first() { return { access_token: "fake-cached-token", access_expires_at: Date.now() + 3600000, refresh_status: "ready" }; } };
      } };
    },
  };
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      assert.equal(url, "https://api.getjobber.com/api/graphql");
      assert.equal(options.headers.Authorization, "bearer fake-cached-token");
      return Response.json({ data: { account: { id: ACCOUNTS[2][0] }, client: client() } });
    };
    const response = await onRequestPost(context(input({ account_id: ACCOUNTS[2][0] }), { env: { CONTACT_SYNC_BROKER_SECRET: SECRET, ANGI_ROUTER_DB: database } }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal((await response.json()).market_key, "mo_kc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a proven new-client placeholder is returned as unknown so an existing Quo real name stays protected',async()=>{
 const c=client({firstName:'New lead',lastName:''});
 const proof={account_id:ACCOUNTS[0][0],client_id:CLIENT_ID,operation_kind:'intake',classification:'eligible_new_client',source_json:JSON.stringify({type:'call',id:'CAnew'})};
 const proofEnv={...ENV,ANGI_ROUTER_DB:{prepare(sql){assert.match(sql,/classification = 'eligible_new_client'/);return {bind(account,id){assert.equal(account,ACCOUNTS[0][0]);assert.equal(id,CLIENT_ID);return {all:async()=>({success:true,results:[proof]})};}};}}};
 const response=await handleJobberContactResolve(context(input(),{env:proofEnv}),fakeDependencies({account:{id:ACCOUNTS[0][0]},client:c}));
 assert.equal(response.status,200);const returned=(await response.json()).client;
 assert.equal(returned.firstName,'');assert.equal(returned.lastName,'');assert.deepEqual(returned.phones,c.phones);assert.deepEqual(returned.emails,c.emails);
 const edited=client({firstName:'Susan',lastName:'Customer'});
 const editedResponse=await handleJobberContactResolve(context(input(),{env:proofEnv}),fakeDependencies({account:{id:ACCOUNTS[0][0]},client:edited}));
 assert.equal((await editedResponse.json()).client.firstName,'Susan');
});
