import { canonicalJobberId, normalizeAcknowledgementPhone } from './acknowledgement-source.js';

export const QUO_UNKNOWN_CLIENT_NAME = 'New lead';

function namelessSource(value) {
  if (!value || !['call', 'message'].includes(value.type)) return false;
  return [value.first_name, value.last_name].every(name => name == null || (typeof name === 'string' && !name.trim()));
}

// Preserve the distinction between a system placeholder and a person's name.
// Ordinary personal names take no extra database read. The creation operation,
// not an editable Jobber source label or note, proves placeholder ownership.
export async function resolveQuoClientFirstName(env, accountId, client) {
  if (typeof client?.lastName !== 'string') return client?.firstName;
  const phone = normalizeAcknowledgementPhone(client?.firstName);
  const phonePlaceholder = phone !== null && client.firstName === phone;
  const legacyPlaceholder = client?.firstName === QUO_UNKNOWN_CLIENT_NAME && !client.lastName?.trim();
  if (!phonePlaceholder && !legacyPlaceholder) return client.firstName;
  const canonicalAccount = canonicalJobberId(accountId, 'Account');
  const clientId = canonicalJobberId(client.id, 'Client');
  if (!canonicalAccount || !clientId || !env.ANGI_ROUTER_DB?.prepare) throw new Error('quo_client_name_proof_unavailable');
  const result = await env.ANGI_ROUTER_DB.prepare(`SELECT operation_kind, classification,
    account_id, client_id, phone, source_json FROM quo_intake_operations
    WHERE account_id = ? AND client_id = ? AND operation_kind = 'intake'
      AND classification = 'eligible_new_client' LIMIT 2`).bind(canonicalAccount, clientId).all();
  if (result?.success === false || !Array.isArray(result?.results)) throw new Error('quo_client_name_proof_unavailable');
  for (const row of result.results) {
    if (row.operation_kind !== 'intake' || row.classification !== 'eligible_new_client'
      || row.account_id !== canonicalAccount || canonicalJobberId(row.client_id, 'Client') !== clientId) continue;
    let source;
    try { source = JSON.parse(row.source_json); } catch { throw new Error('quo_client_name_proof_invalid'); }
    if (!namelessSource(source)) continue;
    // Quo contact names are supplied only when their canonical contact was read.
    // A missing or blank pair means this create intentionally used a placeholder.
    if (legacyPlaceholder || (source.type === 'call' && source.from === phone && row.phone === phone)) return '';
  }
  if (phonePlaceholder) {
    // CLIENT_CREATE may arrive before the completed create's ID is saved. Wait
    // for that specific account/phone operation to settle instead of importing
    // the generated phone as a person's name. This is not proof of ownership.
    const pending = await env.ANGI_ROUTER_DB.prepare(`SELECT operation_kind, classification,
      account_id, client_id, phone, operation_state, source_json FROM quo_intake_operations
      WHERE account_id = ? AND phone = ? AND operation_kind = 'intake'
        AND classification = 'eligible_new_client' AND operation_state = 'client_creating'
        AND client_id IS NULL LIMIT 2`).bind(canonicalAccount, phone).all();
    if (pending?.success === false || !Array.isArray(pending?.results)) throw new Error('quo_client_name_proof_unavailable');
    for (const row of pending.results) {
      if (row.account_id !== canonicalAccount || row.phone !== phone || row.client_id !== null
        || row.operation_kind !== 'intake' || row.classification !== 'eligible_new_client'
        || row.operation_state !== 'client_creating') continue;
      let source;
      try { source = JSON.parse(row.source_json); } catch { throw new Error('quo_client_name_proof_invalid'); }
      if (source?.type === 'call' && source.from === phone && namelessSource(source)) throw new Error('quo_client_name_proof_pending');
    }
  }
  return client.firstName;
}
