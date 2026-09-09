import { readFileSync } from "node:fs";

export const assetDelivery = JSON.parse(readFileSync(new URL("./asset-delivery-manifest.json", import.meta.url), "utf8"));
const updatedPages = new Set(assetDelivery.htmlReferenceChangesOnly);

export function pageAssets(file) {
  const versioned = updatedPages.has(file.replace(/^\//, ""));
  return {
    css: versioned ? assetDelivery.css.to : assetDelivery.css.from,
    js: versioned ? assetDelivery.js.to : assetDelivery.js.from,
  };
}
