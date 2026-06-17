function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return jsonResponse({ ok: true });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
  }

  const googleMapsBrowserKey =
    typeof env.GOOGLE_MAPS_BROWSER_KEY === "string" ? env.GOOGLE_MAPS_BROWSER_KEY.trim() : "";

  return jsonResponse({
    ok: true,
    googleMapsBrowserKey,
    addressAutocompleteEnabled: Boolean(googleMapsBrowserKey)
  });
}
