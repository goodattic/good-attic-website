import { _private as angiRouter } from "./angi-utah.js";

export async function onRequestGet({ request, env }) {
  try {
    angiRouter.requireRouterAuth(request, env);
  } catch (error) {
    return angiRouter.errorResponse(
      cleanAuthErrorCode(error?.code),
      Number(error?.status) || 401,
      Boolean(error?.retryable),
    );
  }

  try {
    const database = angiRouter.getDatabase(env);
    const status = await angiRouter.checkUtahJobberAuthorization(env, database);
    if (status === "busy") {
      return angiRouter.errorResponse("busy", 503, true);
    }
    return angiRouter.jsonResponse({ ok: true, status: "verified" });
  } catch {
    return angiRouter.errorResponse("verification_failed", 503, true);
  }
}

function cleanAuthErrorCode(value) {
  if (value === "unauthorized" || value === "router_not_configured") {
    return value;
  }
  return "unauthorized";
}
