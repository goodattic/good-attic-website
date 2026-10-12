// The live-site baseline does not include the stage1-shadow model. Keep the
// read-only preview's account check self-contained so moving this module does
// not import or activate the separate stage1 collector.
const MARKETS = Object.freeze({
  ut: { account: "2498432" },
  mo_stl: { account: "2498453" },
  mo_kc: { account: "1919824" },
});

const numericId = id => {
  const raw = String(id || "");
  try {
    const decoded = atob(raw);
    return decoded.startsWith("gid://Jobber/") ? decoded.split("/").pop() : raw;
  } catch {
    return raw;
  }
};

export const FORM_CONVERSION_ACTION = "customers/4800890529/conversionActions/7152833432";

const text = value => typeof value === "string" ? value.trim() : "";
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all())?.results || [];
const first = async (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const sameId = (a, b) => text(a) !== "" && text(a) === text(b);

function tagNames(connection) {
  const nodes = Array.isArray(connection) ? connection
    : Array.isArray(connection?.nodes) ? connection.nodes
      : Array.isArray(connection?.edges) ? connection.edges.map(edge => edge.node)
        : [];
  return nodes.map(node => typeof node === "string" ? node : node?.name || node?.label || node?.text)
    .filter(value => typeof value === "string");
}

// A plain Client tag is safe only when a complete read of that Client's Requests
// proves this is its sole website Request. The target is known to be a website
// Request from the conversion ledger. Other Requests require independently
// verified source evidence; an unknown source cannot be assumed non-website.
function soleWebsiteRequest(clientRequests, requestId) {
  if (!Array.isArray(clientRequests?.nodes) || clientRequests?.pageInfo?.hasNextPage !== false)
    return { valid: false, reason: "jobber_client_requests_incomplete" };
  const seen = new Set();
  let targetSeen = false;
  let websiteCount = 0;
  for (const request of clientRequests.nodes) {
    const id = numericId(request?.id);
    if (!/^\d+$/.test(id) || seen.has(id))
      return { valid: false, reason: "jobber_client_requests_incomplete" };
    seen.add(id);
    if (id === requestId) {
      targetSeen = true;
      websiteCount++;
    } else if (request?.source_verified === true && request?.source === "website_form") {
      websiteCount++;
    } else if (request?.source_verified !== true || request?.source !== "non_website") {
      return { valid: false, reason: "jobber_client_request_source_unverified" };
    }
  }
  if (!targetSeen) return { valid: false, reason: "jobber_client_request_link_mismatch" };
  if (websiteCount !== 1) return { valid: false, reason: "multiple_website_requests_require_specific_tag" };
  return { valid: true, reason: null };
}

// Jobber tags belong to Clients, not Requests. A Request-specific tag works
// without a Client Request scan; a plain tag needs the complete proof above.
export function requestDispositionFromTags(tags, requestId, clientRequests = null) {
  const numericRequestId = numericId(requestId);
  if (!/^\d+$/.test(numericRequestId)) return { marker: null, reason: "request_id_unrecognized" };
  const names = tagNames(tags).map(value => value.trim());
  const matches = names
    .map(value => /^GAE:(JUNK|DUPLICATE):(\d+)$/i.exec(value.trim()))
    .filter(parts => parts && parts[2] === numericRequestId)
    .map(parts => parts[1].toLowerCase());
  const plain = names.map(value => /^GAE:(JUNK|DUPLICATE)$/i.exec(value))
    .filter(Boolean).map(parts => parts[1].toLowerCase());
  const unique = [...new Set([...matches, ...plain])];
  if (unique.length > 1) return { marker: null, reason: "conflicting_disposition_tags" };
  if (matches.length) return { marker: unique[0], reason: null };
  if (!plain.length) return { marker: null, reason: "no_explicit_disposition_tag" };
  const proof = soleWebsiteRequest(clientRequests, numericRequestId);
  return proof.valid ? { marker: unique[0], reason: null } : { marker: null, reason: proof.reason };
}

export function retractionPayload(transactionId, adjustmentAt) {
  const moment = new Date(adjustmentAt);
  if (!text(transactionId) || !Number.isFinite(moment.valueOf())) throw new Error("invalid_retraction_identity_or_time");
  return {
    partialFailure: true,
    conversionAdjustments: [{
      conversionAction: FORM_CONVERSION_ACTION,
      adjustmentType: "RETRACTION",
      orderId: transactionId,
      adjustmentDateTime: moment.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "+00:00"),
    }],
  };
}

// No route, cron, Google transport, or database writer imports this function.
// The caller must supply a read-only Jobber lookup that returns account and
// Request/client IDs plus the Client's complete tag connection. It returns a
// review table only. Browser gtag invocation is evidence, not Google receipt.
export async function previewWebsiteFormRetractions({ database, readJobberEvidence, now = () => new Date().toISOString() } = {}) {
  if (!database?.prepare) throw new Error("website_form_ledger_unavailable");
  const rows = await all(database, "SELECT * FROM website_form_conversions ORDER BY created_at, submission_id");
  const preview = [];
  for (const row of rows) {
    const base = {
      market_key: row.market_key,
      jobber_request_id: row.jobber_request_id || null,
      transaction_id: row.transaction_id,
      conversion_action: FORM_CONVERSION_ACTION,
      marker: null,
      would_retract: false,
      reason: null,
      payload: null,
    };
    const hold = reason => preview.push({ ...base, reason });
    if (row.state !== "completed") { hold("submission_not_completed"); continue; }
    if (!MARKETS[row.market_key]) { hold("market_not_enabled"); continue; }
    if (!row.jobber_request_id || !row.jobber_client_id) { hold("jobber_link_missing"); continue; }
    if (!row.transaction_id || row.transaction_id !== row.submission_id) { hold("transaction_identity_invalid"); continue; }
    if (Number(row.reconciliation_required) === 1) { hold("transaction_reconciliation_required"); continue; }
    if (!Number.isFinite(Date.parse(row.conversion_at || ""))) { hold("conversion_time_missing"); continue; }
    const prior = await first(database, "SELECT state FROM website_form_retraction_outbox WHERE transaction_id=?", row.transaction_id);
    if (prior && prior.state !== "shadow") { hold("retraction_already_claimed"); continue; }
    if (typeof readJobberEvidence !== "function") { hold("jobber_reader_unavailable"); continue; }
    let evidence;
    try { evidence = await readJobberEvidence({ market_key: row.market_key, request_id: row.jobber_request_id, client_id: row.jobber_client_id }); }
    catch { hold("jobber_read_failed"); continue; }
    if (!evidence?.request) { hold("jobber_request_not_found"); continue; }
    if (numericId(evidence.account_id || evidence.account?.id) !== MARKETS[row.market_key].account
      || numericId(row.jobber_account_id) !== MARKETS[row.market_key].account
      || !sameId(evidence.request.id, row.jobber_request_id)
      || !sameId(evidence.request.client?.id, row.jobber_client_id)) {
      hold("jobber_market_or_link_mismatch"); continue;
    }
    const tags = evidence.request.client.tags;
    if (tags?.pageInfo?.hasNextPage !== false) { hold("jobber_tags_incomplete"); continue; }
    const disposition = requestDispositionFromTags(tags, row.jobber_request_id, evidence.request.client.requests);
    if (!disposition.marker) { hold(disposition.reason); continue; }
    if (row.conversion_state !== "client_signaled") { hold("signal_unverified"); continue; }
    const adjustmentAt = now();
    if (Date.parse(adjustmentAt) <= Date.parse(row.conversion_at)) { hold("adjustment_time_not_after_conversion"); continue; }
    preview.push({ ...base, marker: disposition.marker, would_retract: true,
      reason: "browser_signaled_google_acceptance_unverified",
      payload: retractionPayload(row.transaction_id, adjustmentAt) });
  }
  return { mode: "shadow", google_requests: 0, candidates: preview };
}
