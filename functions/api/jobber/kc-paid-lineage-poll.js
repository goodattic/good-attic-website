import { pollKcPaidLineage } from "../../../server/kc-paid-lineage-poller.js";

async function authorized(request, secret) {
  const provided = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!secret || !provided) return false;
  const encoder = new TextEncoder();
  const [expected, actual] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(secret)),
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
  ]);
  const left = new Uint8Array(expected);
  const right = new Uint8Array(actual);
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left[index] ^ right[index];
  return different === 0;
}

function json(body, status) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
  if (!await authorized(request, env.JOBBER_QUOTE_BROKER_SECRET)) {
    return json({ ok: false, code: "unauthorized" }, 401);
  }
  try {
    const result = await pollKcPaidLineage(env);
    return json(result, result.ok ? 200 : 503);
  } catch {
    return json({ ok: false, code: "lineage_poll_failed" }, 503);
  }
}
