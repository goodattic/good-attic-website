const legacyRedirects = new Map([
  ["/st-louis", "https://goodattic.energy/st-louis-mo/"],
  ["/salt-lake-city", "https://goodattic.energy/salt-lake-city-ut/"],
  ["/kansas-city", "https://goodattic.energy/kansas-city-mo/"],
  ["/about-us", "https://goodattic.energy/about/"],
  ["/faqs", "https://goodattic.energy/resources/"],
  ["/get-a-quote", "https://goodattic.energy/contact/"],
  ["/thank-you", "https://goodattic.energy/contact/"],
  ["/blog", "https://goodattic.energy/resources/"],
  ["/post/blown-insulation-vs-rolled-attic-unsulation", "https://goodattic.energy/resources/blown-insulation-vs-rolled-insulation/"],
  ["/post/spray-foam-vs-blow-in-insulation", "https://goodattic.energy/resources/spray-foam-vs-blown-in-attic-insulation/"],
  ["/post/how-long-does-a-radiant-barrier-last", "https://goodattic.energy/resources/radiant-barrier-vs-attic-insulation/"],
  ["/post/radiant-barrier-myths", "https://goodattic.energy/resources/radiant-barrier-vs-attic-insulation/"],
  ["/post/should-attic-vents-be-closed-in-winter", "https://goodattic.energy/resources/attic-fan-vs-ventilation-fix/"],
  ["/post/how-much-attic-ventilation-do-you-need", "https://goodattic.energy/resources/attic-fan-vs-ventilation-fix/"],
  ["/post/minimizing-your-attic-dust-accumulation", "https://goodattic.energy/resources/attic-air-sealing-vs-more-insulation/"],
  ["/post/is-air-sealing-an-attic-worth-it", "https://goodattic.energy/resources/attic-air-sealing-vs-more-insulation/"],
  ["/post/how-to-tell-if-your-attic-has-mold", "https://goodattic.energy/resources/when-attic-cleanup-becomes-restoration/"],
  ["/post/how-often-should-you-replace-your-attic-insulation", "https://goodattic.energy/resources/insulation-removal-vs-top-off/"],
  ["/post/faced-vs-unfaced-insulation", "https://goodattic.energy/resources/what-r-value-means-for-an-attic/"],
  ["/post/how-to-insulate-an-attic-hatch", "https://goodattic.energy/resources/attic-air-sealing-vs-more-insulation/"],
  ["/attic-sanitation-services", "https://goodattic.energy/resources/when-attic-cleanup-becomes-restoration/"],
  ["/services/attic-restoration", "https://goodattic.energy/resources/when-attic-cleanup-becomes-restoration/"],
  ["/phoenix/solar-attic-fans", "https://goodattic.energy/services/attic-fans/"],
  ["/st-louis/attic-insulation-remove", "https://goodattic.energy/st-louis-mo/insulation-removal/"],
  ["/salt-lake-city/spray-foam-insulation", "https://goodattic.energy/salt-lake-city-ut/attic-insulation/"],
]);

const previewSafeApiPaths = new Set([
  "/api/site-config",
]);

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const legacyTarget = legacyRedirects.get(url.pathname);

  if (
    url.pathname.startsWith("/api/")
    && !previewSafeApiPaths.has(url.pathname)
    && context.env?.EXTERNAL_API_WRITES_ENABLED !== "true"
  ) {
    return new Response(JSON.stringify({
      ok: false,
      status: "external_api_writes_disabled",
    }), {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  if (legacyTarget) {
    return Response.redirect(legacyTarget, 301);
  }

  if (url.pathname.startsWith("/blog-categories/")) {
    return Response.redirect("https://goodattic.energy/resources/", 301);
  }

  if (url.hostname === "www.goodattic.energy") {
    url.hostname = "goodattic.energy";
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
}
