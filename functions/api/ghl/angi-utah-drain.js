import { _private as angiRouter } from "./angi-utah.js";

export async function onRequestPost({ request, env }) {
  try {
    angiRouter.requireRouterAccess(request, env);
    if (angiRouter.isBeforeCutover(env)) {
      return angiRouter.jsonResponse({
        ok: true,
        status: "cutover_pending",
        summary: {
          scanned: 0,
          created: 0,
          queued: 0,
          reconciliation_required: 0,
          needs_review: 0,
          cleaned: 0,
          lock_busy: false,
        },
      });
    }
  } catch (error) {
    const status = Number(error?.status) || 401;
    return angiRouter.errorResponse(
      cleanErrorCode(error?.code),
      status,
      Boolean(error?.retryable),
    );
  }

  try {
    const database = angiRouter.getDatabase(env);
    const summary = await angiRouter.drainPendingDeliveries(env, database);
    return angiRouter.jsonResponse({ ok: true, status: "drained", summary });
  } catch {
    return angiRouter.errorResponse("drain_unavailable", 503, true);
  }
}

function cleanErrorCode(value) {
  if (typeof value !== "string" || !/^[a-z0-9_]{1,80}$/.test(value)) {
    return "unauthorized";
  }
  return value;
}
