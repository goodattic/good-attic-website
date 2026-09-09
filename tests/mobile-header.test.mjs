import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const script = await readFile(new URL("../script.79eca18f8a153d62.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../styles.72e38ccd660523f9.css", import.meta.url), "utf8");
const start = script.indexOf("function enhanceMobileHeader() {");
const end = script.indexOf("\nenhanceMobileHeader();", start);
const enhancement = script.slice(start, end);

test("mobile quote trigger is created before existing modal handlers are registered", () => {
  assert.ok(start >= 0 && end > start);
  assert.match(enhancement, /quote\.type = "button"/);
  assert.match(enhancement, /quote\.textContent = "Get Quote"/);
  assert.match(enhancement, /quote\.setAttribute\("data-open-modal", ""\)/);
  assert.ok(end < script.indexOf('document.querySelectorAll("[data-open-modal]").forEach'));
  assert.match(enhancement, /actions\.querySelector\("\.mobile-quote-button"\)/);
});

test("mobile phone presentation preserves existing number nodes and call-text link listeners", () => {
  assert.match(enhancement, /number\.append\(\.\.\.toggle\.childNodes\)/);
  assert.match(enhancement, /menu\.prepend\(number\)/);
  assert.match(enhancement, /"aria-label", "Call or text Good Attic"/);
  assert.match(enhancement, /"aria-controls", menu\.id/);
  assert.match(enhancement, /event\.key !== "Escape"/);
  assert.match(enhancement, /toggle\.focus\(\)/);
  assert.doesNotMatch(enhancement, /innerHTML|cloneNode|tel:|sms:|gtag|submit|fetch|setAttribute\("href"/);
});

test("mobile header styling uses a local licensed phone icon and hides the extra quote on desktop", async () => {
  const icon = await readFile(new URL("../assets/icons/phone.svg", import.meta.url), "utf8");
  assert.match(icon, /Lucide phone icon/);
  assert.match(icon, /ISC License/);
  assert.match(styles, /\.mobile-quote-button\s*\{\s*display: none;/);
  assert.match(styles, /\.mobile-phone-button--icon\s*\{\s*width: 44px;/);
  assert.match(styles, /assets\/icons\/phone\.svg/);
  assert.match(styles, /\.mobile-phone-number\s*\{[^}]*color: var\(--white\)/);
});
