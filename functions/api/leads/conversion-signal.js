import { markFormConversionSignaled } from "../../../server/website-form-transactions.js";

// Browser evidence that the DA - Submit Lead Form tag was invoked. This does
// not claim that Google accepted or counted the conversion.
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return new Response(null, { status: 400 }); }
  try {
    const signaled = await markFormConversionSignaled(
      env.ANGI_ROUTER_DB,
      body?.submission_id,
      body?.transaction_id,
    );
    return new Response(null, { status: signaled ? 204 : 404 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
