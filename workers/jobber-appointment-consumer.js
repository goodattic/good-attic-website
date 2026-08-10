const APPOINTMENT_EVENT_NAME = "jobber.appointment_scheduled.v1";
const PROCESSING_LEASE_MS = 2 * 60 * 1000;
const BASE_RETRY_DELAY_SECONDS = 60;
const MAX_RETRY_DELAY_SECONDS = 60 * 60;
const DEFAULT_APPOINTMENT_CONSUMER_URL = "https://partners.goodattic.energy/api/jobber-appointment-scheduled";

const MARKET_BY_ACCOUNT_ID = new Map([
  ["Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQzMg==", "ut"],
  ["Z2lkOi8vSm9iYmVyL0FjY291bnQvMjQ5ODQ1Mw==", "mo_stl"],
  ["Z2lkOi8vSm9iYmVyL0FjY291bnQvMTkxOTgyNA==", "mo_kc"],
]);

function clean(value, max = 500) {
  if (!["string", "number", "bigint"].includes(typeof value)) return "";
  return String(value).trim().slice(0, max);
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function eventIdFor(message) {
  return `jobber-assessment:${message.account_id}:${message.assessment_id}`;
}

function retryDelaySeconds(message) {
  const attempts = Math.max(1, Math.min(10, Number(message?.attempts) || 1));
  return Math.min(
    MAX_RETRY_DELAY_SECONDS,
    BASE_RETRY_DELAY_SECONDS * (2 ** (attempts - 1)),
  );
}

function retryMessage(message) {
  message.retry({ delaySeconds: retryDelaySeconds(message) });
}

function validQueueMessage(body) {
  const accountId = clean(body?.account_id, 500);
  const assessmentId = clean(body?.assessment_id, 500);
  const marketKey = clean(body?.market_key, 40);
  return body?.schema_version === 1
    && body?.source === "jobber"
    && ["ASSESSMENT_CREATE", "ASSESSMENT_UPDATE"].includes(body?.topic)
    && Boolean(accountId && assessmentId)
    && MARKET_BY_ACCOUNT_ID.get(accountId) === marketKey;
}

async function readLedger(database, eventId) {
  return database
    .prepare(`
      /* jobber_appointment_consumer:select */
      SELECT
        event_id,
        status,
        attempt_count,
        lease_token,
        lease_expires_at,
        last_error_code,
        delivered_at
      FROM jobber_appointment_signals
      WHERE event_id = ?
    `)
    .bind(eventId)
    .first();
}

async function ensureLedger(database, message, eventId) {
  const now = new Date().toISOString();
  return database
    .prepare(`
      /* jobber_appointment_consumer:insert */
      INSERT OR IGNORE INTO jobber_appointment_signals (
        event_id,
        jobber_account_id,
        jobber_assessment_id,
        market_key,
        status,
        attempt_count,
        lease_token,
        lease_expires_at,
        last_error_code,
        created_at,
        updated_at,
        delivered_at
      ) VALUES (?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL, ?, ?, NULL)
    `)
    .bind(
      eventId,
      message.account_id,
      message.assessment_id,
      message.market_key,
      now,
      now,
    )
    .run();
}

async function claimLedger(database, eventId) {
  const now = Date.now();
  const leaseToken = crypto.randomUUID();
  const result = await database
    .prepare(`
      /* jobber_appointment_consumer:claim */
      UPDATE jobber_appointment_signals
      SET
        status = 'processing',
        attempt_count = attempt_count + 1,
        lease_token = ?,
        lease_expires_at = ?,
        last_error_code = NULL,
        updated_at = ?
      WHERE event_id = ?
        AND (
          status IN ('pending', 'not_scheduled', 'failed_retryable')
          OR (
            status = 'processing'
            AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
          )
        )
    `)
    .bind(
      leaseToken,
      now + PROCESSING_LEASE_MS,
      new Date(now).toISOString(),
      eventId,
      now,
    )
    .run();
  return changes(result) === 1 ? leaseToken : null;
}

async function markNotScheduled(database, eventId, leaseToken) {
  return database
    .prepare(`
      /* jobber_appointment_consumer:not_scheduled */
      UPDATE jobber_appointment_signals
      SET
        status = 'not_scheduled',
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error_code = NULL,
        updated_at = ?
      WHERE event_id = ? AND status = 'processing' AND lease_token = ?
    `)
    .bind(new Date().toISOString(), eventId, leaseToken)
    .run();
}

async function markRetryable(database, eventId, leaseToken, errorCode) {
  try {
    await database
      .prepare(`
        /* jobber_appointment_consumer:retryable */
        UPDATE jobber_appointment_signals
        SET
          status = 'failed_retryable',
          lease_token = NULL,
          lease_expires_at = NULL,
          last_error_code = ?,
          updated_at = ?
        WHERE event_id = ? AND status = 'processing' AND lease_token = ?
      `)
      .bind(
        clean(errorCode, 120) || "unknown_failure",
        new Date().toISOString(),
        eventId,
        leaseToken,
      )
      .run();
  } catch {
    // The processing lease expires, making the record reclaimable.
  }
}

async function markManualReview(database, eventId, leaseToken, errorCode) {
  return database
    .prepare(`
      /* jobber_appointment_consumer:manual_review */
      UPDATE jobber_appointment_signals
      SET
        status = 'manual_review',
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error_code = ?,
        updated_at = ?
      WHERE event_id = ? AND status = 'processing' AND lease_token = ?
    `)
    .bind(
      clean(errorCode, 120) || "consumer_rejected_event",
      new Date().toISOString(),
      eventId,
      leaseToken,
    )
    .run();
}

async function markDelivered(database, eventId, leaseToken) {
  const now = new Date().toISOString();
  return database
    .prepare(`
      /* jobber_appointment_consumer:delivered */
      UPDATE jobber_appointment_signals
      SET
        status = 'delivered',
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error_code = NULL,
        delivered_at = ?,
        updated_at = ?
      WHERE event_id = ? AND status = 'processing' AND lease_token = ?
    `)
    .bind(now, now, eventId, leaseToken)
    .run();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function validResolvedSignal(signal, message, eventId) {
  return signal?.event_name === APPOINTMENT_EVENT_NAME
    && signal?.event_id === eventId
    && signal?.route_to_sales_pipeline === true
    && signal?.appointment_type === "assessment"
    && Boolean(clean(signal?.appointment_start_at, 80))
    && Boolean(clean(signal?.appointment_end_at, 80))
    && signal?.jobber_account_id === message.account_id
    && signal?.jobber_assessment_id === message.assessment_id
    && signal?.market_key === message.market_key;
}

async function resolveAppointment(env, message) {
  const resolverUrl = clean(env.JOBBER_APPOINTMENT_RESOLVER_URL, 1000);
  const resolverSecret = clean(env.JOBBER_APPOINTMENT_BROKER_SECRET, 1000);
  if (!resolverUrl || !resolverSecret) {
    throw new Error("resolver_not_configured");
  }

  let response;
  try {
    response = await fetch(resolverUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolverSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_id: message.account_id,
        assessment_id: message.assessment_id,
        market_key: message.market_key,
        occurred_at: message.occurred_at,
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error("resolver_transport_failure");
  }

  const body = await safeJson(response);
  if (!response.ok || !body?.ok) {
    throw new Error(`resolver_http_${response.status || 0}`);
  }
  return body;
}

class ManualReviewError extends Error {
  constructor(code, status) {
    super(code);
    this.name = "ManualReviewError";
    this.status = status;
  }
}

function requiresManualReview(error) {
  return error instanceof ManualReviewError;
}

async function deliverToAppointmentConsumer(env, signal) {
  const destination = clean(
    env.JOBBER_APPOINTMENT_CONSUMER_URL || DEFAULT_APPOINTMENT_CONSUMER_URL,
    2000,
  );
  const consumerSecret = clean(env.JOBBER_APPOINTMENT_CONSUMER_SECRET, 2000);
  if (!destination) throw new Error("consumer_destination_not_configured");
  if (!consumerSecret) throw new Error("consumer_secret_not_configured");

  let response;
  try {
    response = await fetch(destination, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${consumerSecret}`,
        "Content-Type": "application/json",
        "Idempotency-Key": signal.event_id,
        "X-Good-Attic-Event": APPOINTMENT_EVENT_NAME,
      },
      body: JSON.stringify(signal),
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("consumer_transport_failure");
  }

  if (response.status === 200) return;

  const status = Number(response.status) || 0;
  const code = `consumer_http_${status}`;
  if (status === 408 || status === 425 || status === 429 || status >= 500 || status === 0) {
    throw new Error(code);
  }
  throw new ManualReviewError(code, status);
}

async function processMessage(message, env) {
  if (!validQueueMessage(message.body)) {
    console.error("Discarded an invalid Jobber appointment queue message.");
    message.ack();
    return;
  }

  const database = env.APPOINTMENT_DB;
  if (!database || typeof database.prepare !== "function") {
    retryMessage(message);
    return;
  }

  const body = message.body;
  const eventId = eventIdFor(body);
  try {
    await ensureLedger(database, body, eventId);
  } catch {
    retryMessage(message);
    return;
  }

  const existing = await readLedger(database, eventId);
  if (["delivered", "manual_review"].includes(existing?.status)) {
    message.ack();
    return;
  }

  let leaseToken;
  try {
    leaseToken = await claimLedger(database, eventId);
  } catch {
    retryMessage(message);
    return;
  }
  if (!leaseToken) {
    const current = await readLedger(database, eventId);
    if (["delivered", "manual_review"].includes(current?.status)) message.ack();
    else retryMessage(message);
    return;
  }

  try {
    const resolved = await resolveAppointment(env, body);
    if (resolved.status === "not_scheduled") {
      await markNotScheduled(database, eventId, leaseToken);
      message.ack();
      return;
    }
    if (resolved.status !== "scheduled" || !validResolvedSignal(resolved.signal, body, eventId)) {
      throw new Error("resolver_signal_invalid");
    }

    await deliverToAppointmentConsumer(env, resolved.signal);
    const delivered = await markDelivered(database, eventId, leaseToken);
    if (changes(delivered) !== 1) {
      const current = await readLedger(database, eventId);
      if (current?.status !== "delivered") throw new Error("delivery_checkpoint_failed");
    }
    message.ack();
  } catch (error) {
    if (requiresManualReview(error)) {
      try {
        const reviewed = await markManualReview(
          database,
          eventId,
          leaseToken,
          clean(error?.message, 120),
        );
        if (changes(reviewed) !== 1) {
          const current = await readLedger(database, eventId);
          if (!["manual_review", "delivered"].includes(current?.status)) {
            throw new Error("manual_review_checkpoint_failed");
          }
        }
        console.error("Jobber appointment event requires manual review.", {
          event_id: eventId,
          response_status: error.status,
          error_code: clean(error?.message, 120),
        });
        message.ack();
        return;
      } catch {
        await markRetryable(database, eventId, leaseToken, "manual_review_checkpoint_failed");
        retryMessage(message);
        return;
      }
    }
    await markRetryable(database, eventId, leaseToken, clean(error?.message, 120));
    retryMessage(message);
  }
}

export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      await processMessage(message, env);
    }
  },
};

export const _private = {
  APPOINTMENT_EVENT_NAME,
  BASE_RETRY_DELAY_SECONDS,
  DEFAULT_APPOINTMENT_CONSUMER_URL,
  MARKET_BY_ACCOUNT_ID,
  MAX_RETRY_DELAY_SECONDS,
  PROCESSING_LEASE_MS,
  ManualReviewError,
  claimLedger,
  deliverToAppointmentConsumer,
  ensureLedger,
  eventIdFor,
  markDelivered,
  markManualReview,
  markNotScheduled,
  markRetryable,
  processMessage,
  readLedger,
  resolveAppointment,
  retryDelaySeconds,
  retryMessage,
  requiresManualReview,
  validQueueMessage,
  validResolvedSignal,
};
