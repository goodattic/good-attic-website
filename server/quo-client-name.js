import { canonicalJobberId } from './acknowledgement-source.js';

export const QUO_UNKNOWN_CLIENT_NAME = 'New lead';

// Preserve the distinction between a system placeholder and a person's name.
// Normal/manual clients take no extra database read. The creation operation,
// not an editable Jobber source label or note, proves placeholder ownership.
export async function resolveQuoClientFirstName(env, accountId, client) {
  if (client?.firstName !== QUO_UNKNOWN_CLIENT_NAME || typeof client.lastName !== 'string'
    || client.lastName.trim()) return client.firstName;
  const canonicalAccount = canonicalJobberId(accountId, 'Account');
  const clientId = canonicalJobberId(client.id, 'Client');
  if (!canonicalAccount || !clientId || !env.ANGI_ROUTER_DB?.prepare) throw new Error('quo_client_name_proof_unavailable');
  const result = await env.ANGI_ROUTER_DB.prepare(`SELECT operation_kind, classification,
    account_id, client_id, source_json FROM quo_intake_operations
    WHERE account_id = ? AND client_id = ? AND operation_kind = 'intake'
      AND classification = 'eligible_new_client' LIMIT 2`).bind(canonicalAccount, clientId).all();
  if (result?.success === false || !Array.isArray(result?.results)) throw new Error('quo_client_name_proof_unavailable');
  for (const row of result.results) {
    if (row.operation_kind !== 'intake' || row.classification !== 'eligible_new_client'
      || row.account_id !== canonicalAccount || canonicalJobberId(row.client_id, 'Client') !== clientId) continue;
    let source;
    try { source = JSON.parse(row.source_json); } catch { throw new Error('quo_client_name_proof_invalid'); }
    if (!source || !['call', 'message'].includes(source.type)) continue;
    // Quo contact names are supplied only when their canonical contact was read.
    // A missing or blank pair means this create intentionally used a placeholder.
    const names = [source.first_name, source.last_name];
    if (names.some(value => value != null && typeof value !== 'string')) continue;
    if (names.some(value => typeof value === 'string' && value.trim())) continue;
    return '';
  }
  return client.firstName;
}
