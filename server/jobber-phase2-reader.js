import { JOBBER_READ_QUERIES } from "./google-ads-outcome-watcher.js";

const JOBBER_API_URL = "https://api.getjobber.com/api/graphql";
const LIST_QUERIES = Object.freeze({
  request: `query Phase2Requests($after: String) { requests(first: 100, after: $after) { nodes { id updatedAt client { id } assessment { id createdAt startAt endAt } quotes(first: 50) { nodes { id quoteStatus amounts { total } updatedAt } } jobs(first: 50) { nodes { id jobStatus total invoicedTotal updatedAt quote { id } } } } pageInfo { hasNextPage endCursor } } }`,
  quote: `query Phase2Quotes($after: String) { quotes(first: 100, after: $after) { nodes { id quoteStatus createdAt updatedAt amounts { total } request { id } client { id } jobs(first: 50) { nodes { id } } } pageInfo { hasNextPage endCursor } } }`,
  job: `query Phase2Jobs($after: String) { jobs(first: 100, after: $after) { nodes { id jobStatus startAt endAt total invoicedTotal updatedAt request { id } quote { id } client { id } invoices(first: 50) { nodes { id invoiceStatus amounts { total } updatedAt } } } pageInfo { hasNextPage endCursor } } }`,
  invoice: `query Phase2Invoices($after: String) { invoices(first: 100, after: $after) { nodes { id invoiceStatus issuedDate updatedAt amounts { total } jobs(first: 50) { nodes { id request { id } } } } pageInfo { hasNextPage endCursor } } }`,
});

const clean = value => typeof value === "string" ? value.trim() : "";

export function createJobberPhase2Reader({ tokenForMarket, fetchImpl = globalThis.fetch, apiUrl = JOBBER_API_URL } = {}) {
  if (typeof tokenForMarket !== "function") throw new Error("jobber_phase2_token_provider_missing");
  if (typeof fetchImpl !== "function") throw new Error("jobber_phase2_fetch_unavailable");

  async function graphql(market_key, query, variables = {}) {
    const token = clean(await tokenForMarket(market_key));
    if (!token) throw Object.assign(new Error("jobber_access_token_missing"), { code: "jobber_access_token_missing" });
    const response = await fetchImpl(apiUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (response.status === 401) throw Object.assign(new Error("jobber_unauthorized"), { code: "jobber_unauthorized", status: 401 });
    if (!response.ok) throw Object.assign(new Error("jobber_graphql_http_error"), { code: "jobber_graphql_http_error", status: response.status, retryable: response.status >= 500 || response.status === 429 });
    const body = await response.json();
    if (body?.errors?.length) throw Object.assign(new Error("jobber_graphql_error"), { code: "jobber_graphql_error", details: body.errors.map(error => clean(error.message).slice(0, 200)) });
    return body?.data || {};
  }

  return {
    async readObject({ market_key, objectType = "request", id, request_id } = {}) {
      const type = objectType === "request" || request_id ? "request" : objectType;
      const query = JOBBER_READ_QUERIES[type];
      if (!query) throw new Error("jobber_phase2_object_type_unsupported");
      const objectId = id || request_id;
      if (!objectId) throw new Error("jobber_phase2_object_id_missing");
      const root = (await graphql(market_key, query, { id: objectId }))[type];
      if (!root) return null;
      return type === "request" ? { ...root, jobber_request_id: root.id, jobber_client_id: root.client?.id || null, quotes: root.quotes?.nodes || [], jobs: root.jobs?.nodes || [] } : { ...root, jobber_request_id: root.request?.id || root.jobs?.nodes?.[0]?.request?.id || null, quotes: type === "quote" ? [root] : [], jobs: type === "job" ? [root] : [], invoice: type === "invoice" ? root : undefined };
    },
    async listObjects({ market_key, objectType = "request", since } = {}) {
      const query = LIST_QUERIES[objectType];
      if (!query) throw new Error("jobber_phase2_object_type_unsupported");
      const ids = [];
      let after = null;
      do {
        const connection = (await graphql(market_key, query, { after }))[`${objectType}s`];
        for (const node of connection?.nodes || []) {
          const updated = Date.parse(node.updatedAt || node.createdAt || node.issuedDate || "");
          if (!since || !Number.isFinite(updated) || updated >= Date.parse(since)) ids.push(node.id);
        }
        after = connection?.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
      } while (after);
      return ids;
    },
  };
}

export { JOBBER_API_URL, LIST_QUERIES };
