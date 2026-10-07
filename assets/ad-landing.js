(() => {
  document.querySelectorAll("[data-service-picker]").forEach((picker) => {
    const inputs = [...picker.querySelectorAll('input[name="project_type"]')];
    const summary = picker.querySelector("[data-service-summary]");
    const options = picker.querySelector(".lp-service-options");
    const positionOptions = () => {
      const anchor = picker.querySelector("summary").getBoundingClientRect();
      const bounds = options.getBoundingClientRect();
      options.style.left = `${Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12))}px`;
      options.style.top = `${Math.max(12, anchor.top - bounds.height - 8)}px`;
    };
    picker.addEventListener("toggle", (event) => {
      if (event.target !== picker) return;
      if (picker.open) {
        if (options.showPopover && !options.matches(":popover-open")) options.showPopover();
        positionOptions();
        requestAnimationFrame(() => { if (picker.open) positionOptions(); });
      } else if (options.hidePopover && options.matches(":popover-open")) options.hidePopover();
    });
    picker.querySelectorAll("[data-service-apply]").forEach((button) => button.addEventListener("click", () => {
      picker.open = false;
      picker.querySelector("summary").focus({ preventScroll: true });
    }));
    window.addEventListener("resize", () => { if (picker.open) positionOptions(); });
    window.addEventListener("scroll", () => { if (picker.open) positionOptions(); }, { passive: true });
    const sync = () => {
      const selected = inputs.filter((input) => input.checked);
      summary.textContent = selected.length > 1 ? `${selected.length} selected` : selected[0]?.value || "Select services";
      picker.querySelector("summary").setAttribute("aria-label", `Services Needed? ${selected.length ? selected.map((input) => input.value).join(", ") : "Select one or more"}`);
      inputs[0].setCustomValidity(selected.length ? "" : "Select at least one service.");
    };
    picker.addEventListener("change", sync);
    picker.addEventListener("invalid", () => { picker.open = true; }, true);
    picker.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { picker.open = false; picker.querySelector("summary").focus(); }
    });
    picker.closest("form").addEventListener("reset", () => { picker.open = false; setTimeout(sync, 0); });
    sync();
  });

  const market = document.documentElement.dataset.lpMarket;
  const towns = {
    ut: {
      "1026990": "Salt Lake City", "1026991": "Sandy", "9051778": "Cottonwood Heights",
      "9052441": "Millcreek", "1026920": "Draper", "9052142": "Holladay",
      "1026902": "Alpine", "9052128": "Highland"
    },
    mo_stl: {
      "9053163": "Wildwood", "1020183": "Ballwin", "1020256": "Chesterfield",
      "9051789": "Creve Coeur", "1020476": "Maryland Heights",
      "9052999": "Town and Country", "9051738": "Clayton"
    },
    mo_kc: {
      "1020414": "Kansas City", "1017596": "Overland Park",
      "9052714": "Prairie Village", "1017539": "Leawood", "1017571": "Mission",
      "1017631": "Shawnee", "1017588": "Olathe", "1020444": "Lee's Summit"
    }
  };
  const locationId = new URLSearchParams(location.search).get("utm_location");
  const town = towns[market]?.[locationId];
  if (town) document.querySelectorAll("[data-lp-town]").forEach((node) => { node.textContent = town; });

  // Match the market pages' Google Ads call-number configuration while keeping
  // each market number usable in the HTML before any tracking script loads.
  const originalNumber = document.documentElement.dataset.lpPhone;
  if (!originalNumber) return;
  const normalize = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return "";
  };
  const updateCallNumber = (formattedNumber, mobileNumber) => {
    const href = normalize(mobileNumber) || normalize(formattedNumber);
    if (!href || typeof formattedNumber !== "string" || !formattedNumber.trim()) return;
    document.querySelectorAll("[data-lp-call]").forEach((link) => { link.href = `tel:${href}`; });
    document.querySelectorAll("[data-lp-call-number]").forEach((node) => { node.textContent = formattedNumber; });
  };
  const waitForGoogleCallTracking = () => {
    const deadline = Date.now() + 10000;
    const poll = () => {
      if (typeof window._googWcmGet === "function") {
        try { window._googWcmGet(updateCallNumber, originalNumber); return; }
        catch { /* Google tag may still be initializing. */ }
      }
      if (Date.now() < deadline) window.setTimeout(poll, 250);
    };
    poll();
  };
  if (document.readyState === "complete") waitForGoogleCallTracking();
  else window.addEventListener("load", waitForGoogleCallTracking, { once: true });
})();

// Fit only the display headline; market/town lookup and form logic stay untouched.
(() => {
  const headline = document.querySelector('[data-lp-fit-headline]');
  if (!headline) return;
  const fit = () => {
    headline.style.removeProperty('font-size');
    if (innerWidth > 640) return;
    for (let size = 32; size >= 26; size -= 0.5) {
      headline.style.fontSize = `${size}px`;
      if (headline.getBoundingClientRect().height <= parseFloat(getComputedStyle(headline).lineHeight) * 3 + 1) break;
    }
  };
  fit();
  document.fonts.ready.then(fit);
  // Resizing the headline changes its parent's height. Only width changes
  // require another fit; schedule it outside the observer delivery cycle.
  let lastWidth = headline.parentElement.getBoundingClientRect().width;
  new ResizeObserver(([entry]) => {
    if (entry.contentRect.width === lastWidth) return;
    lastWidth = entry.contentRect.width;
    requestAnimationFrame(fit);
  }).observe(headline.parentElement);
})();
