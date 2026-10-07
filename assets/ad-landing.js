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
  // Google's supported phone snippet invokes phone_conversion_callback. It
  // may run before this deferred script, so the inline snippet caches its
  // result and we replay it here. No extra gtag config or conversion is sent.
  window.goodAtticLpApplyForwardingNumber = updateCallNumber;
  if (Array.isArray(window.goodAtticLpPendingCallNumber)) {
    updateCallNumber(...window.goodAtticLpPendingCallNumber);
  }
})();
