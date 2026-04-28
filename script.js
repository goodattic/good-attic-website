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

document.querySelector("[data-year]").textContent = new Date().getFullYear();

function updateSourcePageFields() {
  document.querySelectorAll("[data-source-page]").forEach((input) => {
    input.value = window.location.href;
  });
}

updateSourcePageFields();

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

document.querySelectorAll("[data-lead-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector("[data-form-status]");
    const endpoint = form.dataset.ghlWebhook || "/api/leads";
    const submitButton = form.querySelector('button[type="submit"]');
    const projectOptions = [...form.querySelectorAll('input[name="project_type"]')];
    const selectedProjects = projectOptions.filter((input) => input.checked);

    if (projectOptions.length && selectedProjects.length === 0) {
      projectOptions[0].setCustomValidity("Select at least one project type.");
      projectOptions[0].reportValidity();
      return;
    }

    projectOptions.forEach((input) => input.setCustomValidity(""));

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
      } catch (error) {
        if (status) status.textContent = "Something went wrong. Please call or text us and we will help right away.";
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.removeAttribute("aria-busy");
        }
        return;
      }
    } else if (status) {
      status.textContent = "Thanks. Your request is ready for GoHighLevel wiring.";
    }

    form.reset();
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
    }
    updateSourcePageFields();
    if (modal && modal.classList.contains("is-open")) {
      window.setTimeout(closeModal, 900);
    }
  });
});
