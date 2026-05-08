export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (url.hostname === "www.goodattic.energy") {
    url.hostname = "goodattic.energy";
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
}
