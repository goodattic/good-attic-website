import { _private as angiRouter } from "./angi-utah.js";

export async function onRequestGet({ request, env }) {
  try {
    angiRouter.requireRouterAuth(request, env);
  } catch (error) {
    return angiRouter.errorResponse(
      cleanErrorCode(error?.code),
      Number(error?.status) || 401,
      Boolean(error?.retryable),
    );
  }

  try {
    const database = angiRouter.getDatabase(env);
    const [summary, needsReview] = await Promise.all([
      angiRouter.getStatusSummary(database),
      angiRouter.getReviewItems(database),
    ]);
    return angiRouter.jsonResponse({
      ok: true,
      status: "visible",
      summary,
      needs_review: needsReview,
    });
  } catch {
    return angiRouter.errorResponse("status_unavailable", 503, true);
  }
}

function cleanErrorCode(value) {
  if (typeof value !== "string" || !/^[a-z0-9_]{1,80}$/.test(value)) {
    return "unauthorized";
  }
  return value;
}
