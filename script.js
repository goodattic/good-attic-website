const body = document.body;
const modal = document.querySelector("[data-modal]");
const navToggle = document.querySelector("[data-menu-toggle]");
const nav = document.querySelector("[data-nav]");
const dropdown = document.querySelector("[data-dropdown]");
const dropdownToggle = document.querySelector("[data-dropdown-toggle]");
const phoneDropdowns = document.querySelectorAll("[data-phone-dropdown]");
const hotspots = document.querySelectorAll("[data-hotspot]");
const atticMap = document.querySelector(".attic-map");
const processCarousel = document.querySelector("[data-process-carousel]");
const serviceCarousel = document.querySelector("[data-service-carousel]");
const heroServiceCarousel = document.querySelector(".hero-service-carousel");
let modalScrollY = 0;
let leadThankYouModal = null;
let leadThankYouScrollY = 0;
let addressAutocompleteInitPromise = null;

const googleAdsTracking = {
  googleTagId: "AW-10789892066",
  analyticsMeasurementId: "G-P7T219JFV6",
  destinationId: "AW-11103039262",
  leadConversionSendTo: "AW-11103039262/SDRICJin3tIaEJ7eq64p",
  phoneConversionConfigs: [
    {
      sendTo: "AW-11103039262/_4E-CN313tIaEJ7eq64p",
      phoneNumber: "385-336-4442"
    },
    {
      sendTo: "AW-11103039262/-7syCOa6-e0aEJ7eq64p",
      phoneNumber: "314-931-2620"
    },
    {
      sendTo: "AW-11103039262/35RYCNWL7bgcEJ7eq64p",
      phoneNumber: "816-434-0308"
    }
  ],
  attributionStorageKey: "good_attic_ad_attribution",
  firstAttributionStorageKey: "good_attic_first_attribution",
  paidAttributionStorageKey: "good_attic_paid_attribution",
  attributionMaxAgeMs: 90 * 24 * 60 * 60 * 1000
};

const addressAutocompleteConfig = {
  configEndpoint: "/api/site-config",
  callbackName: "__goodAtticInitAddressAutocomplete",
  mapsScriptId: "good-attic-google-maps-places",
  debounceMs: 260,
  minQueryLength: 3,
  maxSuggestions: 5
};

const attributionParamNames = [
  "gclid",
  "gbraid",
  "wbraid",
  "gad_source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_id",
  "utm_term",
  "utm_content"
];
const attributionParamNameSet = new Set(attributionParamNames);
let attributionCaptureEvaluated = false;
let attributionForCurrentDocument = {};

const pageContextRules = [
  {
    market: "ut",
    market_label: "Salt Lake City, UT",
    pattern: /^\/(?:salt-lake-city-ut(?:\/|$)|resources\/[^/]+-salt-lake-city-ut\/?$)/
  },
  {
    market: "mo_stl",
    market_label: "St. Louis, MO",
    pattern: /^\/(?:st-louis-mo(?:\/|$)|resources\/[^/]+-st-louis-mo\/?$)/
  },
  {
    market: "mo_kc",
    market_label: "Kansas City, MO",
    pattern: /^\/(?:kansas-city-mo(?:\/|$)|resources\/[^/]+-kansas-city-mo\/?$)/
  }
];

const marketContactNumbers = {
  general: {
    phoneDisplay: "855-51-ATTIC",
    smsHref: "sms:+18555128842"
  },
  ut: {
    phoneDisplay: "385-336-4442",
    smsHref: "sms:+13853364442"
  },
  mo_stl: {
    phoneDisplay: "314-931-2620",
    smsHref: "sms:+13149312620"
  },
  mo_kc: {
    phoneDisplay: "816-434-0308",
    smsHref: "sms:+18164340308"
  }
};

const addressAutocompleteBiases = {
  ut: {
    south: 39.8,
    west: -112.4,
    north: 41.2,
    east: -110.7
  },
  mo_stl: {
    south: 38.15,
    west: -91.25,
    north: 39.15,
    east: -89.15
  },
  mo_kc: {
    south: 38.45,
    west: -95.2,
    north: 39.65,
    east: -93.75
  }
};

const serviceContextRules = [
  { service_context: "attic_insulation", pattern: /\/attic-insulation\/?$/ },
  { service_context: "insulation_removal", pattern: /\/insulation-removal\/?$/ },
  { service_context: "attic_air_sealing", pattern: /\/attic-air-sealing\/?$/ },
  { service_context: "attic_fans", pattern: /\/attic-fans\/?$/ },
  { service_context: "attic_pest_remediation", pattern: /\/attic-pest-remediation\/?$/ }
];

function getPageContext() {
  const path = window.location.pathname;
  const market = pageContextRules.find((rule) => rule.pattern.test(path));
  const service = serviceContextRules.find((rule) => rule.pattern.test(path));

  return {
    page_path: path,
    page_market: market?.market || "general",
    page_market_label: market?.market_label || "General",
    page_service_context: service?.service_context || "general",
    page_url: window.location.href
  };
}

function getPageMarketContact() {
  const pageMarket = getPageContext().page_market;
  return marketContactNumbers[pageMarket] || marketContactNumbers.general;
}

function ensureGoogleTag() {
  window.dataLayer = window.dataLayer || [];

  if (typeof window.gtag !== "function") {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
  }

  if (!document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${googleAdsTracking.googleTagId}"]`)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${googleAdsTracking.googleTagId}`;
    document.head.appendChild(script);
  }

  if (!window.goodAtticGoogleTagConfigured) {
    window.gtag("js", new Date());
    window.gtag("config", googleAdsTracking.googleTagId);
    window.goodAtticGoogleTagConfigured = true;
  }

  if (!window.goodAtticGa4Configured) {
    window.gtag("config", googleAdsTracking.analyticsMeasurementId);
    window.goodAtticGa4Configured = true;
  }

  if (!window.goodAtticPhoneConversionNumbersConfigured) {
    googleAdsTracking.phoneConversionConfigs.forEach((config) => {
      window.gtag("config", config.sendTo, {
        phone_conversion_number: config.phoneNumber
      });
    });
    window.goodAtticPhoneConversionNumbersConfigured = true;
  }
}

function normalizeAttributionHost(hostname) {
  return String(hostname || "").trim().toLowerCase().replace(/^www\./, "");
}

function getAttributionHost(urlValue) {
  try {
    return normalizeAttributionHost(new URL(urlValue).hostname);
  } catch (error) {
    return "";
  }
}

function isSameAttributionSite(leftHost, rightHost) {
  if (!leftHost || !rightHost) return false;
  return leftHost === rightHost || leftHost.endsWith(`.${rightHost}`) || rightHost.endsWith(`.${leftHost}`);
}

function isExternalAttributionReferrer(referrer) {
  const referrerHost = getAttributionHost(referrer);
  const currentHost = getAttributionHost(window.location.href);
  return Boolean(referrerHost && currentHost && !isSameAttributionSite(referrerHost, currentHost));
}

function isInternalAttributionReferrer(referrer) {
  const referrerHost = getAttributionHost(referrer);
  const currentHost = getAttributionHost(window.location.href);
  return Boolean(referrerHost && currentHost && isSameAttributionSite(referrerHost, currentHost));
}

function getCurrentAttributionParams() {
  const attribution = {};
  const params = new URLSearchParams(window.location.search);

  params.forEach((rawValue, rawName) => {
    const name = rawName.toLowerCase();
    if (!attributionParamNameSet.has(name) || attribution[name]) return;

    const value = rawValue.trim();
    if (value) attribution[name] = value.slice(0, 500);
  });

  return attribution;
}

function hasAttributionParams(attribution) {
  return attributionParamNames.some((name) => Boolean(attribution[name]));
}

function attributionParamsMatch(left, right) {
  return attributionParamNames.every((name) => (left[name] || "") === (right[name] || ""));
}

function sanitizeStoredAttribution(parsed, now = Date.now()) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (typeof parsed.captured_at !== "string") return null;

  const capturedAt = Date.parse(parsed.captured_at);
  const age = now - capturedAt;
  if (!Number.isFinite(capturedAt) || age < 0 || age > googleAdsTracking.attributionMaxAgeMs) return null;

  if (
    typeof parsed.landing_page !== "string" ||
    typeof parsed.landing_page_path !== "string" ||
    typeof parsed.referrer !== "string"
  ) {
    return null;
  }

  const attribution = {
    captured_at: parsed.captured_at,
    landing_page: parsed.landing_page.slice(0, 5000),
    landing_page_path: parsed.landing_page_path.slice(0, 5000),
    referrer: parsed.referrer.slice(0, 5000)
  };

  for (const name of attributionParamNames) {
    if (parsed[name] === undefined) continue;
    if (typeof parsed[name] !== "string") return null;

    const value = parsed[name].trim();
    if (value) attribution[name] = value.slice(0, 500);
  }

  if (!hasAttributionParams(attribution) && !isExternalAttributionReferrer(attribution.referrer)) return null;
  return attribution;
}

function removeStoredAttribution(storageKey = googleAdsTracking.attributionStorageKey) {
  try {
    window.localStorage.removeItem(storageKey);
  } catch (error) {
    // Attribution is useful but should never block the form experience.
  }
}

function readStoredAttribution(storageKey = googleAdsTracking.attributionStorageKey) {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return {};

    const attribution = sanitizeStoredAttribution(JSON.parse(stored));
    if (attribution) return attribution;

    removeStoredAttribution(storageKey);
    return {};
  } catch (error) {
    removeStoredAttribution(storageKey);
    return {};
  }
}

function writeStoredAttribution(storageKey, attribution) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(attribution));
  } catch (error) {
    // Attribution is useful but should never block the form experience.
  }
}

function hasPaidAttributionSignal(attribution) {
  if (["gclid", "gbraid", "wbraid", "gad_source"].some((name) => Boolean(attribution[name]))) {
    return true;
  }

  const source = String(attribution.utm_source || "").trim().toLowerCase();
  const medium = String(attribution.utm_medium || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return source === "google" && ["cpc", "ppc", "paidsearch", "paid-search", "sem"].includes(medium);
}

function isRepeatAttributionNavigation() {
  try {
    const navigationEntry = window.performance?.getEntriesByType?.("navigation")?.[0];
    if (navigationEntry?.type === "reload" || navigationEntry?.type === "back_forward") return true;

    const legacyType = window.performance?.navigation?.type;
    return legacyType === 1 || legacyType === 2;
  } catch (error) {
    return false;
  }
}

function shouldCaptureAttributionTouch(params, referrer, storedAttribution) {
  const hasParams = hasAttributionParams(params);
  const hasExternalReferrer = isExternalAttributionReferrer(referrer);
  if (!hasParams && !hasExternalReferrer) return false;

  // Reloading or restoring the same landing page is not another marketing touch.
  if (isRepeatAttributionNavigation()) return false;

  // A real external referral is a fresh organic, paid, or partner touch even when
  // its campaign values happen to match the previous visit.
  if (hasExternalReferrer) return true;

  // Direct/internal navigation sometimes carries the original query string
  // forward. Keep the original landing page and timestamp in that case.
  if (isInternalAttributionReferrer(referrer) && attributionParamsMatch(params, storedAttribution)) return false;

  // A normal direct entry carrying campaign or click parameters is itself a
  // fresh touch. A same-page submit cannot reach this branch a second time.
  return hasParams;
}

function buildAttributionSnapshot(params, referrer, now = Date.now()) {
  return {
    ...params,
    captured_at: new Date(now).toISOString(),
    landing_page: window.location.href.slice(0, 5000),
    landing_page_path: `${window.location.pathname}${window.location.search}`.slice(0, 5000),
    referrer: String(referrer || "").slice(0, 5000)
  };
}

function captureAttribution() {
  if (attributionCaptureEvaluated) {
    const current = sanitizeStoredAttribution(attributionForCurrentDocument);
    if (current) return current;

    attributionForCurrentDocument = {};
    removeStoredAttribution(googleAdsTracking.attributionStorageKey);
    return attributionForCurrentDocument;
  }

  attributionCaptureEvaluated = true;
  const storedAttribution = readStoredAttribution();
  const params = getCurrentAttributionParams();
  const referrer = document.referrer || "";

  if (!shouldCaptureAttributionTouch(params, referrer, storedAttribution)) {
    attributionForCurrentDocument = storedAttribution;
    return attributionForCurrentDocument;
  }

  attributionForCurrentDocument = buildAttributionSnapshot(params, referrer);

  writeStoredAttribution(googleAdsTracking.attributionStorageKey, attributionForCurrentDocument);

  if (!Object.keys(readStoredAttribution(googleAdsTracking.firstAttributionStorageKey)).length) {
    writeStoredAttribution(googleAdsTracking.firstAttributionStorageKey, attributionForCurrentDocument);
  }

  if (hasPaidAttributionSignal(attributionForCurrentDocument)) {
    writeStoredAttribution(googleAdsTracking.paidAttributionStorageKey, attributionForCurrentDocument);
  }

  return attributionForCurrentDocument;
}

function addStoredTouchToPayload(payload, prefix, attribution) {
  if (!attribution || !Object.keys(attribution).length) return;

  attributionParamNames.forEach((name) => {
    if (attribution[name]) payload[`${prefix}_${name}`] = attribution[name];
  });

  payload[`${prefix}_landing_page`] = attribution.landing_page || "";
  payload[`${prefix}_landing_page_path`] = attribution.landing_page_path || "";
  payload[`${prefix}_referrer`] = attribution.referrer || "";
  payload[`${prefix}_captured_at`] = attribution.captured_at || "";
}

function addAttributionToPayload(payload) {
  const attribution = captureAttribution();
  const pageContext = getPageContext();

  attributionParamNames.forEach((name) => {
    if (attribution[name]) payload[name] = attribution[name];
  });

  payload.ad_landing_page = attribution.landing_page || window.location.href;
  payload.ad_landing_page_path = attribution.landing_page_path || `${window.location.pathname}${window.location.search}`;
  payload.ad_referrer = attribution.referrer || document.referrer || "";
  payload.attribution_captured_at = attribution.captured_at || "";
  addStoredTouchToPayload(
    payload,
    "first_touch",
    readStoredAttribution(googleAdsTracking.firstAttributionStorageKey)
  );
  addStoredTouchToPayload(
    payload,
    "paid_touch",
    readStoredAttribution(googleAdsTracking.paidAttributionStorageKey)
  );
  Object.assign(payload, pageContext);

  return payload;
}

function setEnhancedConversionData(payload) {
  const userData = {};
  const address = {};

  if (payload.email) userData.email = String(payload.email).trim().toLowerCase();
  if (payload.phone) userData.phone_number = String(payload.phone).replace(/[^\d+]/g, "");
  if (payload.first_name) address.first_name = String(payload.first_name).trim();
  if (payload.last_name) address.last_name = String(payload.last_name).trim();
  if (payload.street_address) address.street = String(payload.street_address).trim();
  if (payload.city) address.city = String(payload.city).trim();
  if (payload.state) address.region = String(payload.state).trim();
  if (payload.zip) address.postal_code = String(payload.zip).trim();

  if (Object.keys(address).length) userData.address = address;
  if (Object.keys(userData).length) window.gtag("set", "user_data", userData);
}

function trackLeadConversion(payload) {
  ensureGoogleTag();
  setEnhancedConversionData(payload);

  window.gtag("event", "conversion", {
    send_to: googleAdsTracking.leadConversionSendTo
  });

  window.gtag("event", "generate_lead", {
    send_to: googleAdsTracking.analyticsMeasurementId,
    form_name: payload.form_name || "Good Attic lead form",
    market: payload.page_market || "general",
    service_context: payload.page_service_context || "general",
    self_reported_source: payload.self_reported_source || "not_provided"
  });
}

function trackPhoneClick(link) {
  ensureGoogleTag();

  window.gtag("event", "phone_click", {
    send_to: googleAdsTracking.analyticsMeasurementId,
    event_category: "Phone",
    event_label: link.getAttribute("href") || "",
    page_location: window.location.href,
    page_market: getPageContext().page_market
  });
}

function trackSmsClick(link) {
  ensureGoogleTag();

  window.gtag("event", "sms_click", {
    send_to: googleAdsTracking.analyticsMeasurementId,
    event_category: "SMS",
    event_label: link.getAttribute("href") || "",
    page_location: window.location.href,
    page_market: getPageContext().page_market
  });
}

ensureGoogleTag();
captureAttribution();

document.querySelector("[data-year]").textContent = new Date().getFullYear();

document.querySelectorAll('a[href^="tel:"]').forEach((link) => {
  link.addEventListener("click", () => trackPhoneClick(link));
});

function updateSourcePageFields() {
  document.querySelectorAll("[data-source-page]").forEach((input) => {
    input.value = window.location.href;
  });
}

function enableFullDatePickerTrigger() {
  document.querySelectorAll('input[type="date"]').forEach((input) => {
    const openPicker = (event) => {
      if (input.disabled || input.readOnly || typeof input.showPicker !== "function") return;

      input.focus({ preventScroll: true });

      try {
        input.showPicker();
      } catch (error) {
        // Some browsers restrict picker access in edge cases; native focus still helps.
      }
    };

    input.addEventListener("click", openPicker);
  });
}

updateSourcePageFields();
enableFullDatePickerTrigger();

if (window.history && "scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

window.addEventListener("load", () => {
  if (window.location.hash) {
    const cleanUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", cleanUrl);
  }
  updateSourcePageFields();
  window.scrollTo(0, 0);
});

function closePhoneDropdowns(exceptDropdown) {
  phoneDropdowns.forEach((phoneDropdown) => {
    if (phoneDropdown === exceptDropdown) return;
    phoneDropdown.classList.remove("is-open");
    const toggle = phoneDropdown.querySelector("[data-phone-dropdown-toggle]");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  });
}

function updateHotspotHint() {
  if (!atticMap) return;
  const hasActiveHotspot = Array.from(hotspots).some((hotspot) => hotspot.classList.contains("is-active"));
  atticMap.classList.toggle("has-active-hotspot", hasActiveHotspot);
}

function getModalScrollContainer() {
  if (!modal) return null;
  const content = modal.querySelector(".modal-content");
  const form = modal.querySelector(".modal-form.contact-form");

  if (window.matchMedia("(max-width: 760px)").matches) return content;
  return form || content;
}

function updateModalProgress() {
  if (!modal || !modal.classList.contains("is-open")) return;

  const bar = modal.querySelector("[data-modal-progress]");
  const fill = bar ? bar.querySelector("span") : null;
  const form = modal.querySelector(".modal-form.contact-form");
  const scrollContainer = getModalScrollContainer();

  if (!fill || !form || !scrollContainer) return;

  const sections = [
    form.querySelector(".project-picker"),
    ...Array.from(form.querySelectorAll(".form-section-title")).slice(0, 3)
  ].filter(Boolean);

  if (!sections.length) return;

  const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
  const isAtBottom = maxScroll <= 0 || scrollContainer.scrollTop >= maxScroll - 10;

  let progress = 0.25;
  const containerTop = scrollContainer.getBoundingClientRect().top;
  const readingLine = scrollContainer.scrollTop + scrollContainer.clientHeight * 0.24;

  sections.forEach((section, index) => {
    const sectionTop = section.getBoundingClientRect().top - containerTop + scrollContainer.scrollTop;
    if (readingLine >= sectionTop) {
      progress = (index + 1) / sections.length;
    }
  });

  if (isAtBottom) progress = 1;

  fill.style.setProperty("--modal-progress", String(Math.min(1, Math.max(0.25, progress))));
}

function openModal() {
  body.classList.remove("nav-open");
  navToggle.setAttribute("aria-expanded", "false");
  modalScrollY = window.scrollY || window.pageYOffset || 0;
  body.style.setProperty("--modal-scroll-lock-top", `-${modalScrollY}px`);
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  body.classList.add("modal-open");

  const scrollContainer = getModalScrollContainer();
  if (scrollContainer) scrollContainer.scrollTop = 0;
  requestAnimationFrame(updateModalProgress);
}

function closeModal() {
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  body.classList.remove("modal-open");
  body.style.removeProperty("--modal-scroll-lock-top");
  window.scrollTo(0, modalScrollY);
}

function getLeadThankYouModal() {
  if (leadThankYouModal) return leadThankYouModal;

  leadThankYouModal = document.createElement("div");
  leadThankYouModal.className = "modal thank-you-modal";
  leadThankYouModal.setAttribute("aria-hidden", "true");
  leadThankYouModal.setAttribute("data-lead-thank-you-modal", "");
  leadThankYouModal.innerHTML = `
    <div class="modal-backdrop thank-you-modal__backdrop" data-close-lead-thank-you></div>
    <div class="thank-you-modal__panel" role="dialog" aria-modal="true" aria-labelledby="lead-thank-you-title" aria-describedby="lead-thank-you-description">
      <button class="modal-close thank-you-modal__close" type="button" aria-label="Close thank you message" data-close-lead-thank-you>&times;</button>
      <div class="thank-you-modal__mark" aria-hidden="true"></div>
      <p class="eyebrow">Request received</p>
      <h2 id="lead-thank-you-title">Thank you.</h2>
      <div id="lead-thank-you-description" class="thank-you-modal__copy">
        <p>We'll be reaching out shortly to help.</p>
        <p class="thank-you-modal__soon">Need us sooner?</p>
      </div>
      <a class="button primary" href="sms:+18555128842" data-lead-thank-you-text>Shoot us a text</a>
    </div>
  `;

  leadThankYouModal.querySelectorAll("[data-close-lead-thank-you]").forEach((button) => {
    button.addEventListener("click", closeLeadThankYou);
  });

  const textLink = leadThankYouModal.querySelector("[data-lead-thank-you-text]");
  if (textLink) textLink.addEventListener("click", () => trackSmsClick(textLink));

  document.body.appendChild(leadThankYouModal);
  return leadThankYouModal;
}

function openLeadThankYou() {
  if (modal && modal.classList.contains("is-open")) closeModal();

  const thankYou = getLeadThankYouModal();
  const textLink = thankYou.querySelector("[data-lead-thank-you-text]");
  if (textLink) textLink.setAttribute("href", getPageMarketContact().smsHref);

  leadThankYouScrollY = window.scrollY || window.pageYOffset || 0;
  body.style.setProperty("--modal-scroll-lock-top", `-${leadThankYouScrollY}px`);
  body.classList.add("modal-open");
  thankYou.classList.add("is-open");
  thankYou.setAttribute("aria-hidden", "false");

  if (textLink) {
    textLink.focus();
  } else {
    const closeButton = thankYou.querySelector("[data-close-lead-thank-you]");
    if (closeButton) closeButton.focus();
  }
}

function closeLeadThankYou() {
  if (!leadThankYouModal || !leadThankYouModal.classList.contains("is-open")) return;

  leadThankYouModal.classList.remove("is-open");
  leadThankYouModal.setAttribute("aria-hidden", "true");
  body.classList.remove("modal-open");
  body.style.removeProperty("--modal-scroll-lock-top");
  window.scrollTo(0, leadThankYouScrollY);
}

document.querySelectorAll("[data-open-modal]").forEach((button) => {
  button.addEventListener("click", openModal);
});

document.querySelectorAll("[data-close-modal]").forEach((button) => {
  button.addEventListener("click", closeModal);
});

if (modal) {
  modal.querySelectorAll(".modal-content, .modal-form.contact-form").forEach((scrollContainer) => {
    scrollContainer.addEventListener("scroll", updateModalProgress, { passive: true });
  });

  window.addEventListener("resize", updateModalProgress);
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (leadThankYouModal?.classList.contains("is-open")) {
    closeLeadThankYou();
    return;
  }
  if (modal?.classList.contains("is-open")) closeModal();
});

navToggle.addEventListener("click", () => {
  const isOpen = body.classList.toggle("nav-open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
  if (!isOpen && dropdown && dropdownToggle) {
    dropdown.classList.remove("is-open");
    dropdownToggle.setAttribute("aria-expanded", "false");
  }
  if (!isOpen) closePhoneDropdowns();
});

if (dropdown && dropdownToggle) {
  dropdownToggle.addEventListener("click", () => {
    const isOpen = dropdown.classList.toggle("is-open");
    dropdownToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

phoneDropdowns.forEach((phoneDropdown) => {
  const phoneDropdownToggle = phoneDropdown.querySelector("[data-phone-dropdown-toggle]");
  if (!phoneDropdownToggle) return;

  phoneDropdownToggle.addEventListener("click", () => {
    const isOpen = phoneDropdown.classList.toggle("is-open");
    phoneDropdownToggle.setAttribute("aria-expanded", String(isOpen));
    closePhoneDropdowns(phoneDropdown);
    if (dropdown && dropdownToggle) {
      dropdown.classList.remove("is-open");
      dropdownToggle.setAttribute("aria-expanded", "false");
    }
  });
});

nav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    body.classList.remove("nav-open");
    navToggle.setAttribute("aria-expanded", "false");
    if (dropdown && dropdownToggle) {
      dropdown.classList.remove("is-open");
      dropdownToggle.setAttribute("aria-expanded", "false");
    }
    closePhoneDropdowns();
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-phone-dropdown]")) closePhoneDropdowns();
});

function collapseReviewCard(reviewCard) {
  if (!reviewCard) return;
  reviewCard.classList.remove("is-expanded");
  const toggle = reviewCard.querySelector("[data-review-toggle]");
  if (!toggle) return;
  toggle.setAttribute("aria-expanded", "false");
  toggle.textContent = "Read more";
}

function collapseExpandedReviewCards() {
  document.querySelectorAll("[data-review-card].is-expanded").forEach((reviewCard) => {
    collapseReviewCard(reviewCard);
  });
}

document.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-review-toggle]");
  if (!toggle) return;

  const reviewCard = toggle.closest("[data-review-card]");
  if (!reviewCard) return;

  const expanded = !reviewCard.classList.contains("is-expanded");
  collapseExpandedReviewCards();
  if (!expanded) return;

  reviewCard.classList.add("is-expanded");
  toggle.setAttribute("aria-expanded", "true");
  toggle.textContent = "Show less";
});

let lastScrollY = window.scrollY;

window.addEventListener(
  "scroll",
  () => {
    const currentScrollY = window.scrollY;

    if (currentScrollY > lastScrollY + 12) {
      collapseExpandedReviewCards();
    }

    lastScrollY = currentScrollY;
  },
  { passive: true }
);

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.16 }
);

document.querySelectorAll(".reveal").forEach((element) => {
  revealObserver.observe(element);
});

const scoreRings = document.querySelectorAll("[data-score-ring]");

function animateScoreRing(ring) {
  const target = Number(ring.dataset.score || 0);
  const value = ring.querySelector("[data-score-value]");
  const duration = 2400;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(target * eased);

    ring.style.setProperty("--score", `${target * eased}%`);
    if (value) value.textContent = current;

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      ring.style.setProperty("--score", `${target}%`);
      if (value) value.textContent = target;
    }
  }

  requestAnimationFrame(tick);
}

const scoreObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        animateScoreRing(entry.target);
        scoreObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.6 }
);

scoreRings.forEach((ring) => {
  scoreObserver.observe(ring);
});

hotspots.forEach((hotspot) => {
  hotspot.addEventListener("click", () => {
    hotspots.forEach((item) => {
      if (item !== hotspot) item.classList.remove("is-active");
    });
    hotspot.classList.toggle("is-active");
    updateHotspotHint();
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-hotspot]")) {
    hotspots.forEach((hotspot) => hotspot.classList.remove("is-active"));
    updateHotspotHint();
  }
});

if (processCarousel) {
  const windowElement = processCarousel.querySelector(".process-carousel-window");
  const prevButton = processCarousel.querySelector("[data-carousel-prev]");
  const nextButton = processCarousel.querySelector("[data-carousel-next]");

  function getSlideStep() {
    const card = processCarousel.querySelector(".feature-card");
    const track = processCarousel.querySelector("[data-carousel-track]");
    const gap = parseFloat(getComputedStyle(track).gap) || 0;
    return card.getBoundingClientRect().width + gap;
  }

  function updateCarouselButtons() {
    const maxScroll = windowElement.scrollWidth - windowElement.clientWidth;
    prevButton.disabled = windowElement.scrollLeft <= 4;
    nextButton.disabled = windowElement.scrollLeft >= maxScroll - 4;
  }

  nextButton.addEventListener("click", () => {
    windowElement.scrollBy({ left: getSlideStep(), behavior: "smooth" });
  });

  prevButton.addEventListener("click", () => {
    windowElement.scrollBy({ left: -getSlideStep(), behavior: "smooth" });
  });

  windowElement.addEventListener("scroll", updateCarouselButtons);
  window.addEventListener("resize", updateCarouselButtons);
  updateCarouselButtons();
}

if (heroServiceCarousel) {
  const windowElement = heroServiceCarousel.querySelector(".hero-service-window");
  const track = heroServiceCarousel.querySelector(".hero-service-track");
  const prevButton = heroServiceCarousel.querySelector(".hero-service-arrow--prev");
  const nextButton = heroServiceCarousel.querySelector(".hero-service-arrow--next");
  const originalCards = Array.from(track.querySelectorAll(".hero-service-card"));
  let normalizeFrame = 0;
  let isNormalizing = false;

  function makeHeroServiceClone(card) {
    const clone = card.cloneNode(true);
    clone.dataset.clone = "true";
    clone.setAttribute("aria-hidden", "true");
    clone.setAttribute("tabindex", "-1");
    return clone;
  }

  originalCards.forEach((card) => {
    track.appendChild(makeHeroServiceClone(card));
  });

  const beforeFragment = document.createDocumentFragment();
  originalCards.forEach((card) => {
    beforeFragment.appendChild(makeHeroServiceClone(card));
  });
  track.insertBefore(beforeFragment, track.firstChild);

  function getHeroServiceStep() {
    const card = track.querySelector(".hero-service-card");
    const gap = parseFloat(getComputedStyle(track).gap) || 0;
    return card.getBoundingClientRect().width + gap;
  }

  function getHeroServicePatternWidth() {
    const cards = track.querySelectorAll(".hero-service-card");
    const firstCard = cards[0];
    const firstOriginalCard = cards[originalCards.length];
    if (!firstCard || !firstOriginalCard) return 0;
    return firstOriginalCard.offsetLeft - firstCard.offsetLeft;
  }

  function setHeroServiceInitialPosition() {
    const patternWidth = getHeroServicePatternWidth();
    if (!patternWidth) return;

    windowElement.scrollLeft = patternWidth;
  }

  function normalizeHeroServicePosition() {
    if (isNormalizing) return;

    const patternWidth = getHeroServicePatternWidth();
    if (!patternWidth) return;

    const lowerBoundary = patternWidth * 0.42;
    const upperBoundary = patternWidth * 1.58;

    if (windowElement.scrollLeft < lowerBoundary) {
      isNormalizing = true;
      windowElement.scrollLeft += patternWidth;
    } else if (windowElement.scrollLeft > upperBoundary) {
      isNormalizing = true;
      windowElement.scrollLeft -= patternWidth;
    } else {
      return;
    }

    requestAnimationFrame(() => {
      isNormalizing = false;
    });
  }

  function scheduleHeroServiceNormalize() {
    if (normalizeFrame) return;

    normalizeFrame = requestAnimationFrame(() => {
      normalizeFrame = 0;
      normalizeHeroServicePosition();
    });
  }

  prevButton.addEventListener("click", () => {
    windowElement.scrollBy({ left: -getHeroServiceStep(), behavior: "smooth" });
  });

  nextButton.addEventListener("click", () => {
    windowElement.scrollBy({ left: getHeroServiceStep(), behavior: "smooth" });
  });

  windowElement.addEventListener("scroll", scheduleHeroServiceNormalize, { passive: true });
  window.addEventListener("resize", () => {
    requestAnimationFrame(setHeroServiceInitialPosition);
  });

  requestAnimationFrame(setHeroServiceInitialPosition);
}

if (serviceCarousel) {
  const slides = Array.from(serviceCarousel.querySelectorAll("[data-service-slide]"));
  const thumbs = Array.from(serviceCarousel.querySelectorAll("[data-service-thumb]"));
  const prevButton = serviceCarousel.querySelector("[data-service-prev]");
  const nextButton = serviceCarousel.querySelector("[data-service-next]");
  const rail = serviceCarousel.querySelector(".service-showcase__rail");
  let activeIndex = slides.findIndex((slide) => slide.classList.contains("is-active"));

  if (activeIndex < 0) activeIndex = 0;

  function setActiveService(index) {
    activeIndex = (index + slides.length) % slides.length;

    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle("is-active", slideIndex === activeIndex);
    });

    thumbs.forEach((thumb, thumbIndex) => {
      const isActive = thumbIndex === activeIndex;
      thumb.classList.toggle("is-active", isActive);
      thumb.setAttribute("aria-current", isActive ? "true" : "false");
    });

    const activeThumb = thumbs[activeIndex];
    if (activeThumb && rail) {
      const targetLeft = activeThumb.offsetLeft - rail.clientWidth / 2 + activeThumb.clientWidth / 2;
      rail.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: "smooth"
      });
    }
  }

  prevButton.addEventListener("click", () => {
    setActiveService(activeIndex - 1);
  });

  nextButton.addEventListener("click", () => {
    setActiveService(activeIndex + 1);
  });

  thumbs.forEach((thumb, index) => {
    thumb.addEventListener("click", () => {
      setActiveService(index);
    });
  });

  setActiveService(activeIndex);
}

function syncProjectTypeValidity(projectOptions) {
  if (!projectOptions.length) return true;

  const hasSelection = projectOptions.some((input) => input.checked);

  projectOptions.forEach((input) => input.setCustomValidity(""));

  if (!hasSelection) {
    projectOptions[0].setCustomValidity("Select at least one project type.");
  }

  return hasSelection;
}

const addressFieldConfig = [
  { name: "street_address", message: "Enter the property street address." },
  { name: "city", message: "Enter the property city." },
  { name: "state", message: "Select the property state." },
  { name: "zip", message: "Enter the property ZIP code." }
];

function getAddressInputs(form) {
  return addressFieldConfig
    .map((field) => ({ ...field, input: form.elements[field.name] }))
    .filter((field) => field.input);
}

function syncFullAddressValidity(form) {
  const addressInputs = getAddressInputs(form);
  if (!addressInputs.length) return true;

  let isValid = true;

  addressInputs.forEach(({ input, message }) => {
    const value = String(input.value || "").trim();
    input.setCustomValidity("");

    if (!value) {
      input.setCustomValidity(message);
      isValid = false;
    }
  });

  return isValid;
}

function reportFirstInvalidAddressField(form) {
  const firstInvalid = getAddressInputs(form).find(({ input }) => !String(input.value || "").trim());
  if (firstInvalid?.input) firstInvalid.input.reportValidity();
}

function buildFullAddress(payload) {
  const street = String(payload.street_address || "").trim();
  const city = String(payload.city || "").trim();
  const state = String(payload.state || "").trim();
  const zip = String(payload.zip || "").trim();
  const region = [state, zip].filter(Boolean).join(" ");

  return [street, city, region].filter(Boolean).join(", ");
}

function getInlineGoogleMapsApiKey() {
  const metaKey = document.querySelector('meta[name="good-attic-google-maps-api-key"]')?.content;
  const windowKey = window.GOOD_ATTIC_GOOGLE_MAPS_API_KEY;
  const key = typeof windowKey === "string" && windowKey.trim() ? windowKey : metaKey;

  return typeof key === "string" ? key.trim() : "";
}

async function getGoogleMapsApiKey() {
  const inlineKey = getInlineGoogleMapsApiKey();
  if (inlineKey) return inlineKey;
  if (window.location.protocol === "file:") return "";

  try {
    const response = await fetch(addressAutocompleteConfig.configEndpoint, {
      credentials: "same-origin",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) return "";

    const config = await response.json();
    const key = config.googleMapsBrowserKey || config.google_maps_browser_key || config.mapsApiKey;

    return typeof key === "string" ? key.trim() : "";
  } catch (error) {
    return "";
  }
}

function loadGoogleMapsScript(key) {
  if (!key) return Promise.resolve(false);
  if (window.google?.maps?.importLibrary) return Promise.resolve(true);
  if (window.goodAtticMapsScriptPromise) return window.goodAtticMapsScriptPromise;

  window.goodAtticMapsScriptPromise = new Promise((resolve) => {
    const existingScript = document.getElementById(addressAutocompleteConfig.mapsScriptId);

    window[addressAutocompleteConfig.callbackName] = () => {
      resolve(Boolean(window.google?.maps?.importLibrary));
    };

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(Boolean(window.google?.maps?.importLibrary)), { once: true });
      existingScript.addEventListener("error", () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key,
      callback: addressAutocompleteConfig.callbackName,
      loading: "async",
      v: "weekly"
    });

    script.id = addressAutocompleteConfig.mapsScriptId;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return window.goodAtticMapsScriptPromise;
}

async function loadGoogleMapsPlaces(key) {
  const mapsReady = await loadGoogleMapsScript(key);
  if (!mapsReady || typeof window.google?.maps?.importLibrary !== "function") return null;

  try {
    const placesLibrary = await window.google.maps.importLibrary("places");
    if (!placesLibrary?.AutocompleteSuggestion || !placesLibrary?.AutocompleteSessionToken) return null;
    return placesLibrary;
  } catch (error) {
    return null;
  }
}

function findAddressComponent(components, type) {
  return components.find((component) => component.types.includes(type));
}

function getAddressComponentValue(components, type, name = "long") {
  const component = findAddressComponent(components, type);
  if (!component) return "";

  if (name === "short") {
    return component.shortText || component.short_name || component.longText || component.long_name || "";
  }

  return component.longText || component.long_name || component.shortText || component.short_name || "";
}

function parseGoogleAddress(place) {
  const components = Array.isArray(place?.addressComponents)
    ? place.addressComponents
    : Array.isArray(place?.address_components)
      ? place.address_components
      : [];
  if (!components.length) return null;

  const streetNumber = getAddressComponentValue(components, "street_number");
  const route = getAddressComponentValue(components, "route", "short") || getAddressComponentValue(components, "route");
  const subpremise = getAddressComponentValue(components, "subpremise");
  const city =
    getAddressComponentValue(components, "locality") ||
    getAddressComponentValue(components, "postal_town") ||
    getAddressComponentValue(components, "sublocality_level_1") ||
    getAddressComponentValue(components, "administrative_area_level_3") ||
    getAddressComponentValue(components, "administrative_area_level_2");
  const state = getAddressComponentValue(components, "administrative_area_level_1", "short");
  const postalCode = getAddressComponentValue(components, "postal_code");
  const zip = postalCode.replace(/[^\d]/g, "").slice(0, 5);
  const streetParts = [streetNumber, route].filter(Boolean);

  if (subpremise && streetParts.length) streetParts.push(`#${subpremise}`);

  return {
    street_address: streetParts.join(" "),
    city,
    state,
    zip
  };
}

function getAddressAutocompleteLocationBias() {
  const marketBias = addressAutocompleteBiases[getPageContext().page_market];
  if (!marketBias) return null;

  return {
    south: marketBias.south,
    west: marketBias.west,
    north: marketBias.north,
    east: marketBias.east
  };
}

function setAddressFieldValue(form, name, value) {
  const input = form.elements[name];
  if (!input || !value) return;

  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function getAddressSuggestionLabel(suggestion) {
  const prediction = suggestion?.placePrediction;
  const text = prediction?.text?.text || prediction?.text?.toString?.();
  const mainText = prediction?.mainText?.text || prediction?.mainText?.toString?.();
  const secondaryText = prediction?.secondaryText?.text || prediction?.secondaryText?.toString?.();

  if (text) return text;
  return [mainText, secondaryText].filter(Boolean).join(", ");
}

function createAddressSuggestionsList(input) {
  const list = document.createElement("div");
  const id = `address-suggestions-${Date.now()}-${Math.round(Math.random() * 100000)}`;

  list.id = id;
  list.className = "address-suggestions";
  list.setAttribute("role", "listbox");
  list.hidden = true;

  input.closest("label")?.classList.add("address-autocomplete-field");
  input.insertAdjacentElement("afterend", list);
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", id);

  return list;
}

function hideAddressSuggestions(state) {
  state.list.hidden = true;
  state.list.innerHTML = "";
  state.input.setAttribute("aria-expanded", "false");
  state.activeIndex = -1;
}

function updateAddressSuggestionActive(state) {
  [...state.list.querySelectorAll(".address-suggestion")].forEach((button, index) => {
    const isActive = index === state.activeIndex;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
}

async function selectAddressSuggestion(state, suggestion) {
  const prediction = suggestion?.placePrediction;
  const label = getAddressSuggestionLabel(suggestion);

  hideAddressSuggestions(state);
  if (label) setAddressFieldValue(state.form, "street_address", label);
  if (!prediction?.toPlace) return;

  try {
    const place = prediction.toPlace();
    await place.fetchFields({ fields: ["addressComponents", "formattedAddress"] });
    const address = parseGoogleAddress(place);

    if (address) {
      if (!address.street_address && label) address.street_address = label;
      Object.entries(address).forEach(([name, value]) => {
        setAddressFieldValue(state.form, name, value);
      });
      syncFullAddressValidity(state.form);
    }
  } catch (error) {
    syncFullAddressValidity(state.form);
  } finally {
    state.sessionToken = null;
    state.input.focus();
  }
}

function renderAddressSuggestions(state, suggestions) {
  state.suggestions = suggestions.slice(0, addressAutocompleteConfig.maxSuggestions);
  state.list.innerHTML = "";

  if (!state.suggestions.length) {
    hideAddressSuggestions(state);
    return;
  }

  state.suggestions.forEach((suggestion, index) => {
    const label = getAddressSuggestionLabel(suggestion);
    if (!label) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "address-suggestion";
    button.id = `${state.list.id}-option-${index}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    button.textContent = label;
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      selectAddressSuggestion(state, suggestion);
    });
    state.list.appendChild(button);
  });

  if (!state.list.children.length) {
    hideAddressSuggestions(state);
    return;
  }

  state.activeIndex = 0;
  state.list.hidden = false;
  state.input.setAttribute("aria-expanded", "true");
  updateAddressSuggestionActive(state);
}

async function requestAddressSuggestions(state) {
  const query = state.input.value.trim();
  if (query.length < addressAutocompleteConfig.minQueryLength) {
    hideAddressSuggestions(state);
    return;
  }

  const { AutocompleteSessionToken, AutocompleteSuggestion } = state.placesLibrary;
  if (!state.sessionToken) state.sessionToken = new AutocompleteSessionToken();

  const requestId = state.requestId + 1;
  const request = {
    input: query,
    includedRegionCodes: ["us"],
    language: "en-US",
    region: "us",
    sessionToken: state.sessionToken
  };
  const locationBias = getAddressAutocompleteLocationBias();

  if (locationBias) request.locationBias = locationBias;
  state.requestId = requestId;

  try {
    const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
    if (requestId !== state.requestId) return;
    renderAddressSuggestions(state, (suggestions || []).filter((suggestion) => suggestion.placePrediction));
  } catch (error) {
    hideAddressSuggestions(state);
  }
}

function attachAddressAutocomplete(form, placesLibrary) {
  const streetInput = form.elements.street_address;
  if (!streetInput || streetInput.dataset.addressAutocomplete === "enabled") return;
  if (!placesLibrary?.AutocompleteSuggestion || !placesLibrary?.AutocompleteSessionToken) return;

  const placeholder = streetInput.getAttribute("placeholder") || "Street address";
  const state = {
    form,
    input: streetInput,
    list: createAddressSuggestionsList(streetInput),
    placesLibrary,
    suggestions: [],
    activeIndex: -1,
    requestId: 0,
    sessionToken: null,
    timeout: null
  };

  streetInput.dataset.addressAutocompletePlaceholder = placeholder;
  if (!streetInput.getAttribute("placeholder")) streetInput.setAttribute("placeholder", placeholder);
  streetInput.dataset.addressAutocomplete = "enabled";

  streetInput.addEventListener("input", () => {
    window.clearTimeout(state.timeout);
    state.timeout = window.setTimeout(() => {
      requestAddressSuggestions(state);
    }, addressAutocompleteConfig.debounceMs);
  });

  streetInput.addEventListener("keydown", (event) => {
    if (state.list.hidden || !state.suggestions.length) {
      if (event.key === "Escape") hideAddressSuggestions(state);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.activeIndex = Math.min(state.activeIndex + 1, state.suggestions.length - 1);
      updateAddressSuggestionActive(state);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      state.activeIndex = Math.max(state.activeIndex - 1, 0);
      updateAddressSuggestionActive(state);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectAddressSuggestion(state, state.suggestions[Math.max(state.activeIndex, 0)]);
    } else if (event.key === "Escape") {
      hideAddressSuggestions(state);
    }
  });

  streetInput.addEventListener("blur", () => {
    window.setTimeout(() => hideAddressSuggestions(state), 180);
  });
}

function enableAddressAutocomplete(forms) {
  if (!addressAutocompleteInitPromise) {
    addressAutocompleteInitPromise = (async () => {
      const key = await getGoogleMapsApiKey();
      const placesLibrary = await loadGoogleMapsPlaces(key);
      if (!placesLibrary) return false;

      forms.forEach((form) => attachAddressAutocomplete(form, placesLibrary));
      return true;
    })();
  }

  return addressAutocompleteInitPromise;
}

function initAddressAutocomplete() {
  const forms = Array.from(document.querySelectorAll("[data-lead-form]")).filter((form) => form.elements.street_address);
  if (!forms.length) return;

  forms.forEach((form) => {
    const streetInput = form.elements.street_address;
    if (!streetInput || streetInput.dataset.addressAutocompleteReady === "pending") return;

    streetInput.dataset.addressAutocompleteReady = "pending";
    const loadAutocomplete = () => {
      enableAddressAutocomplete(forms);
    };

    streetInput.addEventListener("focus", loadAutocomplete, { once: true });
    streetInput.addEventListener("pointerdown", loadAutocomplete, { once: true });
  });
}

document.querySelectorAll("[data-lead-form]").forEach((form) => {
  const projectOptions = [...form.querySelectorAll('input[name="project_type"]')];
  const addressInputs = getAddressInputs(form);
  const selfReportedSource = form.elements.self_reported_source;
  const aiSourceDetail = form.querySelector("[data-ai-source-detail]");
  const aiSourceDetailSelect = form.elements.self_reported_source_detail;

  const syncAiSourceDetail = () => {
    if (!selfReportedSource || !aiSourceDetail || !aiSourceDetailSelect) return;
    const showAiDetail = selfReportedSource.value === "ai_search";
    aiSourceDetail.hidden = !showAiDetail;
    aiSourceDetailSelect.disabled = !showAiDetail;
    if (!showAiDetail) aiSourceDetailSelect.value = "";
  };

  if (selfReportedSource) {
    selfReportedSource.addEventListener("change", syncAiSourceDetail);
    syncAiSourceDetail();
  }

  projectOptions.forEach((input) => {
    ["change", "input"].forEach((eventName) => {
      input.addEventListener(eventName, () => {
        syncProjectTypeValidity(projectOptions);
      });
    });
  });

  addressInputs.forEach(({ input }) => {
    ["change", "input"].forEach((eventName) => {
      input.addEventListener(eventName, () => {
        syncFullAddressValidity(form);
      });
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector("[data-form-status]");
    const endpoint = form.dataset.leadEndpoint || form.dataset.ghlWebhook || "/api/leads";
    const submitButton = form.querySelector('button[type="submit"]');
    let shouldShowThankYou = false;

    if (!syncProjectTypeValidity(projectOptions)) {
      projectOptions[0].reportValidity();
      return;
    }

    if (!syncFullAddressValidity(form)) {
      reportFirstInvalidAddressField(form);
      return;
    }

    if (status) status.textContent = "Preparing your request...";
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute("aria-busy", "true");
    }

    if (endpoint) {
      try {
        const formData = new FormData(form);
        const payload = Object.fromEntries(formData.entries());
        payload.project_type = formData.getAll("project_type");
        payload.project_type_label = payload.project_type.join(", ");
        payload.full_address = buildFullAddress(payload);
        addAttributionToPayload(payload);

        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        let result = null;
        try {
          result = await response.json();
        } catch (parseError) {
          result = null;
        }

        if (!response.ok || result?.ok === false) {
          throw new Error(result?.message || "Form endpoint failed.");
        }

        if (status) status.textContent = "Thanks. Your quote request has been sent.";
        trackLeadConversion(payload);
        shouldShowThankYou = true;
      } catch (error) {
        if (status) status.textContent = "Something went wrong. Please call or text us and we will help right away.";
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.removeAttribute("aria-busy");
        }
        return;
      }
    } else if (status) {
      status.textContent = "Thanks. Your request is ready for lead routing.";
    }

    form.reset();
    syncAiSourceDetail();
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
    }
    updateSourcePageFields();
    if (shouldShowThankYou) openLeadThankYou();
  });
});

initAddressAutocomplete();
