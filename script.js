const body = document.body;
const modal = document.querySelector("[data-modal]");
const navToggle = document.querySelector("[data-menu-toggle]");
const nav = document.querySelector("[data-nav]");
const dropdown = document.querySelector("[data-dropdown]");
const dropdownToggle = document.querySelector("[data-dropdown-toggle]");
const phoneDropdowns = document.querySelectorAll("[data-phone-dropdown]");
const serviceSelect = document.querySelector("[data-service-select]");
const conditionalField = document.querySelector("[data-conditional-field]");
const conditionalLabel = document.querySelector("[data-conditional-label]");
const hotspots = document.querySelectorAll("[data-hotspot]");
const processCarousel = document.querySelector("[data-process-carousel]");

document.querySelector("[data-year]").textContent = new Date().getFullYear();

function closePhoneDropdowns(exceptDropdown) {
  phoneDropdowns.forEach((phoneDropdown) => {
    if (phoneDropdown === exceptDropdown) return;
    phoneDropdown.classList.remove("is-open");
    const toggle = phoneDropdown.querySelector("[data-phone-dropdown-toggle]");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  });
}

function openModal() {
  body.classList.remove("nav-open");
  navToggle.setAttribute("aria-expanded", "false");
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  body.classList.add("modal-open");
}

function closeModal() {
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  body.classList.remove("modal-open");
}

document.querySelectorAll("[data-open-modal]").forEach((button) => {
  button.addEventListener("click", openModal);
});

document.querySelectorAll("[data-close-modal]").forEach((button) => {
  button.addEventListener("click", closeModal);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
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
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-hotspot]")) {
    hotspots.forEach((hotspot) => hotspot.classList.remove("is-active"));
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

const servicePrompts = {
  insulation: "What rooms feel uncomfortable, and do you know the current insulation age?",
  restoration: "What happened in the attic, and has anything already been removed or cleaned?",
  pests: "What pest activity did you notice, and has exclusion or pest control already been completed?",
  comfort: "Tell us where you notice heat, cold, drafts, odors, or high energy use.",
  unsure: "Share the symptoms you are noticing, even if you are not sure what is causing them."
};

if (serviceSelect && conditionalField && conditionalLabel) {
  serviceSelect.addEventListener("change", () => {
    const prompt = servicePrompts[serviceSelect.value];
    conditionalField.hidden = !prompt;
    if (prompt) conditionalLabel.textContent = prompt;
  });
}

document.querySelectorAll("[data-lead-form]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const status = form.querySelector("[data-form-status]");
    if (status) {
      status.textContent = "Thanks. Your request is ready to connect to email, CRM, or a form backend.";
    }
    form.reset();
    if (conditionalField) conditionalField.hidden = true;
    if (modal.classList.contains("is-open")) closeModal();
  });
});
