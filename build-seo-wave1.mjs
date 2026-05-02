import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const site = {
  name: "Good Attic",
  baseUrl: "https://goodattic.energy",
  description:
    "Good Attic helps homeowners solve insulation, removal, pest, ventilation, and attic air sealing issues with premium attic services and documented next steps.",
  phoneDisplay: "385-336-0062",
  phoneHref: "tel:+13853360062",
  smsHref: "sms:+13853360062",
  footerSummary: "Premium attic restoration, insulation, and home comfort solutions.",
  footerDisclaimer: "Service availability, recommendations, and pricing depend on inspection findings and local conditions."
};

const proofAssets = {
  insulation: "assets/attic-insulation.png",
  removal: "assets/attic-insulation-removal.png",
  airSealing: "assets/attic-air-sealing.png",
  fans: "assets/attic-fans.png",
  pests: "assets/animals-in-the-attic.png",
  dirtyReset: "assets/dirty-old-attic-needing-restoration.png",
  grossAttic: "assets/gross-attic.png",
  grossDusty: "assets/gross-dusty-attic.png",
  hotColdInsulation: "assets/hot-cold-attic-insulation.png",
  hotColdHouse: "assets/hot-cold-house-attic-issues.png",
  unevenTemps: "assets/hot-cold-uneven-temperatures-attic.png",
  pestDamage: "assets/pest-issues-in-attic.png",
  pestDamageTransparent: "assets/pest-issues-in-attic-transparent-v2.png",
  sales: "assets/good-attic-insulation-sales-appointment.png"
};

const proofDataDirectory = path.join(__dirname, "data", "proof");
const approvedReviewDataPath = path.join(proofDataDirectory, "approved-review-excerpts.json");
const documentedProjectProofDataPath = path.join(proofDataDirectory, "documented-project-proof.json");

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeOptionalString(item)).filter(Boolean);
}

async function readJsonContent(filePath, fallback = { items: [] }) {
  try {
    const contents = await readFile(filePath, "utf8");
    return JSON.parse(contents);
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw new Error(`Unable to load JSON from ${filePath}: ${error.message}`);
  }
}

function itemsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

function normalizeReviewEntry(entry, index) {
  const quote = normalizeOptionalString(entry?.quote);
  if (!quote) {
    console.warn(`Skipping approved review entry ${index + 1}: missing quote.`);
    return null;
  }

  return {
    market: normalizeOptionalString(entry.market),
    serviceSlug: normalizeOptionalString(entry.serviceSlug),
    city: normalizeOptionalString(entry.city),
    source: normalizeOptionalString(entry.source),
    focus: normalizeOptionalString(entry.focus),
    title: normalizeOptionalString(entry.title),
    reviewerLabel: normalizeOptionalString(entry.reviewerLabel),
    quote,
    image: normalizeOptionalString(entry.image),
    alt: normalizeOptionalString(entry.alt),
    targetUrl: normalizeOptionalString(entry.targetUrl),
    targetLabel: normalizeOptionalString(entry.targetLabel),
    tags: normalizeStringArray(entry.tags)
  };
}

function normalizeDocumentedProofEntry(entry, index) {
  const title = normalizeOptionalString(entry?.title);
  const text = normalizeOptionalString(entry?.text);

  if (!title || !text) {
    console.warn(`Skipping documented project proof entry ${index + 1}: missing title or text.`);
    return null;
  }

  return {
    market: normalizeOptionalString(entry.market),
    serviceSlug: normalizeOptionalString(entry.serviceSlug),
    city: normalizeOptionalString(entry.city),
    kicker: normalizeOptionalString(entry.kicker),
    title,
    text,
    image: normalizeOptionalString(entry.image),
    alt: normalizeOptionalString(entry.alt),
    status: normalizeOptionalString(entry.status),
    assetType: normalizeOptionalString(entry.assetType),
    targetUrl: normalizeOptionalString(entry.targetUrl),
    targetLabel: normalizeOptionalString(entry.targetLabel),
    tags: normalizeStringArray(entry.tags)
  };
}

async function loadProofData() {
  const [reviewPayload, documentedProofPayload] = await Promise.all([
    readJsonContent(approvedReviewDataPath),
    readJsonContent(documentedProjectProofDataPath)
  ]);

  return {
    approvedReviewExcerpts: itemsFromPayload(reviewPayload).map(normalizeReviewEntry).filter(Boolean),
    documentedProjectProof: itemsFromPayload(documentedProofPayload).map(normalizeDocumentedProofEntry).filter(Boolean)
  };
}

const { approvedReviewExcerpts, documentedProjectProof } = await loadProofData();

const marketPhones = {
  "salt-lake-city-ut": {
    phoneDisplay: "385-336-0062",
    phoneHref: "tel:+13853360062",
    smsHref: "sms:+13853360062"
  },
  "st-louis-mo": {
    phoneDisplay: "314-916-1220",
    phoneHref: "tel:+13149161220",
    smsHref: "sms:+13149161220"
  },
  "kansas-city-mo": {
    phoneDisplay: "816-434-0308",
    phoneHref: "tel:+18164340308",
    smsHref: "sms:+18164340308"
  }
};

const serviceCatalog = [
  {
    slug: "attic-insulation",
    name: "Attic Insulation",
    summary: "Upgrade underperforming attic insulation so the whole home feels steadier, cleaner, and more efficient.",
    image: "assets/attic-insulation.png",
    heroHeading: "Modern attic insulation levels make the whole home work better.",
    heroText:
      "Fresh, properly installed attic insulation helps stabilize temperatures, reduce energy waste, and support the rest of the attic system.",
    symptoms: [
      {
        title: "Hot and cold rooms",
        text: "Bedrooms, bonus rooms, or upper floors never feel as stable as the rest of the house."
      },
      {
        title: "Rising utility bills",
        text: "HVAC equipment keeps running because the attic is letting too much heat in or out."
      },
      {
        title: "Thin or settled coverage",
        text: "Existing insulation looks compressed, uneven, or clearly below modern target levels."
      }
    ],
    rightFit: [
      {
        title: "You want better year-round comfort",
        text: "Insulation upgrades help when the attic is underperforming but still structurally ready for the next step."
      },
      {
        title: "The attic needs a modern target depth",
        text: "A measured install is better than guessing at what the home may or may not need."
      },
      {
        title: "You want the attic system to work together",
        text: "Insulation works best when it follows cleanup, sealing, and prep work that keeps performance from drifting."
      }
    ],
    process: [
      "Confirm current insulation depth, condition, and attic readiness.",
      "Handle removal or sealing work first if the attic needs a cleaner reset.",
      "Install premium attic insulation to the right modern target for the home."
    ],
    faq: [
      {
        question: "Can you add insulation over what is already there?",
        answer:
          "Sometimes, yes. If the existing material is clean and still worth keeping, a top-off can make sense. If it is dirty, compressed, or contaminated, removal may be the better first step."
      },
      {
        question: "Will attic insulation help all year or just in one season?",
        answer:
          "A better insulation layer helps with both summer heat gain and winter heat loss, especially when air leakage is part of the scope too."
      },
      {
        question: "How do you know how much insulation the house needs?",
        answer:
          "We start with the attic as it exists today and build the recommendation around current depth, visible performance issues, and the rest of the attic plan."
      }
    ],
    related: ["insulation-removal", "attic-air-sealing", "attic-fans"],
    marketIntro: {
      "salt-lake-city-ut":
        "Need attic insulation in Salt Lake City? Good Attic helps solve hot and cold rooms, energy waste, and underperforming attic insulation with a cleaner, more complete attic plan.",
      "st-louis-mo":
        "Need attic insulation in St. Louis? Good Attic helps solve hot upstairs rooms, winter heat loss, and energy waste with attic insulation that fits the house and the attic condition.",
      "kansas-city-mo":
        "Need attic insulation in Kansas City? Good Attic helps reduce attic heat gain, winter heat loss, and underperforming insulation problems with a measured, attic-first approach."
    },
    marketReason: {
      "salt-lake-city-ut":
        "Salt Lake City homes deal with sharp seasonal swings, so the attic has to manage both summer heat and winter heat loss without drifting out of balance.",
      "st-louis-mo":
        "St. Louis homes often need insulation decisions that account for humid summers, cold snaps, and older attic layouts that never got a real performance upgrade.",
      "kansas-city-mo":
        "Kansas City attics see enough seasonal variation that weak insulation shows up quickly in comfort complaints and wasted energy."
    }
  },
  {
    slug: "insulation-removal",
    name: "Insulation Removal",
    summary: "Remove compromised attic material so the space can be cleaned up, sealed, and rebuilt the right way.",
    image: "assets/attic-insulation-removal.png",
    heroHeading: "Old, contaminated attics need a clean reset.",
    heroText:
      "When attic insulation is dirty, damaged, compressed, or contaminated, removal is often the right first step before real improvement can happen.",
    symptoms: [
      {
        title: "Dirty or contaminated insulation",
        text: "Dust, nesting debris, rodent contamination, and old material can make the attic a poor candidate for a simple top-off."
      },
      {
        title: "Settled or broken-down material",
        text: "Insulation may still be present, but no longer doing enough to justify leaving it in place."
      },
      {
        title: "You need a cleaner rebuild",
        text: "Removal creates access for sanitation, sealing, and a fresh insulation strategy."
      }
    ],
    rightFit: [
      {
        title: "The attic should not be topped off blindly",
        text: "If the material underneath is compromised, a reset is often the more honest and durable solution."
      },
      {
        title: "Containment matters",
        text: "Safe removal helps keep attic contaminants from drifting into the living space during the project."
      },
      {
        title: "You want the next step to last",
        text: "Fresh insulation performs better when it is installed onto a clean, prepared attic floor."
      }
    ],
    process: [
      "Protect the living space and attic access path before work begins.",
      "Remove compromised insulation with professional collection and disposal methods.",
      "Prepare the attic for sanitation, air sealing, and the next installation step."
    ],
    faq: [
      {
        question: "When is insulation removal better than leaving old material in place?",
        answer:
          "Removal is often the better path when insulation is contaminated, damaged by pests, heavily settled, damp, or simply not worth building on."
      },
      {
        question: "Does removal make a mess inside the home?",
        answer:
          "The project is built around containment and collection so attic debris stays managed during the work."
      },
      {
        question: "Can removal and re-insulation happen as one plan?",
        answer:
          "Yes. Many homeowners call because they want the attic reset fully, not pieced together in separate disconnected jobs."
      }
    ],
    related: ["attic-pest-remediation", "attic-air-sealing", "attic-insulation"],
    marketIntro: {
      "salt-lake-city-ut":
        "Good Attic removes old, dirty, damaged, or contaminated attic insulation in Salt Lake City so homeowners can start fresh with a cleaner, healthier attic system.",
      "st-louis-mo":
        "Good Attic removes old, dirty, damaged, or contaminated attic insulation in St. Louis and prepares the attic for the right next step instead of covering problems up.",
      "kansas-city-mo":
        "Good Attic removes old, dirty, damaged, or contaminated attic insulation in Kansas City and helps homeowners reset the attic the right way."
    },
    marketReason: {
      "salt-lake-city-ut":
        "Salt Lake attics often need more than added material. Dust, age, pests, and underperforming insulation can all point to removal before reinstalling anything new.",
      "st-louis-mo":
        "In St. Louis, removal becomes especially important when humidity, musty insulation, or pest contamination means the attic needs cleanup before better performance is possible.",
      "kansas-city-mo":
        "Kansas City homeowners often call for removal when the attic has become a mix of old material, debris, odors, and comfort problems that a top-off alone cannot solve."
    }
  },
  {
    slug: "attic-pest-remediation",
    name: "Attic Pest Remediation",
    summary: "Clean up the attic after rodents or other attic pests so the space can be sanitary, usable, and ready for restoration.",
    image: "assets/animals-in-the-attic.png",
    heroHeading: "After pests leave, the attic still needs restoration.",
    heroText:
      "Droppings, nesting debris, odors, damaged insulation, and contaminated material can linger long after pest activity starts or stops.",
    symptoms: [
      {
        title: "Nesting debris and contamination",
        text: "Pest activity leaves behind mess, odor, and health concerns that go well beyond the animal itself."
      },
      {
        title: "Damaged insulation",
        text: "Rodents and other attic pests can compress, shred, and contaminate insulation across the attic floor."
      },
      {
        title: "You need cleanup plus restoration",
        text: "True remediation means restoring the attic, not just removing what is obviously dirty."
      }
    ],
    rightFit: [
      {
        title: "The attic has visible pest aftermath",
        text: "If the insulation, air quality, or attic surfaces were affected, cleanup and sanitation deserve a real plan."
      },
      {
        title: "You want the attic healthy again",
        text: "Remediation should move the attic from contaminated back to clean, not stop halfway."
      },
      {
        title: "You want the project coordinated",
        text: "Removal, sanitation, sealing, and fresh installation work best when handled as one attic strategy."
      }
    ],
    process: [
      "Assess the contamination level and the insulation damage left behind.",
      "Remove affected material and sanitize the attic surfaces that need it.",
      "Reset the attic with the right follow-on upgrades so the space finishes clean."
    ],
    faq: [
      {
        question: "Do I still need cleanup after pest control or exclusion is done?",
        answer:
          "Yes. Exclusion solves the animal problem. Attic remediation handles the insulation damage, droppings, nesting debris, and contamination left behind."
      },
      {
        question: "Is pest remediation just insulation removal?",
        answer:
          "Usually not. Insulation removal may be part of the job, but remediation also involves sanitation and the work needed to restore the attic environment."
      },
      {
        question: "Can the attic be made better than it was before?",
        answer:
          "That is the goal. A well-run remediation project cleans up the damage and sets the attic up for stronger performance moving forward."
      }
    ],
    related: ["insulation-removal", "attic-air-sealing", "attic-insulation"],
    marketIntro: {
      "salt-lake-city-ut":
        "Get help with rodent-contaminated insulation, nesting debris, attic odors, and attic pest cleanup in Salt Lake City with a restoration plan that finishes the attic properly.",
      "st-louis-mo":
        "Get help with attic pest contamination, nesting debris, rodent damage, and attic cleanup in St. Louis with a scope built around restoration, not shortcuts.",
      "kansas-city-mo":
        "Get help with attic pest cleanup, rodent-damaged insulation, nesting debris, and attic contamination in Kansas City with a plan that puts the attic back together cleanly."
    },
    marketReason: {
      "salt-lake-city-ut":
        "Older Utah attics and dust-heavy spaces can turn pest activity into a whole-attic problem quickly, especially once insulation and air quality are affected.",
      "st-louis-mo":
        "In St. Louis, squirrels, mice, and humid attic conditions can combine to create cleanup scopes that need more than a surface-level fix.",
      "kansas-city-mo":
        "Kansas City homeowners usually call because the attic does not just feel dirty; it feels compromised, and they want it restored correctly."
    }
  },
  {
    slug: "attic-fans",
    name: "Attic Fans",
    summary: "Support attic airflow with fan solutions that help reduce trapped heat and back up the rest of the attic strategy.",
    image: "assets/attic-fans.png",
    heroHeading: "Ventilation improvements help the attic stop cooking itself.",
    heroText:
      "Attic fan solutions can help reduce trapped heat and support a more stable attic environment when the house is a good fit for them.",
    symptoms: [
      {
        title: "Heavy attic heat buildup",
        text: "Attics that trap too much heat can put pressure on insulation, roofing materials, and upstairs comfort."
      },
      {
        title: "Upper floors struggle in summer",
        text: "Attic heat can contribute to rooms that lag behind the rest of the home and HVAC equipment that never seems to catch up."
      },
      {
        title: "Ventilation needs a smarter plan",
        text: "A fan can be the right support move when it fits the attic and the broader attic system."
      }
    ],
    rightFit: [
      {
        title: "The attic needs better air movement",
        text: "Fans work best as part of a fit-based approach, not as a blind one-size-fits-all answer."
      },
      {
        title: "Heat management is part of the comfort problem",
        text: "If the attic runs excessively hot, better airflow may deserve a place in the plan."
      },
      {
        title: "You want ventilation considered with insulation and sealing",
        text: "Ventilation should support the full attic strategy instead of fighting it."
      }
    ],
    process: [
      "Review attic heat, airflow, and how the current system is behaving.",
      "Confirm whether a fan solution fits the house and the rest of the attic plan.",
      "Install the right attic fan setup and verify the attic is moving air more effectively."
    ],
    faq: [
      {
        question: "Will an attic fan fix every hot-upstairs problem by itself?",
        answer:
          "Not always. A fan can help when it is the right fit, but insulation depth, air sealing, and the attic condition still matter."
      },
      {
        question: "How do you know whether an attic fan is worth it?",
        answer:
          "We look at the attic as a system first so the recommendation fits the home instead of being forced into every project."
      },
      {
        question: "Can attic fans work alongside other attic upgrades?",
        answer:
          "Yes. They are often most valuable when they support a broader comfort and performance plan."
      }
    ],
    related: ["attic-air-sealing", "attic-insulation", "insulation-removal"],
    marketIntro: {
      "salt-lake-city-ut":
        "Good Attic installs attic fan solutions in Salt Lake City to help reduce attic heat buildup and support better attic performance when the house is a good fit.",
      "st-louis-mo":
        "Good Attic provides attic fan solutions in St. Louis to help manage attic heat buildup and support better attic airflow through the hottest part of the year.",
      "kansas-city-mo":
        "Good Attic installs attic fan solutions in Kansas City to help reduce attic heat buildup and support better attic airflow when the attic needs more support."
    },
    marketReason: {
      "salt-lake-city-ut":
        "Salt Lake attics can take on significant heat in summer, so ventilation support matters most when it is tied into the rest of the attic plan.",
      "st-louis-mo":
        "St. Louis homeowners often notice the attic heat problem first on muggy summer days when second floors start falling behind.",
      "kansas-city-mo":
        "Kansas City attics can hold onto a surprising amount of heat, which is why fan conversations often come up alongside insulation and air sealing."
    }
  },
  {
    slug: "attic-air-sealing",
    name: "Attic Air Sealing",
    summary: "Stop conditioned air from leaking into the attic and dusty attic air from drifting back into the home.",
    image: "assets/attic-air-sealing.png",
    heroHeading: "Small attic leaks add up to major comfort and air quality loss.",
    heroText:
      "Attic air sealing closes the bypasses and penetrations that quietly waste energy and move dusty attic air toward the living space.",
    symptoms: [
      {
        title: "Drafts and uneven temperatures",
        text: "The attic floor can leak more air than homeowners expect, especially around fixtures, pipes, chases, and framing gaps."
      },
      {
        title: "Dust or attic smell in the home",
        text: "Open pathways between the house and attic can pull attic contaminants into the conditioned space."
      },
      {
        title: "Insulation underperforms",
        text: "Even decent insulation can struggle if airflow is moving through or around it constantly."
      }
    ],
    rightFit: [
      {
        title: "You want the attic boundary tightened up",
        text: "Sealing is often one of the cleanest ways to help comfort and efficiency at the same time."
      },
      {
        title: "The attic already shows obvious bypasses",
        text: "Pipe penetrations, fixture gaps, and open chases can add up quickly."
      },
      {
        title: "You want insulation to perform better",
        text: "A sealed attic floor gives the insulation layer a better chance to do its job."
      }
    ],
    process: [
      "Identify the leakage points that matter most in the attic floor and ceiling plane.",
      "Seal the openings with the right materials for the condition and location.",
      "Layer that sealing work into the broader attic plan so comfort and efficiency hold."
    ],
    faq: [
      {
        question: "Does attic air sealing still matter if I already have insulation?",
        answer:
          "Yes. Insulation and sealing do different jobs, and many comfort complaints involve both."
      },
      {
        question: "What kinds of openings get sealed?",
        answer:
          "Common targets include pipe penetrations, wiring openings, top-plate gaps, fixture penetrations, and other bypasses between the house and attic."
      },
      {
        question: "Can air sealing help with dust or odors too?",
        answer:
          "It can. Closing attic leakage paths can reduce how easily dusty or stale attic air moves into the living space."
      }
    ],
    related: ["attic-insulation", "insulation-removal", "attic-fans"],
    marketIntro: {
      "salt-lake-city-ut":
        "Stop attic air leaks in Salt Lake City with attic air sealing designed to improve comfort, efficiency, and year-round attic performance.",
      "st-louis-mo":
        "Good Attic helps St. Louis homeowners reduce attic air leaks that contribute to comfort problems, wasted energy, and stale attic air drift.",
      "kansas-city-mo":
        "Good Attic helps Kansas City homeowners stop attic air leaks that contribute to comfort issues, energy waste, and underperforming attic upgrades."
    },
    marketReason: {
      "salt-lake-city-ut":
        "Air sealing matters in Salt Lake because the attic has to manage both winter heat loss and dusty summer heat gain without leaking the home into the attic.",
      "st-louis-mo":
        "St. Louis homes, especially older ones, often need sealing as much as insulation depth if the goal is steadier comfort.",
      "kansas-city-mo":
        "Kansas City homes often show the benefits of air sealing quickly because seasonal swings expose every hidden leak in the attic floor."
    }
  }
];

const marketCatalog = [
  {
    slug: "salt-lake-city-ut",
    name: "Salt Lake City, UT",
    shortName: "Salt Lake City",
    state: "UT",
    primaryKeyword: "attic services salt lake city",
    secondaryKeywords: [
      "attic company salt lake city",
      "attic insulation company salt lake city",
      "attic cleanup salt lake city"
    ],
    seoTitle: "Attic Services in Salt Lake City, UT | Good Attic",
    metaDescription:
      "Good Attic provides attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing in Salt Lake City.",
    h1: "Attic Services in Salt Lake City, UT",
    intro:
      "In Salt Lake City, attic problems usually show up as hot upstairs rooms in summer, expensive heating bills in winter, or old insulation that is dusty, dirty, or no longer doing its job. Good Attic helps homeowners solve those problems with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
    commonProblems: [
      {
        title: "Seasonal comfort swings",
        text: "Hot summers and cold winters make attic performance hard to ignore when the top of the house feels unstable."
      },
      {
        title: "Dusty or aging insulation",
        text: "Older attic insulation may still be present, but no longer doing enough to support comfort and efficiency."
      },
      {
        title: "Air leakage and attic bypasses",
        text: "A leaking attic floor can waste energy and move dusty attic air where it does not belong."
      },
      {
        title: "Pest-contaminated attic material",
        text: "Rodent activity can turn a comfort issue into a cleanup and restoration issue quickly."
      }
    ],
    whyHeading: "Why Salt Lake City homes need a strong attic strategy",
    whyText:
      "Salt Lake City homes deal with both hot summers and cold winters, which means the attic has to manage heat gain and heat loss without drifting out of balance. In many homes, the best result comes from looking at insulation, cleanup, sealing, and ventilation together instead of as disconnected upgrades.",
    trustElements: [
      "Photo-forward attic assessments",
      "Whole-attic scopes instead of one-line guesses",
      "Premium cleanup and installation standards"
    ],
    faq: [
      {
        question: "Why is my upstairs hotter than the rest of the house in Salt Lake City?",
        answer:
          "That usually points back to the attic. Low insulation performance, air leakage, and trapped attic heat can all show up first in the upper rooms."
      },
      {
        question: "Should old attic insulation be removed or topped off?",
        answer:
          "It depends on condition. If the existing material is clean and still worth building on, a top-off may work. If it is contaminated or broken down, removal is usually the smarter move."
      },
      {
        question: "Can you help if rodents have been in the attic?",
        answer:
          "Yes. Many attic projects start with cleanup, sanitation, and removal work after pest activity has damaged the space."
      }
    ],
    supportCities: [
      {
        slug: "west-jordan-ut",
        name: "West Jordan, UT",
        shortName: "West Jordan",
        intro:
          "In West Jordan, attic problems often show up as hot second-floor bedrooms, uncomfortable rooms above the garage, and AC systems that seem to run all day in summer. Good Attic helps West Jordan homeowners solve those issues with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
        commonProblems: [
          {
            title: "Hot upstairs bedrooms",
            text: "Broad roof exposure and two-story layouts can make the top floor feel much warmer than the level below."
          },
          {
            title: "Rooms above garages lag behind",
            text: "Bonus spaces and front-facing rooms often show attic performance issues first."
          },
          {
            title: "Builder-grade attic performance",
            text: "Even when insulation is technically there, it may not be doing enough for long-term comfort."
          }
        ],
        whyCall: [
          "Homeowners want the upstairs to feel like the rest of the house instead of its own climate zone.",
          "A cleaner attic strategy often beats chasing comfort with thermostat changes alone.",
          "Insulation, sealing, and ventilation can work together without turning the project into a remodel."
        ],
        faq: [
          {
            question: "Do newer West Jordan homes still need attic upgrades?",
            answer:
              "Yes. Plenty of newer homes still have builder-grade insulation, uneven comfort, or airflow issues that are worth correcting."
          },
          {
            question: "Can you help with a room above the garage that never feels right?",
            answer:
              "Yes. That is one of the most common attic-related comfort complaints in suburban two-story homes."
          },
          {
            question: "Will an attic fan help with a hot upstairs?",
            answer:
              "Sometimes. It depends on the attic condition as a whole, which is why we look at the entire attic plan before forcing a product."
          }
        ]
      },
      {
        slug: "sandy-ut",
        name: "Sandy, UT",
        shortName: "Sandy",
        intro:
          "In Sandy, attic issues often show up as upstairs rooms that never feel quite right, winter heat loss that creeps into utility bills, or older attic material that no longer performs the way it should. Good Attic helps Sandy homeowners solve those problems with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
        commonProblems: [
          {
            title: "Year-round comfort imbalance",
            text: "Sandy homes can feel too warm in upper rooms during summer and harder to hold heat in winter."
          },
          {
            title: "Aging attic material",
            text: "Older insulation may still be visible but no longer delivering the comfort people expect."
          },
          {
            title: "Leakage at the attic floor",
            text: "Attic bypasses can quietly drain comfort and allow dusty attic air to move into the home."
          }
        ],
        whyCall: [
          "Homeowners want steadier comfort without guessing at whether the attic is actually the problem.",
          "The attic often needs a better boundary, not just more material in random spots.",
          "A coordinated cleanup, sealing, and insulation plan can make the whole house feel calmer."
        ],
        faq: [
          {
            question: "Can attic work help with uneven temperatures in Sandy homes?",
            answer:
              "Yes. Uneven comfort is one of the most common reasons people call, especially when the upper floor behaves differently than the rest of the house."
          },
          {
            question: "Do you handle dirty insulation too?",
            answer:
              "Yes. If the attic needs removal or cleanup before it is upgraded, that can be part of the plan."
          },
          {
            question: "What if I am not sure whether the issue is insulation or air leaks?",
            answer:
              "That is exactly why the attic needs a real assessment first. The right plan usually comes from seeing the whole space together."
          }
        ]
      },
      {
        slug: "draper-ut",
        name: "Draper, UT",
        shortName: "Draper",
        intro:
          "In Draper, homeowners often call when larger homes, broad rooflines, or exposed upper levels make comfort harder to keep consistent from room to room. Good Attic helps Draper homeowners solve those attic-driven issues with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
        commonProblems: [
          {
            title: "Upper-level heat gain",
            text: "Larger homes and exposed attic volume can make heat buildup harder to ignore."
          },
          {
            title: "Premium homes with uneven comfort",
            text: "The size of the home does not protect it from attic underperformance."
          },
          {
            title: "Attics that need a complete strategy",
            text: "Comfort improvements often work best when removal, sealing, insulation, and ventilation are evaluated together."
          }
        ],
        whyCall: [
          "Homeowners want premium execution that matches the home, not a rushed one-line fix.",
          "Bigger homes often need more coordination between attic systems to perform well.",
          "The right attic scope should feel clear, clean, and confidence-building from the start."
        ],
        faq: [
          {
            question: "Do larger Draper homes still have attic comfort issues?",
            answer:
              "Yes. Large homes can still struggle with upper-level heat, uneven temperatures, and attic leakage if the attic plan is not working well."
          },
          {
            question: "Can you handle a full attic reset if needed?",
            answer:
              "Yes. Many projects involve removal, sanitation, sealing, and re-installation work as one coordinated scope."
          },
          {
            question: "Are attic fans only for older homes?",
            answer:
              "No. Fan solutions can help any home when the attic is a real fit for that kind of ventilation support."
          }
        ]
      },
      {
        slug: "american-fork-ut",
        name: "American Fork, UT",
        shortName: "American Fork",
        intro:
          "In American Fork, attic problems often show up as year-round comfort issues, dusty or aging insulation, and utility costs that feel out of step with the home. Good Attic helps American Fork homeowners solve those attic problems with insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "Seasonal inefficiency",
            text: "The attic can amplify both summer heat gain and winter heat loss when the system is underperforming."
          },
          {
            title: "Dirty or settled insulation",
            text: "Aged material may still be present but no longer doing enough to support the house."
          },
          {
            title: "Rooms that never feel finished",
            text: "Comfort complaints often point back to what is happening above the ceiling rather than in the living space."
          }
        ],
        whyCall: [
          "Homeowners want clarity on whether the attic needs a top-off, cleanup, or full reset.",
          "A cleaner attic can improve comfort, efficiency, and how confident people feel about the home.",
          "The project should be measured and documented, not improvised in the attic."
        ],
        faq: [
          {
            question: "Can you help if the attic feels more dirty than under-insulated?",
            answer:
              "Yes. Dirty, contaminated, or damaged attic material can be the first issue to solve before insulation upgrades even start."
          },
          {
            question: "Do you serve American Fork directly from the Salt Lake market?",
            answer:
              "Yes. American Fork is supported through the Salt Lake City market hub and the same Good Attic system."
          },
          {
            question: "What is the best next step if I am not sure what the attic needs?",
            answer:
              "A documented attic assessment is the cleanest place to start. It tells us whether the attic needs cleanup, sealing, insulation, or a combination."
          }
        ]
      },
      {
        slug: "herriman-ut",
        name: "Herriman, UT",
        shortName: "Herriman",
        intro:
          "In Herriman, attic problems often show up in newer two-story homes as hot upstairs rooms, rooms over garages that lag behind the rest of the house, and builder-grade attic performance that never quite feels finished. Good Attic helps Herriman homeowners solve those issues with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
        commonProblems: [
          {
            title: "Hot upstairs comfort in newer homes",
            text: "Even newer attic systems can leave upper bedrooms and loft spaces warmer than the level below."
          },
          {
            title: "Rooms over garages feel disconnected",
            text: "Garage-adjacent rooms often reveal attic weakness faster than the rest of the house."
          },
          {
            title: "Builder-grade attic results",
            text: "Insulation may be present without delivering the steadiness homeowners expected from the home."
          }
        ],
        whyCall: [
          "Homeowners want more than the minimum attic performance they inherited from the original build.",
          "A whole-attic plan often fixes comfort complaints better than thermostat adjustments or trial-and-error upgrades.",
          "The right attic scope should make a newer home feel more complete, not just more expensive."
        ],
        faq: [
          {
            question: "Do newer Herriman homes still need attic upgrades?",
            answer:
              "Yes. Newer homes can still have thin coverage, leakage, or heat-management issues that show up clearly in upstairs comfort complaints."
          },
          {
            question: "Can you help with a room over the garage that never matches the rest of the house?",
            answer:
              "Yes. That is one of the most common attic-related problems in newer suburban layouts."
          },
          {
            question: "What if I only know the upstairs is uncomfortable?",
            answer:
              "That is enough to start. The attic assessment helps separate whether the bigger issue is insulation, air sealing, heat buildup, or a combination."
          }
        ]
      },
      {
        slug: "holladay-ut",
        name: "Holladay, UT",
        shortName: "Holladay",
        intro:
          "In Holladay, homeowners often call when valuable established homes have upstairs comfort drift, aging attic material, or attic conditions that deserve a cleaner premium-level reset. Good Attic helps Holladay homeowners solve those issues with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
        commonProblems: [
          {
            title: "Established-home attic aging",
            text: "Older insulation and attic details can slowly lose performance until comfort and utility costs make the problem obvious."
          },
          {
            title: "Upper-floor temperature drift",
            text: "Warm upper rooms in summer and weaker heat retention in winter often point back to the attic system."
          },
          {
            title: "Attics that need a cleaner finish standard",
            text: "Higher-value homes often deserve a more measured attic plan than a basic top-off guess."
          }
        ],
        whyCall: [
          "Homeowners want attic work that respects the quality of the home instead of treating it like a quick commodity job.",
          "A whole-attic approach helps older homes feel steadier without skipping cleanup or boundary questions.",
          "The attic scope should feel documented, premium, and worth trusting from the start."
        ],
        faq: [
          {
            question: "Do older Holladay homes often need more than added insulation?",
            answer:
              "Yes. Many attics need cleanup, sealing, or a broader reset before more insulation becomes the honest finish line."
          },
          {
            question: "Can attic upgrades help with both comfort and energy waste?",
            answer:
              "Yes. Those two issues often travel together when the attic has been underperforming for years."
          },
          {
            question: "Do you handle premium homes that need a cleaner attic strategy?",
            answer:
              "Yes. Good Attic is built around a more measured and homeowner-friendly attic experience, especially when the home deserves higher execution standards."
          }
        ]
      },
      {
        slug: "millcreek-ut",
        name: "Millcreek, UT",
        shortName: "Millcreek",
        intro:
          "In Millcreek, attic issues often show up as older-home comfort problems, dusty or settled insulation, and attics that need clearer cleanup or air-sealing decisions before the next step is obvious. Good Attic helps Millcreek homeowners solve those attic problems with insulation, removal, pest remediation, fans, and air sealing.",
        commonProblems: [
          {
            title: "Older-home insulation drift",
            text: "Aging attic material can still be present while no longer doing enough for real comfort."
          },
          {
            title: "Dusty attic conditions",
            text: "Dirty insulation and attic debris often make the space feel less healthy and less trustworthy."
          },
          {
            title: "Leaky attic boundaries",
            text: "Attic bypasses can quietly move air, energy, and dust in ways homeowners feel before they fully understand."
          }
        ],
        whyCall: [
          "Homeowners want to know whether the attic needs a top-off, a cleanup, or a more complete reset.",
          "Millcreek homes often benefit from a better attic boundary, not just more material.",
          "A documented attic plan helps people move forward without guessing between services."
        ],
        faq: [
          {
            question: "Can you help with dirty insulation in an older Millcreek attic?",
            answer:
              "Yes. If the attic material is dirty, damaged, or no longer worth building on, removal and cleanup can be part of the plan."
          },
          {
            question: "Does air sealing matter in older homes with insulation already present?",
            answer:
              "Often, yes. Many older homes still leak enough at the attic floor that sealing becomes part of the honest scope."
          },
          {
            question: "What if the attic seems like both a comfort and a cleanup problem?",
            answer:
              "That is common. The attic assessment helps determine whether the homeowner needs insulation, removal, sealing, or a coordinated combination."
          }
        ]
      },
      {
        slug: "cottonwood-heights-ut",
        name: "Cottonwood Heights, UT",
        shortName: "Cottonwood Heights",
        intro:
          "In Cottonwood Heights, homeowners often notice attic problems through upper-floor heat gain, winter comfort drift, and attic systems that have to work across larger homes and changing roof exposures. Good Attic helps Cottonwood Heights homeowners solve those issues with insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "Upper-level heat exposure",
            text: "Roof exposure and upper-floor design can make attic underperformance show up quickly in warmer months."
          },
          {
            title: "Year-round comfort inconsistency",
            text: "The attic can struggle with both summer heat gain and winter heat loss when the system is not balanced well."
          },
          {
            title: "Attics that need coordinated improvements",
            text: "Comfort, boundary, and insulation issues often overlap instead of showing up one at a time."
          }
        ],
        whyCall: [
          "Homeowners want attic corrections that improve comfort without oversimplifying the house.",
          "A stronger attic system can make multi-level homes feel more stable room to room.",
          "The right recommendation should connect insulation, sealing, cleanup, and heat-management support when the attic truly needs it."
        ],
        faq: [
          {
            question: "Can attic work help with upper rooms that run warmer than the rest of the house?",
            answer:
              "Yes. That is one of the clearest attic-driven complaints in homes with more roof exposure and upper-level living areas."
          },
          {
            question: "Do you handle attics that need more than one upgrade at the same time?",
            answer:
              "Yes. Many projects involve a combination of cleanup, sealing, insulation, and sometimes ventilation support."
          },
          {
            question: "What if I want the attic done right the first time instead of in stages?",
            answer:
              "That is exactly why Good Attic treats the attic as a system and builds the scope around the documented conditions."
          }
        ]
      },
      {
        slug: "sugar-house-ut",
        name: "Sugar House, UT",
        shortName: "Sugar House",
        intro:
          "In Sugar House, attic problems often show up in older homes as uneven room comfort, aging insulation, and attic conditions that need more care than a simple add-on insulation bid. Good Attic helps Sugar House homeowners solve those issues with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
        commonProblems: [
          {
            title: "Older-home comfort drift",
            text: "Upper rooms can feel warmer, draftier, or less stable when the attic system has aged out."
          },
          {
            title: "Settled or dusty insulation",
            text: "Older attic material may still be visible without still performing at a level the homeowner can feel."
          },
          {
            title: "Attics that deserve a more careful scope",
            text: "Established homes often need more inspection and sequencing before the best solution becomes obvious."
          }
        ],
        whyCall: [
          "Homeowners want attic work that fits the age and character of the home instead of treating it like a tract-house shortcut.",
          "Older homes often need a clearer boundary and cleaner attic story before the final insulation layer belongs.",
          "The project should improve comfort and confidence in the house at the same time."
        ],
        faq: [
          {
            question: "Do older Sugar House homes often need more than added insulation?",
            answer:
              "Yes. Many older attics need cleanup, air sealing, or a more complete reset before additional insulation becomes the right finish step."
          },
          {
            question: "Can attic work help with rooms that never quite feel right year-round?",
            answer:
              "Yes. Uneven comfort is one of the most common symptoms that points back to the attic in older homes."
          },
          {
            question: "Do you handle attic cleanup and restoration in addition to insulation?",
            answer:
              "Yes. Good Attic handles cleanup, removal, remediation, and rebuild work when the attic needs more than a simple upgrade."
          }
        ]
      },
      {
        slug: "south-jordan-ut",
        name: "South Jordan, UT",
        shortName: "South Jordan",
        intro:
          "In South Jordan, attic issues often show up in newer suburban homes as upstairs comfort complaints, rooms over garages that never balance well, and attic systems that are technically present but not performing the way the homeowner expected. Good Attic helps South Jordan homeowners solve those problems with insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "Second-floor comfort issues",
            text: "Upper bedrooms and loft spaces often feel the attic system's weaknesses before the rest of the house does."
          },
          {
            title: "Builder-grade attic shortcuts",
            text: "Insulation depth or attic detailing may not be enough to create the steady comfort people thought they were buying."
          },
          {
            title: "Garage-adjacent room complaints",
            text: "Bonus rooms over garages frequently reveal where the attic plan needs more support."
          }
        ],
        whyCall: [
          "Homeowners want more refined attic performance than a basic new-build standard delivered.",
          "A whole-attic plan can fix hot-room complaints better than chasing the thermostat or the HVAC alone.",
          "The right scope should feel clean, modern, and well-documented from the first visit."
        ],
        faq: [
          {
            question: "Can newer South Jordan homes still benefit from attic upgrades?",
            answer:
              "Yes. Newer homes can still have thin coverage, leakage, or attic heat-management issues that show up in daily comfort."
          },
          {
            question: "What if one upstairs room always feels worse than the others?",
            answer:
              "That is a common attic symptom, especially in rooms over garages or at the hottest part of the upper floor."
          },
          {
            question: "Do you help if I am not sure whether the issue is insulation or air sealing?",
            answer:
              "Yes. The attic assessment helps determine whether the real issue is coverage, leakage, heat buildup, or a combination."
          }
        ]
      }
    ]
  },
  {
    slug: "st-louis-mo",
    name: "St. Louis, MO",
    shortName: "St. Louis",
    state: "MO",
    primaryKeyword: "attic services st louis",
    secondaryKeywords: ["attic company st louis", "attic specialists st louis", "attic cleanup st louis"],
    seoTitle: "Attic Services in St. Louis, MO | Good Attic",
    metaDescription:
      "Good Attic helps St. Louis homeowners with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
    h1: "Attic Services in St. Louis, MO",
    intro:
      "In St. Louis, attic problems usually show up as hot second floors in summer, drafty rooms in winter, or old attic insulation that is dirty, musty, damaged, or no longer performing well. Good Attic helps homeowners solve those problems with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
    commonProblems: [
      {
        title: "Hot, humid upper floors",
        text: "Mixed-humid summers put attic heat and upstairs comfort on full display in many St. Louis homes."
      },
      {
        title: "Cold-weather heat loss",
        text: "Winter drafts and weak attic performance can make older homes harder to keep comfortable."
      },
      {
        title: "Musty or aging insulation",
        text: "Older attics can collect dust, moisture history, and material that is no longer worth building on."
      },
      {
        title: "Pest contamination",
        text: "Squirrels, mice, and other attic pests can turn a comfort problem into a cleanup project quickly."
      }
    ],
    whyHeading: "Why St. Louis homes need a whole-attic approach",
    whyText:
      "St. Louis homes have to handle both humid summers and cold winter swings, which means comfort issues rarely come from one simple cause. In older homes and 1.5-story homes especially, the best result often comes from cleaning up the attic, tightening the boundary, and rebuilding the space as one coordinated plan.",
    trustElements: [
      "Attic-first diagnostics for older homes",
      "Cleanup, sealing, and insulation handled as one plan",
      "Clear homeowner communication from scope to finish"
    ],
    faq: [
      {
        question: "Why is my second floor so hot in summer?",
        answer:
          "That is one of the most common attic-related complaints in St. Louis. Heat buildup, weak insulation, and air leakage often all play a role."
      },
      {
        question: "Does attic work help in winter too?",
        answer:
          "Yes. The same attic that drives summer discomfort can also be responsible for winter drafts and heat loss."
      },
      {
        question: "Can you help after rodents or squirrels have been in the attic?",
        answer:
          "Yes. Attic pest remediation, removal, sanitation, and rebuild work are all part of the Good Attic system."
      }
    ],
    supportCities: [
      {
        slug: "chesterfield-mo",
        name: "Chesterfield, MO",
        shortName: "Chesterfield",
        intro:
          "In Chesterfield, homeowners often call when larger suburban homes have upstairs comfort issues, high seasonal energy bills, or attics that clearly need more than a quick insulation guess. Good Attic helps Chesterfield homeowners solve those attic issues with attic insulation, removal, pest remediation, fans, and air sealing.",
        commonProblems: [
          {
            title: "Large-home comfort drift",
            text: "When the attic is underperforming, bigger homes often feel the difference most in upper rooms and long hallways."
          },
          {
            title: "Summer attic heat load",
            text: "Suburban homes with broad roof exposure can build serious heat in the attic during St. Louis summers."
          },
          {
            title: "Energy waste at scale",
            text: "A weak attic boundary in a larger home can quietly add a lot of HVAC strain."
          }
        ],
        whyCall: [
          "Homeowners want attic work that feels premium and coordinated, not pieced together.",
          "Larger homes usually benefit from a whole-attic plan instead of one isolated upgrade.",
          "Comfort, cleanup, and performance should all improve together."
        ],
        faq: [
          {
            question: "Do you work on larger Chesterfield homes?",
            answer:
              "Yes. Larger homes still benefit from the same attic fundamentals, but the scope often needs more coordination."
          },
          {
            question: "Can attic work help lower seasonal energy waste?",
            answer:
              "Yes. When the attic is underperforming, improving insulation, sealing, and cleanup can help the whole house run more steadily."
          },
          {
            question: "Do you serve Chesterfield from the St. Louis market hub?",
            answer:
              "Yes. Chesterfield is supported through the St. Louis market and the same Good Attic process."
          }
        ]
      },
      {
        slug: "st-charles-mo",
        name: "St. Charles, MO",
        shortName: "St. Charles",
        intro:
          "In St. Charles, attic problems often show up across both older homes and newer suburban properties as hot upstairs rooms, dusty insulation, or attics that need a cleaner reset after years of wear. Good Attic helps St. Charles homeowners solve those problems with attic insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "Older-home attic drift",
            text: "Aging attics often hold onto settled insulation, leakage, and comfort problems that have slowly become normal."
          },
          {
            title: "Mixed-age housing stock",
            text: "The right solution changes from home to home, which is why attic scopes need to be measured rather than assumed."
          },
          {
            title: "Cleanup plus performance needs",
            text: "Dirty attics and comfort complaints often show up together, not separately."
          }
        ],
        whyCall: [
          "Homeowners want help deciding whether the attic needs removal, sealing, insulation, or all three.",
          "A whole-attic strategy works better than patching one symptom at a time.",
          "The project should improve confidence in the house as well as comfort."
        ],
        faq: [
          {
            question: "Can you help with old insulation in an older St. Charles home?",
            answer:
              "Yes. Older attics are one of the most common reasons homeowners call, especially when the material is dirty, settled, or no longer helping enough."
          },
          {
            question: "What if the attic also has pest contamination?",
            answer:
              "That can be part of the same scope. Removal, sanitation, and restoration are often handled together."
          },
          {
            question: "Do newer homes still benefit from attic upgrades?",
            answer:
              "Yes. Newer homes can still have builder-grade performance or comfort issues that point back to the attic."
          }
        ]
      },
      {
        slug: "ballwin-mo",
        name: "Ballwin, MO",
        shortName: "Ballwin",
        intro:
          "In Ballwin, families often notice attic issues through rooms that feel too hot, too cold, or just harder to keep stable than the rest of the house. Good Attic helps Ballwin homeowners solve those attic problems with insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "Family-home comfort complaints",
            text: "Upper bedrooms and bonus spaces often show attic performance problems first."
          },
          {
            title: "Aging insulation and leakage",
            text: "The attic can lose effectiveness slowly over time until comfort and utility bills finally make it obvious."
          },
          {
            title: "Dusty attic conditions",
            text: "Older attic material can affect how clean and healthy the space feels, not just how well it insulates."
          }
        ],
        whyCall: [
          "Homeowners want a cleaner, better-documented attic plan instead of guesswork.",
          "A stable attic can help the entire home feel more predictable day to day.",
          "The right scope can improve comfort without creating a messy homeowner experience."
        ],
        faq: [
          {
            question: "Does attic insulation help hot upstairs rooms in Ballwin?",
            answer:
              "Often, yes, especially when insulation is paired with air sealing and other attic corrections that support the full system."
          },
          {
            question: "Can you remove old insulation before starting over?",
            answer:
              "Yes. If the attic needs a clean reset, removal can be part of the coordinated plan."
          },
          {
            question: "Do you help with attic odor or dust issues too?",
            answer:
              "Yes. Dirty, contaminated, or aging insulation often affects both comfort and how the attic environment feels."
          }
        ]
      },
      {
        slug: "o-fallon-mo",
        name: "O'Fallon, MO",
        shortName: "O'Fallon",
        intro:
          "In O'Fallon, homeowners often deal with builder-grade attic performance, summer attic heat, and upstairs rooms that never quite settle into the same comfort as the rest of the house. Good Attic helps O'Fallon homeowners solve those issues with insulation, removal, pest remediation, fans, and air sealing.",
        commonProblems: [
          {
            title: "Builder-grade attic performance",
            text: "Newer suburban homes can still struggle with comfort if the attic system is only doing the minimum."
          },
          {
            title: "Overheated upper floors",
            text: "Broad suburban roof exposure can make attic heat show up quickly in bedrooms and bonus rooms."
          },
          {
            title: "Inconsistent energy performance",
            text: "When the attic boundary is weak, the HVAC system ends up working harder than it should."
          }
        ],
        whyCall: [
          "Homeowners want a premium fix for comfort problems that builder-grade insulation did not fully solve.",
          "The attic often needs better coordination between insulation, sealing, and ventilation support.",
          "A clean process matters just as much as the final material choice."
        ],
        faq: [
          {
            question: "Do newer O'Fallon homes still need attic upgrades?",
            answer:
              "Yes. Newer homes can still have insulation depth, leakage, or heat-management issues that show up quickly on the upper floor."
          },
          {
            question: "Can attic fans help in O'Fallon?",
            answer:
              "They can when the attic is a good fit. The right answer depends on how the whole attic system is behaving."
          },
          {
            question: "What if I just know the upstairs is uncomfortable?",
            answer:
              "That is enough to start. The attic assessment is there to separate the real causes from the symptoms."
          }
        ]
      },
      {
        slug: "st-peters-mo",
        name: "St. Peters, MO",
        shortName: "St. Peters",
        intro:
          "In St. Peters, attic problems often show up in suburban family homes as upstairs heat, underperforming insulation, and attic systems that need a cleaner plan than a basic top-off. Good Attic helps St. Peters homeowners solve those issues with attic insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "Upper-floor comfort complaints",
            text: "Bedrooms and bonus spaces often reveal attic weakness first in warm and cold weather alike."
          },
          {
            title: "Builder-grade or aging attic performance",
            text: "Some homes need more than the original attic standard to feel stable year-round."
          },
          {
            title: "Insulation that looks present but underperforms",
            text: "Coverage can still be visible while no longer supporting comfort the way homeowners expect."
          }
        ],
        whyCall: [
          "Homeowners want a more measured attic correction than just piling on more material.",
          "A whole-attic strategy often solves comfort complaints more cleanly than isolated upgrades.",
          "The project should improve both the feel of the home and confidence in the attic itself."
        ],
        faq: [
          {
            question: "Do newer St. Peters homes still need attic upgrades?",
            answer:
              "Yes. Newer suburban homes can still have attic depth, leakage, or comfort issues that deserve a closer look."
          },
          {
            question: "Can attic work help with upstairs rooms that never settle into the same comfort as the rest of the house?",
            answer:
              "Yes. That is one of the most common attic-related complaints in suburban two-story homes."
          },
          {
            question: "What if I am not sure whether the attic needs insulation, sealing, or both?",
            answer:
              "That is exactly what the attic assessment is meant to clarify before the scope gets oversimplified."
          }
        ]
      },
      {
        slug: "clayton-mo",
        name: "Clayton, MO",
        shortName: "Clayton",
        intro:
          "In Clayton, attic problems often show up in older, higher-value homes as uneven comfort, aging insulation, and attic conditions that deserve a more careful premium-level plan. Good Attic helps Clayton homeowners solve those issues with insulation, removal, pest remediation, fans, and air sealing.",
        commonProblems: [
          {
            title: "Older-home attic aging",
            text: "Attic material and boundary details can slowly drift out of modern performance even in otherwise valuable homes."
          },
          {
            title: "Upper-floor temperature imbalance",
            text: "Warm upper rooms, draftier winter comfort, and room-to-room inconsistency often trace back to the attic."
          },
          {
            title: "Attics that need a cleaner, more deliberate scope",
            text: "Established homes often deserve more inspection and sequencing than a generic insulation-only recommendation."
          }
        ],
        whyCall: [
          "Homeowners want attic work that matches the quality and expectations of the home.",
          "A more complete attic strategy often makes more sense than a small patch when comfort and cleanup issues overlap.",
          "The recommendation should feel earned through documentation, not pushed through generic sales language."
        ],
        faq: [
          {
            question: "Do older Clayton homes often need more than extra insulation?",
            answer:
              "Yes. Many older attics also need cleanup, air sealing, or a fuller reset before the final insulation layer belongs."
          },
          {
            question: "Can attic work improve both comfort and long-term efficiency in established homes?",
            answer:
              "Yes. Those outcomes often come together when the attic is corrected as a system instead of as a one-line upgrade."
          },
          {
            question: "Do you handle premium homes that need a cleaner attic strategy?",
            answer:
              "Yes. Good Attic is built around a more measured and homeowner-friendly attic process when the home deserves higher execution standards."
          }
        ]
      },
      {
        slug: "des-peres-mo",
        name: "Des Peres, MO",
        shortName: "Des Peres",
        intro:
          "In Des Peres, homeowners often call when higher-value homes have upstairs comfort drift, aging or dirty attic material, and attic systems that need more than a quick insulation guess. Good Attic helps Des Peres homeowners solve those issues with insulation, removal, pest remediation, fans, and air sealing.",
        commonProblems: [
          {
            title: "Large-home upper-floor drift",
            text: "Broader rooflines and larger layouts can make attic weakness show up clearly upstairs."
          },
          {
            title: "Attic systems that have aged unevenly",
            text: "Insulation can still be present while no longer supporting the comfort and consistency the home needs."
          },
          {
            title: "Cleaner finish standards matter more",
            text: "Higher-value homes often deserve a more coordinated attic plan rather than a rushed product recommendation."
          }
        ],
        whyCall: [
          "Homeowners want attic work that feels premium, documented, and worth trusting.",
          "Comfort, cleanup, and energy performance often need to improve together in larger established homes.",
          "The attic should feel more resolved afterward, not just fuller."
        ],
        faq: [
          {
            question: "Do larger Des Peres homes often need a whole-attic plan?",
            answer:
              "Yes. Larger homes frequently benefit from better coordination between insulation, sealing, cleanup, and heat-management support."
          },
          {
            question: "Can attic work help with both comfort complaints and higher utility strain?",
            answer:
              "Yes. Those problems often show up together when the attic system is underperforming."
          },
          {
            question: "What if the attic needs removal or cleanup before new insulation?",
            answer:
              "That can absolutely be part of the right scope. Good Attic handles removal and restoration when the attic needs a cleaner reset first."
          }
        ]
      },
      {
        slug: "frontenac-mo",
        name: "Frontenac, MO",
        shortName: "Frontenac",
        intro:
          "In Frontenac, attic issues often show up in premium homes as upper-level comfort inconsistency, aging attic material, and attic systems that need more deliberate planning than a simple add-on insulation bid. Good Attic helps Frontenac homeowners solve those issues with insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "High-expectation comfort problems",
            text: "Even valuable homes can still struggle with upper-level temperature drift when the attic is underperforming."
          },
          {
            title: "Aging attic systems in established homes",
            text: "Older insulation and attic details often need more careful correction than they appear to at first glance."
          },
          {
            title: "Attics that deserve premium execution",
            text: "Cleaner finish quality and better documentation matter more when the home itself is held to a higher standard."
          }
        ],
        whyCall: [
          "Homeowners want attic recommendations that feel tailored to the home rather than rushed.",
          "A more complete attic scope often makes more sense than a small patch when comfort, cleanliness, and efficiency all matter.",
          "The project should feel calm, documented, and premium from first assessment to final result."
        ],
        faq: [
          {
            question: "Do premium homes in Frontenac still benefit from attic upgrades?",
            answer:
              "Yes. Home value does not prevent insulation drift, attic leakage, or aging attic conditions from affecting comfort."
          },
          {
            question: "Can attic work still matter if the home already seems well-built overall?",
            answer:
              "Yes. The attic can quietly underperform even in otherwise high-quality homes, especially over time."
          },
          {
            question: "Do you handle attics that need a more complete reset rather than a small fix?",
            answer:
              "Yes. Good Attic handles removal, cleanup, sealing, and rebuild work when the attic needs a broader correction."
          }
        ]
      },
      {
        slug: "town-and-country-mo",
        name: "Town and Country, MO",
        shortName: "Town and Country",
        intro:
          "In Town and Country, homeowners often deal with larger-home attic issues like upper-floor comfort drift, summer attic heat, and attic systems that need stronger coordination between insulation, sealing, cleanup, and ventilation support. Good Attic helps Town and Country homeowners solve those issues with insulation, removal, pest remediation, fans, and air sealing.",
        commonProblems: [
          {
            title: "Large-home temperature drift",
            text: "Longer upper floors and broader roof exposure can make attic-related room-to-room differences more obvious."
          },
          {
            title: "Attic heat over complex rooflines",
            text: "Larger homes can expose the limits of a weak attic system faster than smaller layouts."
          },
          {
            title: "Attics that need more coordination",
            text: "Bigger homes often need better sequencing between cleanup, sealing, insulation, and fan support."
          }
        ],
        whyCall: [
          "Homeowners want an attic plan that matches the scale and expectations of the house.",
          "A coordinated attic strategy usually performs better than isolated upgrades in larger homes.",
          "The right scope should improve comfort and attic confidence without feeling improvised."
        ],
        faq: [
          {
            question: "Do larger Town and Country homes often need more than insulation alone?",
            answer:
              "Yes. Larger homes often benefit from a fuller attic plan that also addresses cleanup, sealing, or ventilation support."
          },
          {
            question: "Can attic work help with both hot upper rooms and winter comfort drift?",
            answer:
              "Yes. The same attic system can influence comfort in both seasons when it is not performing as well as it should."
          },
          {
            question: "Do you work on premium homes that need a clearer attic strategy?",
            answer:
              "Yes. Good Attic is designed to bring clearer documentation and better sequencing to more demanding attic projects."
          }
        ]
      },
      {
        slug: "wildwood-mo",
        name: "Wildwood, MO",
        shortName: "Wildwood",
        intro:
          "In Wildwood, homeowners often call when larger suburban homes have upstairs comfort issues, attic heat buildup, or attic systems that need a cleaner full-house strategy rather than a one-line upgrade. Good Attic helps Wildwood homeowners solve those attic problems with insulation, removal, pest remediation, fans, and air sealing.",
        commonProblems: [
          {
            title: "Upper-level comfort spread across larger homes",
            text: "Bigger layouts can make attic-related room-to-room differences more obvious and more frustrating."
          },
          {
            title: "Attic heat over broad roof exposure",
            text: "Larger rooflines can increase attic heat and reveal where insulation or airflow support is underperforming."
          },
          {
            title: "Attic systems that need coordinated upgrades",
            text: "Comfort, cleanup, leakage, and insulation questions often arrive together in larger suburban homes."
          }
        ],
        whyCall: [
          "Homeowners want a more complete attic strategy than adding material and hoping it fixes everything.",
          "Larger homes usually benefit from coordinated attic corrections instead of piecemeal work.",
          "The recommendation should feel documented, practical, and appropriate for the home."
        ],
        faq: [
          {
            question: "Can attic work help if the upstairs in a Wildwood home never feels as steady as the rest of the house?",
            answer:
              "Yes. That is one of the most common signs the attic system deserves a closer look."
          },
          {
            question: "Do larger homes ever need removal or cleanup before insulating again?",
            answer:
              "Yes. If the existing attic material is dirty, damaged, or underperforming enough, a cleaner reset can be the better first step."
          },
          {
            question: "What if the attic seems like it needs insulation, sealing, and heat-management help together?",
            answer:
              "That is common in larger homes, and Good Attic is built to sequence those overlapping issues into one clearer plan."
          }
        ]
      }
    ]
  },
  {
    slug: "kansas-city-mo",
    name: "Kansas City, MO",
    shortName: "Kansas City",
    state: "MO",
    primaryKeyword: "attic services kansas city",
    secondaryKeywords: [
      "attic company kansas city",
      "attic specialists kansas city",
      "attic cleanup kansas city"
    ],
    seoTitle: "Attic Services in Kansas City, MO | Good Attic",
    metaDescription:
      "Good Attic provides premium attic services in Kansas City, including attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
    h1: "Attic Services in Kansas City, MO",
    intro:
      "In Kansas City, attic problems often show up as hot upstairs rooms in summer, winter heat loss, and insulation that simply is not keeping up with the house. Good Attic helps homeowners solve those attic problems with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
    commonProblems: [
      {
        title: "Seasonal temperature swings",
        text: "Kansas City homes can feel attic weakness quickly when the weather swings hard in either direction."
      },
      {
        title: "Underperforming insulation",
        text: "Insulation may be present without actually supporting the comfort and efficiency homeowners expect."
      },
      {
        title: "Attic leakage and wasted energy",
        text: "Small bypasses can quietly make the attic boundary work a lot harder than it should."
      },
      {
        title: "Contaminated attic material",
        text: "Pests, dust, and aging insulation can turn a comfort problem into a restoration project."
      }
    ],
    whyHeading: "Why Kansas City homes benefit from attic upgrades",
    whyText:
      "Kansas City homes deal with real seasonal swings, which means attic work has to support both comfort and efficiency over the full year. In many homes, the attic performs better when cleanup, sealing, insulation, and heat-management upgrades are treated as one connected system.",
    trustElements: [
      "Whole-attic planning instead of single-symptom fixes",
      "Clear scope options with homeowner-friendly language",
      "Premium cleanup, installation, and documentation standards"
    ],
    faq: [
      {
        question: "What attic upgrade helps most in Kansas City?",
        answer:
          "That depends on what the attic is doing today. Many projects involve a combination of cleanup, sealing, and insulation rather than one isolated upgrade."
      },
      {
        question: "Can attic work help with both summer and winter comfort?",
        answer:
          "Yes. Kansas City attics often affect the house in both seasons, especially when insulation and air leakage are both part of the picture."
      },
      {
        question: "Do you help with dirty or pest-damaged attics too?",
        answer:
          "Yes. Restoration, removal, and attic pest remediation are all part of the Good Attic system."
      }
    ],
    supportCities: [
      {
        slug: "overland-park-ks",
        name: "Overland Park, KS",
        shortName: "Overland Park",
        intro:
          "In Overland Park, attic issues often show up in larger suburban homes as upstairs comfort problems, attic heat buildup, and energy waste that never seems to match the rest of the house. Good Attic helps Overland Park homeowners solve those problems with insulation, removal, pest remediation, fans, and air sealing.",
        commonProblems: [
          {
            title: "Large-home comfort drift",
            text: "Broad rooflines and bigger floorplans can amplify attic issues upstairs."
          },
          {
            title: "Summer heat load",
            text: "Attic heat can make upper rooms harder to cool even when the HVAC system is running."
          },
          {
            title: "Energy waste at the top of the house",
            text: "When the attic underperforms, the whole home often feels less efficient."
          }
        ],
        whyCall: [
          "Homeowners want the attic to support premium comfort, not fight it.",
          "Bigger homes benefit from coordinated attic planning instead of isolated fixes.",
          "A documented attic scope makes it easier to trust the next step."
        ],
        faq: [
          {
            question: "Do you serve Overland Park through the Kansas City market?",
            answer:
              "Yes. Overland Park is supported through the Kansas City market hub and the same Good Attic process."
          },
          {
            question: "Can attic work help if the upper floor is always warmer?",
            answer:
              "Yes. That is one of the clearest attic-related complaints we see in larger suburban homes."
          },
          {
            question: "What if I am not sure which attic service I need?",
            answer:
              "That is normal. The assessment helps determine whether the attic needs insulation, sealing, removal, cleanup, or a mix."
          }
        ]
      },
      {
        slug: "olathe-ks",
        name: "Olathe, KS",
        shortName: "Olathe",
        intro:
          "In Olathe, many attic problems show up as family-home comfort issues, underperforming insulation, and energy bills that climb whenever the seasons change. Good Attic helps Olathe homeowners solve those attic-driven issues with insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "Hot upstairs rooms",
            text: "Bedrooms and upper spaces often show weak attic performance before the rest of the house does."
          },
          {
            title: "Builder-grade attic results",
            text: "Newer suburban homes can still feel under-insulated or poorly sealed."
          },
          {
            title: "Attics that need a cleaner plan",
            text: "Comfort, cleanup, and efficiency questions often show up together."
          }
        ],
        whyCall: [
          "Homeowners want the attic to work better without trial-and-error upgrades.",
          "A strong attic plan can help the whole house feel calmer and more predictable.",
          "Good Attic keeps the scope clear from day one."
        ],
        faq: [
          {
            question: "Can attic work help with comfort problems in newer Olathe homes?",
            answer:
              "Yes. Newer homes can still struggle with attic depth, leakage, or heat-load issues that deserve attention."
          },
          {
            question: "Do you handle removal and re-installation together?",
            answer:
              "Yes. If the attic needs a reset first, removal and restoration can be part of one coordinated scope."
          },
          {
            question: "Will attic air sealing matter if the house already has insulation?",
            answer:
              "Often, yes. Sealing and insulation do different jobs, and many comfort issues need both."
          }
        ]
      },
      {
        slug: "lee-s-summit-mo",
        name: "Lee's Summit, MO",
        shortName: "Lee's Summit",
        intro:
          "In Lee's Summit, attic issues usually show up as seasonal comfort swings, dirty or underperforming insulation, and attics that need more than a simple top-off. Good Attic helps Lee's Summit homeowners solve those problems with insulation, removal, pest remediation, fans, and air sealing.",
        commonProblems: [
          {
            title: "Mixed-age attic conditions",
            text: "Some homes need cleanup first, while others need a better insulation and sealing plan."
          },
          {
            title: "Top-floor discomfort",
            text: "Attic performance often shows up in upstairs bedrooms and rooms furthest from stable airflow."
          },
          {
            title: "Dirty insulation or pest history",
            text: "The attic can look serviceable at a glance while still needing a more complete reset."
          }
        ],
        whyCall: [
          "Homeowners want a cleaner attic strategy than simply piling on more material.",
          "The right scope should improve both comfort and confidence in the space.",
          "A measured attic plan makes future work easier to trust."
        ],
        faq: [
          {
            question: "Can you remove old insulation in Lee's Summit before installing new material?",
            answer:
              "Yes. That is often the right move when the attic is dirty, contaminated, or underperforming beyond a simple top-off."
          },
          {
            question: "Do you help with pest contamination too?",
            answer:
              "Yes. Attic pest remediation, sanitation, and restoration are part of the overall system."
          },
          {
            question: "What if the attic looks fine but the upstairs still is not comfortable?",
            answer:
              "That usually means the attic needs to be assessed as a system, not judged from surface appearance alone."
          }
        ]
      },
      {
        slug: "lenexa-ks",
        name: "Lenexa, KS",
        shortName: "Lenexa",
        intro:
          "In Lenexa, homeowners often notice attic problems through upstairs comfort issues, drifting temperatures, and attic insulation that is no longer keeping pace with the house. Good Attic helps Lenexa homeowners solve those attic problems with insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "Inconsistent comfort",
            text: "The upper level may feel warm, drafty, or just less stable than the rest of the house."
          },
          {
            title: "Wasted energy",
            text: "A weak attic boundary can make the HVAC system work harder without creating steadier comfort."
          },
          {
            title: "Attics that need more than guesswork",
            text: "A cleaner attic plan often starts with seeing whether the real issue is removal, sealing, insulation, or all of the above."
          }
        ],
        whyCall: [
          "Homeowners want a premium attic specialist instead of piecing together disconnected trades.",
          "The attic often needs coordinated improvements to feel meaningfully better.",
          "A documented scope helps people move forward with clarity."
        ],
        faq: [
          {
            question: "Do you serve Lenexa through the Kansas City market hub?",
            answer:
              "Yes. Lenexa is supported through the Kansas City market and the same Good Attic service system."
          },
          {
            question: "Can attic upgrades help with both comfort and energy performance?",
            answer:
              "Yes. That combination is one of the most common reasons homeowners reach out."
          },
          {
            question: "Do attic fans and air sealing ever get recommended together?",
            answer:
              "They can. The right answer depends on how the full attic system is behaving today."
          }
        ]
      },
      {
        slug: "leawood-ks",
        name: "Leawood, KS",
        shortName: "Leawood",
        intro:
          "In Leawood, attic issues often show up in higher-value homes as upstairs comfort drift, aging or underperforming insulation, and attic systems that deserve a premium-level plan instead of a rushed add-on upgrade. Good Attic helps Leawood homeowners solve those attic problems with insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "High-expectation comfort drift",
            text: "Upper floors in premium homes can still feel warmer or less stable when the attic is underperforming."
          },
          {
            title: "Attic systems that need a cleaner reset",
            text: "Insulation may still be present without being the right base for the next step."
          },
          {
            title: "Premium homes needing premium execution",
            text: "The attic should be corrected with the same care and documentation standard the home itself deserves."
          }
        ],
        whyCall: [
          "Homeowners want attic work that feels premium, documented, and appropriately scoped.",
          "A cleaner attic plan often matters more than chasing a single product recommendation.",
          "The finished attic should feel more resolved, more trustworthy, and more deliberate afterward."
        ],
        faq: [
          {
            question: "Do high-value Leawood homes still benefit from attic upgrades?",
            answer:
              "Yes. Home value does not eliminate attic leakage, aging insulation, or upper-floor comfort issues."
          },
          {
            question: "Can attic work still matter if the home seems well-built overall?",
            answer:
              "Yes. The attic can quietly underperform over time even in homes that otherwise feel high quality."
          },
          {
            question: "Do you handle projects that need cleanup, sealing, and re-installation together?",
            answer:
              "Yes. Good Attic handles broader attic scopes when the attic needs a cleaner reset before the final install belongs."
          }
        ]
      },
      {
        slug: "shawnee-ks",
        name: "Shawnee, KS",
        shortName: "Shawnee",
        intro:
          "In Shawnee, attic problems often show up as upstairs comfort complaints, underperforming insulation, and attic systems that need a cleaner blend of insulation, sealing, and cleanup decisions. Good Attic helps Shawnee homeowners solve those attic issues with insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "Family-home comfort imbalance",
            text: "Upper rooms and second floors often show attic-related temperature drift first."
          },
          {
            title: "Mixed-age suburban attic conditions",
            text: "Some homes need better coverage, while others need a fuller reset before more insulation makes sense."
          },
          {
            title: "Attic plans that need more than guesswork",
            text: "The right recommendation often depends on whether comfort, cleanliness, and leakage issues are overlapping."
          }
        ],
        whyCall: [
          "Homeowners want a stronger attic strategy than trial-and-error upgrades.",
          "A whole-attic plan can help the house feel steadier without overcomplicating the project.",
          "Good Attic keeps the recommendation tied to the attic evidence instead of generic contractor shortcuts."
        ],
        faq: [
          {
            question: "Can attic work help with hot upstairs rooms in Shawnee homes?",
            answer:
              "Yes. That is one of the most common signs the attic needs a closer look at insulation, sealing, or heat-management support."
          },
          {
            question: "Do you handle both builder-grade issues and older attic problems?",
            answer:
              "Yes. Shawnee has a mix of housing ages, and the attic plan should adapt to the actual home instead of assuming one pattern."
          },
          {
            question: "What if I am not sure whether the attic needs removal or just better insulation?",
            answer:
              "That is a normal question, and the attic assessment is exactly how Good Attic separates those paths clearly."
          }
        ]
      },
      {
        slug: "prairie-village-ks",
        name: "Prairie Village, KS",
        shortName: "Prairie Village",
        intro:
          "In Prairie Village, attic issues often show up in older, valuable homes as uneven room comfort, aging insulation, and attic systems that need more careful attention than a simple insulation add-on. Good Attic helps Prairie Village homeowners solve those attic problems with insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "Older-home attic aging",
            text: "Established homes often carry older insulation and attic details that no longer support comfort the way they once did."
          },
          {
            title: "Room-to-room comfort variation",
            text: "Upper rooms can feel more exposed to attic heat gain and winter drift when the attic system is tired."
          },
          {
            title: "Attics that deserve more deliberate planning",
            text: "Older, valuable homes usually benefit from a clearer attic scope than a generic top-off recommendation."
          }
        ],
        whyCall: [
          "Homeowners want attic work that respects the age and value of the house.",
          "A cleaner attic plan often includes better sequencing around cleanup, sealing, and insulation decisions.",
          "The recommendation should feel measured, credible, and worth trusting in an older established home."
        ],
        faq: [
          {
            question: "Do older Prairie Village homes often need more than insulation alone?",
            answer:
              "Yes. Many older attics need cleanup, sealing, or a fuller reset before extra insulation becomes the right finish step."
          },
          {
            question: "Can attic work help with both comfort and efficiency in established homes?",
            answer:
              "Yes. Those goals often improve together once the attic is corrected as a full system."
          },
          {
            question: "Do you help if the attic feels more dirty and outdated than clearly under-insulated?",
            answer:
              "Yes. That often points toward removal, cleanup, or restoration decisions before the final insulation recommendation is made."
          }
        ]
      },
      {
        slug: "blue-springs-mo",
        name: "Blue Springs, MO",
        shortName: "Blue Springs",
        intro:
          "In Blue Springs, attic issues often show up as upstairs comfort complaints, seasonal energy waste, and attic systems that need more than a one-size-fits-all insulation upgrade. Good Attic helps Blue Springs homeowners solve those attic problems with insulation, removal, pest remediation, fans, and air sealing.",
        commonProblems: [
          {
            title: "Upstairs rooms that drift with the weather",
            text: "The top of the house often reveals attic underperformance first when seasons swing hard."
          },
          {
            title: "Suburban attic systems that need better coordination",
            text: "Some homes need insulation, while others need cleanup or sealing before a better result becomes possible."
          },
          {
            title: "Energy waste that never feels fully explained",
            text: "A weak attic boundary can quietly strain the HVAC system without leaving one obvious visible clue."
          }
        ],
        whyCall: [
          "Homeowners want a clearer explanation of what the attic actually needs before committing to the work.",
          "A better attic plan can improve comfort and efficiency together instead of treating them like separate issues.",
          "The right scope should feel simple to understand even when the attic itself needs multiple corrections."
        ],
        faq: [
          {
            question: "Can attic work help if the upstairs in a Blue Springs home feels worse than the rest of the house?",
            answer:
              "Yes. That is one of the most common attic-related complaints in suburban homes."
          },
          {
            question: "Do you handle insulation removal if the attic needs a cleaner reset first?",
            answer:
              "Yes. Removal, cleanup, and restoration can be part of the coordinated plan when the attic needs more than a top-off."
          },
          {
            question: "What if I only know my utility bills and comfort feel out of sync with the house?",
            answer:
              "That is often a good reason to inspect the attic, because the attic may be where comfort and efficiency are drifting together."
          }
        ]
      },
      {
        slug: "liberty-mo",
        name: "Liberty, MO",
        shortName: "Liberty",
        intro:
          "In Liberty, attic problems often show up as mixed-age home comfort issues, underperforming insulation, and attic systems that need a clearer path between cleanup, sealing, and reinstall decisions. Good Attic helps Liberty homeowners solve those issues with insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "Mixed-age housing stock",
            text: "Different home vintages can create very different attic needs, which is why attic scopes should be measured rather than assumed."
          },
          {
            title: "Upper-floor comfort complaints",
            text: "Bedrooms and second floors often reveal the attic system's weaknesses before the rest of the house does."
          },
          {
            title: "Attics that need a cleaner strategy",
            text: "Homeowners often need help understanding whether the attic needs more material, better sealing, or a more complete reset."
          }
        ],
        whyCall: [
          "Homeowners want a better attic plan than chasing symptoms one room at a time.",
          "A documented scope helps mixed-age homes get the right recommendation instead of a generic one.",
          "The attic should feel healthier and easier to trust once the project is complete."
        ],
        faq: [
          {
            question: "Can attic work help in both older and newer Liberty homes?",
            answer:
              "Yes. The attic issues may differ by home age, but both older and newer homes can benefit from a better attic strategy."
          },
          {
            question: "What if the attic seems like both a comfort and a cleanup problem?",
            answer:
              "That is common, and the attic assessment is how Good Attic separates whether the bigger issue is insulation, removal, sealing, or all three."
          },
          {
            question: "Do you serve Liberty directly through the Kansas City market?",
            answer:
              "Yes. Liberty is supported through the Kansas City market hub and the same Good Attic process."
          }
        ]
      },
      {
        slug: "parkville-mo",
        name: "Parkville, MO",
        shortName: "Parkville",
        intro:
          "In Parkville, attic issues often show up in higher-value and mixed-age homes as upper-floor comfort drift, aging insulation, and attic systems that need a cleaner premium-level plan. Good Attic helps Parkville homeowners solve those problems with insulation, removal, pest remediation, attic fans, and air sealing.",
        commonProblems: [
          {
            title: "Established-home attic aging",
            text: "Attic materials and boundary details can slowly underperform over time even in otherwise desirable homes."
          },
          {
            title: "Upper-floor heat and seasonal drift",
            text: "The attic often reveals itself first in room-to-room comfort imbalance and top-floor seasonal swings."
          },
          {
            title: "Attics that deserve stronger execution",
            text: "Higher-expectation homes often benefit from a more coordinated attic scope than a generic insulation-only answer."
          }
        ],
        whyCall: [
          "Homeowners want attic work that feels premium, clean, and appropriately documented.",
          "A whole-attic strategy often makes more sense than a small patch when comfort, cleanliness, and efficiency are all in play.",
          "The right scope should improve confidence in the home as much as the attic itself."
        ],
        faq: [
          {
            question: "Do higher-value Parkville homes still benefit from attic upgrades?",
            answer:
              "Yes. Home value does not stop attic systems from aging, leaking, or underperforming over time."
          },
          {
            question: "Can attic work help if upper rooms feel less stable than the rest of the house?",
            answer:
              "Yes. That is one of the clearest attic-driven signals in established homes."
          },
          {
            question: "Do you handle attic scopes that need cleanup or removal before re-insulating?",
            answer:
              "Yes. Good Attic handles broader attic resets when the attic is no longer clean or trustworthy enough to build on directly."
          }
        ]
      }
    ]
  }
];

const marketServiceProfiles = {
  "salt-lake-city-ut": {
    climate: "dry summer attic heat, cold winters, and sharp seasonal swings",
    housing: "older attics with uneven coverage, dusty material, and suburban homes with rooms over garages",
    upperFloor: "upper bedrooms, bonus rooms, and the top of the house",
    contamination: "dusty insulation, rodent activity, and material that has simply aged out",
    ventilation: "roof-deck heat, intake protection, and airflow support without blocking insulation pathways"
  },
  "st-louis-mo": {
    climate: "mixed-humid summer heat, cold snaps, and long shoulder seasons",
    housing: "older brick homes, 1.5-story layouts, and mixed-age suburban attics that were never fully reworked",
    upperFloor: "second floors, kneewall-adjacent rooms, and upper bedrooms that drift away from the rest of the home",
    contamination: "musty insulation, rodent or squirrel aftermath, and attic material that no longer feels worth building on",
    ventilation: "heat buildup, humidity management, and ventilation support that works with the full attic instead of fighting it"
  },
  "kansas-city-mo": {
    climate: "hot summer attics, winter heat loss, and strong seasonal swings that expose weak attic performance fast",
    housing: "mixed-age suburban homes, older houses with thin coverage, and attics that look adequate until comfort complaints get louder",
    upperFloor: "upper bedrooms, sun-loaded rooms, and second floors that never feel as steady as the rest of the house",
    contamination: "dusty insulation, pest history, and attic material that is present without still being helpful",
    ventilation: "heat-management support for broad rooflines, high attic temperatures, and airflow that needs to work with insulation and sealing"
  }
};

function buildMarketServiceInsights(market, service) {
  const profile = marketServiceProfiles[market.slug];

  const templates = {
    "attic-insulation": {
      localDrivers: [
        {
          title: "Climate exposes weak insulation quickly",
          text: `In ${market.shortName}, ${profile.climate} can make underperforming attic insulation obvious fast, especially when ${profile.upperFloor} refuse to settle into the same comfort as the rest of the home.`
        },
        {
          title: "Existing material can still be the wrong starting point",
          text: `Many ${profile.housing} still have insulation in place, but not insulation that is clean, even, or performing well enough to justify a blind top-off.`
        },
        {
          title: "Comfort complaints usually show up before homeowners see the attic",
          text: `Most homeowners in ${market.shortName} notice hot or cold rooms, utility strain, or uneven comfort before they know whether the issue is thin coverage, air leakage, or a dirtier attic reset.`
        }
      ],
      inspectionPoints: [
        {
          title: "Current depth and coverage pattern",
          text: "We look for thin spots, uneven coverage, missing edges, and areas where the attic floor is telling a different story than the rest of the house."
        },
        {
          title: "Condition of the existing insulation",
          text: `If the material is dusty, compacted, pest-affected, or no longer worth building on, that changes the recommendation immediately.`
        },
        {
          title: "Air leakage before adding material",
          text: "Open attic bypasses can let conditioned air escape through the ceiling plane, which means more insulation alone may not deliver the result the homeowner expects."
        },
        {
          title: "Ventilation details that affect insulation performance",
          text: `Baffles, soffit pathways, and overall attic airflow matter because insulation should not be installed in a way that creates new ventilation problems.`
        }
      ],
      escalationPoints: [
        {
          title: "A top-off is not the honest answer when the base layer is compromised",
          text: "If the existing insulation is contaminated, heavily settled, or broken down, covering it up can leave the attic looking fuller without solving the underlying problem."
        },
        {
          title: "Air sealing often belongs in the same project",
          text: `Many ${market.shortName} homes need a tighter attic boundary, not just a thicker one, so sealing and insulation often work best as one scope.`
        },
        {
          title: "Heat-management issues can change the final recommendation",
          text: `When attic temperatures are running high or ventilation paths are weak, the attic may need more than insulation to perform the way the homeowner wants.`
        }
      ],
      scopeIncludes: [
        {
          title: "A measured target instead of guesswork",
          text: "The install should match what the attic needs today, not just what sounds common on paper."
        },
        {
          title: "Prep work before the new material goes in",
          text: "If the attic needs cleanup, sealing, or pathway protection first, that should happen before the new insulation becomes the finished layer."
        },
        {
          title: "A rebuilt attic floor that is easier to trust",
          text: "The goal is not only more material. It is an attic boundary that feels cleaner, better documented, and more likely to hold up."
        }
      ],
      extraFaq: [
        {
          question: `Is adding more insulation by itself enough in ${market.shortName}?`,
          answer: `Sometimes, but not always. In many ${market.shortName} homes, the attic also needs air sealing, cleanup, or a reset of the existing material before new insulation can really do its job.`
        },
        {
          question: `What usually makes a simple top-off the wrong call in ${market.shortName}?`,
          answer: `Dirty insulation, rodent contamination, heavy settling, exposed attic bypasses, and obvious ventilation conflicts are all signs that a more complete attic plan may be the better path.`
        }
      ]
    },
    "insulation-removal": {
      localDrivers: [
        {
          title: "Old attic material often carries more than low performance",
          text: `In ${market.shortName}, ${profile.contamination} can turn a comfort issue into a cleanup decision because the attic is no longer a clean base for fresh insulation.`
        },
        {
          title: "Layering over compromised material can trap the real problem",
          text: `When insulation is dirty, broken down, or obviously affected by pests or dust history, adding more on top can leave the attic looking finished while the real issue remains underneath.`
        },
        {
          title: "Removal creates access to the real attic floor again",
          text: "A clean reset makes it easier to inspect penetrations, seal bypasses, sanitize where needed, and rebuild the attic with a better long-term plan."
        }
      ],
      inspectionPoints: [
        {
          title: "How contaminated or degraded the existing material is",
          text: "We look at how widespread the damage is and whether the attic still has any insulation worth preserving."
        },
        {
          title: "Whether removal should be partial or full",
          text: "Some attics need a full reset. Others may only need targeted removal where contamination or damage is concentrated."
        },
        {
          title: "Containment and access planning",
          text: "Removal should be controlled so the attic mess stays managed during the project rather than drifting through the home."
        },
        {
          title: "What the attic needs immediately after removal",
          text: "The smartest removal scope already anticipates what comes next, whether that is sanitation, sealing, new insulation, or all three."
        }
      ],
      escalationPoints: [
        {
          title: "Removal alone is rarely the finished answer",
          text: "Once the attic is opened back up, the homeowner usually benefits most from using that opportunity to correct leakage, contamination, and performance issues together."
        },
        {
          title: "Pest or moisture history can reshape the full scope",
          text: `In ${market.shortName}, older attic material may tell a bigger story about rodents, odors, dust, or past moisture events that should be addressed before reinstalling anything.`
        },
        {
          title: "Fresh insulation should go onto a prepared attic, not a rushed one",
          text: "A clean base gives the next phase a much better chance of feeling finished instead of temporary."
        }
      ],
      scopeIncludes: [
        {
          title: "Containment-minded collection and disposal",
          text: "Removal should feel deliberate and controlled, not like the attic is simply being disturbed and left half-finished."
        },
        {
          title: "A visible reset of the attic floor",
          text: "Once the old material is out, the attic becomes easier to inspect, document, and prepare correctly."
        },
        {
          title: "A cleaner transition into restoration work",
          text: "The best removal projects set up sanitation, air sealing, and re-insulation so the homeowner does not have to restart the conversation from zero."
        }
      ],
      extraFaq: [
        {
          question: `When does insulation removal make more sense than adding new material in ${market.shortName}?`,
          answer: `Removal usually makes more sense when the attic insulation is dirty, contaminated, heavily settled, pest-damaged, or no longer worth using as the base layer for the next scope.`
        },
        {
          question: `Can removal and rebuild happen as one plan in ${market.shortName}?`,
          answer: `Yes. Many homeowners in ${market.shortName} want the attic reset fully, which means removal is only the first step in a larger cleanup, sealing, and re-installation scope.`
        }
      ]
    },
    "attic-pest-remediation": {
      localDrivers: [
        {
          title: "The attic can stay unhealthy after the animals are gone",
          text: `In ${market.shortName}, homeowners often call after pest control or exclusion work is already done, but the attic still contains droppings, nesting debris, odors, and damaged insulation.`
        },
        {
          title: "Contamination spreads beyond one visible nest area",
          text: `What looks like a localized pest issue from the attic hatch can actually affect broad sections of insulation, attic surfaces, and how comfortable the home feels day to day.`
        },
        {
          title: "Restoration matters as much as cleanup",
          text: `A better attic outcome usually comes from removing affected material, sanitizing what needs attention, and rebuilding the attic as a clean system instead of stopping at the mess.`
        }
      ],
      inspectionPoints: [
        {
          title: "How much insulation has been affected",
          text: "We check whether contamination is isolated or spread across the attic floor, which changes whether targeted cleanup or a broader reset makes more sense."
        },
        {
          title: "What surfaces need sanitation attention",
          text: "The attic may need more than insulation removal if debris, odors, or residue are sitting on visible surfaces and penetrations."
        },
        {
          title: "Whether the attic is ready for restoration yet",
          text: "If active pest entry or unresolved damage is still present, that affects when the rebuild should happen and what should be coordinated first."
        },
        {
          title: "What a clean finish actually requires",
          text: "Real remediation means planning for the attic people want after cleanup, not just the attic they can tolerate for now."
        }
      ],
      escalationPoints: [
        {
          title: "Pest cleanup and attic restoration are not the same thing",
          text: "Getting the animals out is important, but homeowners usually still need a plan for the insulation, contamination, and attic boundary left behind."
        },
        {
          title: "The attic may also need sealing and re-insulation",
          text: `Once damaged material is removed, it is often the right time to tighten the attic boundary and rebuild the insulation layer at the same time.`
        },
        {
          title: "The healthier answer is usually the more complete one",
          text: "Half-remediated attics often stay dusty, odorous, or hard to trust. A full reset gives the homeowner a cleaner finish line."
        }
      ],
      scopeIncludes: [
        {
          title: "Removal of affected insulation and debris",
          text: "The contaminated base layer should be treated as a restoration issue, not ignored because some material still appears intact."
        },
        {
          title: "Sanitation where the attic actually needs it",
          text: "Cleanup should focus on what was impacted so the attic feels healthier and more defensible after the work is done."
        },
        {
          title: "A rebuilt attic plan once the contamination is gone",
          text: "Remediation feels complete when the attic is restored into a cleaner, better-performing version of the space."
        }
      ],
      extraFaq: [
        {
          question: `Do I still need attic remediation in ${market.shortName} if pest control already handled the animals?`,
          answer: `Usually, yes. Pest control addresses the animals. Attic remediation handles the damaged insulation, droppings, nesting debris, odor, and restoration work left behind.`
        },
        {
          question: `Is attic pest remediation in ${market.shortName} basically the same as insulation removal?`,
          answer: `Not quite. Removal may be part of it, but real remediation also accounts for contamination, sanitation, and what the attic needs to become healthy and usable again.`
        }
      ]
    },
    "attic-fans": {
      localDrivers: [
        {
          title: "Attic heat load can be real, but it needs context",
          text: `In ${market.shortName}, ${profile.ventilation} can make homeowners think of fans quickly, but the best answer depends on how insulation, sealing, and airflow are already working.`
        },
        {
          title: "Some homes clearly struggle with trapped attic heat",
          text: `${profile.upperFloor} often feel the impact first when attic temperatures stay elevated and the home never quite cools off the way it should.`
        },
        {
          title: "A fan should support the attic system, not distract from it",
          text: "The strongest attic fan recommendations usually happen after confirming that the attic is actually a good fit and not simply under-insulated or leaky."
        }
      ],
      inspectionPoints: [
        {
          title: "How the attic is venting today",
          text: "We look at the current intake and exhaust path because a fan should not be dropped into an attic without understanding how air is already supposed to move."
        },
        {
          title: "Whether insulation or leakage is the bigger first problem",
          text: "If the attic boundary is weak, a fan alone may not give the homeowner the result they expect."
        },
        {
          title: "Roof and attic fit",
          text: "Placement, power source, and attic layout all matter when deciding whether a fan solution makes practical sense."
        },
        {
          title: "What success should actually look like",
          text: "The point is not just adding a product. It is supporting a cooler, better-managed attic without creating a mismatched scope."
        }
      ],
      escalationPoints: [
        {
          title: "A fan is not the default answer for every hot attic",
          text: `Some ${market.shortName} homes need more insulation, better air sealing, or a cleaner attic reset before a fan deserves to be the lead recommendation.`
        },
        {
          title: "Ventilation support works best when the attic boundary is healthier",
          text: "If the attic floor is leaking badly or the insulation is weak, the fan may end up supporting a system that still has major gaps."
        },
        {
          title: "The honest answer may be a combined scope",
          text: "The best-performing projects often pair heat-management improvements with the insulation and sealing work that keeps the attic from drifting backward."
        }
      ],
      scopeIncludes: [
        {
          title: "A fit check before a fan is ever recommended",
          text: "The attic should earn the recommendation through the inspection, not get one because the symptom sounds familiar."
        },
        {
          title: "Placement and support that match the attic",
          text: "A better fan install is built around how the attic is laid out and what the home is trying to solve."
        },
        {
          title: "Coordination with the rest of the attic plan",
          text: "When needed, fan work should sit alongside insulation, sealing, or cleanup improvements instead of pretending those issues do not exist."
        }
      ],
      extraFaq: [
        {
          question: `Are attic fans a good fit for every ${market.shortName} home with hot upstairs rooms?`,
          answer: `No. Some attics are a strong fit for fan support, but others need insulation, air sealing, or cleanup first. The attic should be inspected as a system before locking in that recommendation.`
        },
        {
          question: `What usually tells you an attic fan in ${market.shortName} is worth considering?`,
          answer: `It becomes more compelling when the attic clearly struggles with heat buildup and the rest of the attic boundary is healthy enough that a fan can support, rather than mask, the real solution.`
        }
      ]
    },
    "attic-air-sealing": {
      localDrivers: [
        {
          title: "Small attic bypasses can have outsized impact",
          text: `In ${market.shortName}, leaky attic floors can quietly move conditioned air out of the home and pull dusty attic air toward the living space without homeowners realizing how many small openings are involved.`
        },
        {
          title: "Air sealing solves a different problem than insulation",
          text: `Many ${market.shortName} homes already have insulation present, but still need the attic boundary tightened where penetrations, top plates, chases, and access points are leaking.`
        },
        {
          title: "Comfort and cleanliness often improve together",
          text: `A better sealed attic can support steadier temperatures while also reducing the attic-to-home exchange that makes the house feel dustier or less controlled.`
        }
      ],
      inspectionPoints: [
        {
          title: "Where the big bypasses are hiding",
          text: "We check around penetrations, chases, attic hatches, and other transitions where the attic boundary often breaks open."
        },
        {
          title: "Whether the attic needs cleanup before sealing",
          text: "Dirty or contaminated insulation can make it harder to access the attic floor correctly, which is why sealing sometimes belongs after removal or cleanup."
        },
        {
          title: "How the sealing plan fits with insulation",
          text: "Air sealing and insulation should be coordinated so the attic floor ends up tighter and better protected rather than partially corrected."
        },
        {
          title: "Whether other attic issues are altering the result",
          text: `If the attic is also under-insulated or dealing with heat-management issues, sealing may be one major piece of a broader attic improvement plan.`
        }
      ],
      escalationPoints: [
        {
          title: "Sealing alone is not always the whole answer",
          text: `In many ${market.shortName} homes, sealing helps the boundary significantly, but the attic may still need insulation upgrades or a cleaner reset to feel meaningfully finished.`
        },
        {
          title: "Dirty insulation can block the right sealing work",
          text: "If the attic floor is buried under damaged or contaminated material, the cleaner path may be to reset the attic before trying to tighten it thoroughly."
        },
        {
          title: "The goal is a coordinated attic boundary",
          text: "The strongest results come when the homeowner ends up with sealing, insulation, and access details that all support one another."
        }
      ],
      scopeIncludes: [
        {
          title: "Bypass identification instead of guesswork",
          text: "A real sealing scope starts by finding the leakage points that are actually shaping comfort and energy waste."
        },
        {
          title: "A tighter attic floor before the final insulation layer",
          text: "When the sealing happens at the right stage, the attic becomes easier to rebuild into a cleaner performance boundary."
        },
        {
          title: "A better handoff into insulation or full restoration work",
          text: "Air sealing works best when it is treated as part of the attic plan instead of as a one-off add-on."
        }
      ],
      extraFaq: [
        {
          question: `Does attic air sealing in ${market.shortName} still matter if the home already has insulation?`,
          answer: `Yes. Insulation and air sealing do different jobs. Many homes in ${market.shortName} have insulation present but still leak enough at the attic floor to lose comfort and efficiency.`
        },
        {
          question: `What usually tells you attic air sealing in ${market.shortName} should be part of the project?`,
          answer: `We usually see it when the attic has obvious bypasses, dusty air movement, uneven comfort, or insulation that cannot perform well because the boundary underneath it is still open.`
        }
      ]
    }
  };

  return templates[service.slug];
}

const corePages = [
  {
    slug: "about",
    url: "/about/",
    page_type: "core",
    market: null,
    city: null,
    primary_keyword: "about good attic",
    secondary_keywords: ["good attic company", "attic specialists", "why choose good attic"],
    seo_title: "About Good Attic | Premium Attic Specialists",
    meta_description:
      "Learn about Good Attic, a premium attic specialist focused on insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
    h1: "About Good Attic",
    intro:
      "Good Attic is built for homeowners who want attic work handled clearly, cleanly, and without guesswork. We focus on the attic as a system because comfort, air quality, cleanup, and efficiency rarely improve when the space is treated as a collection of unrelated problems.",
    page_purpose: "Trust / company story",
    cta_primary: "Talk to the team",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "About", url: "/about/" }
    ],
    canonical_url: `${site.baseUrl}/about/`,
    related_links: [
      { label: "Attic Services", url: "/services/" },
      { label: "Good Attic Locations", url: "/locations/" },
      { label: "Contact Good Attic", url: "/contact/" }
    ],
    faq_items: [
      {
        question: "Why choose an attic specialist instead of a generic contractor?",
        answer:
          "A specialist can look at the attic as one connected system, which usually leads to cleaner decisions around removal, sealing, insulation, ventilation, and cleanup."
      },
      {
        question: "What matters most in the Good Attic experience?",
        answer:
          "Clear communication, documented findings, clean work, and a scope that makes sense for the actual house."
      },
      {
        question: "Does Good Attic only handle one type of attic problem?",
        answer:
          "No. The work often spans insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing because many attic issues overlap."
      }
    ],
    trust_elements: [
      "Photo-based attic findings",
      "Premium cleanup and installation standards",
      "A calm, homeowner-friendly process"
    ]
  },
  {
    slug: "services",
    url: "/services/",
    page_type: "core",
    market: null,
    city: null,
    primary_keyword: "attic services",
    secondary_keywords: [
      "attic insulation services",
      "insulation removal",
      "attic fans",
      "attic air sealing",
      "attic pest remediation"
    ],
    seo_title: "Attic Services | Insulation, Removal, Pest Remediation & More",
    meta_description:
      "Explore Good Attic attic services, including attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
    h1: "Attic Services",
    intro:
      "Good Attic focuses on the parts of the attic that most directly affect comfort, air quality, cleanup, and energy performance. The point is not to overwhelm the project with extras. It is to solve the attic problems that matter most and do it in a coordinated way.",
    page_purpose: "Master services hub",
    cta_primary: "Book an Attic Inspection",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Services", url: "/services/" }
    ],
    canonical_url: `${site.baseUrl}/services/`,
    related_links: [
      { label: "Good Attic Locations", url: "/locations/" },
      { label: "Salt Lake City, UT", url: "/salt-lake-city-ut/" },
      { label: "St. Louis, MO", url: "/st-louis-mo/" },
      { label: "Kansas City, MO", url: "/kansas-city-mo/" }
    ],
    faq_items: [
      {
        question: "Which attic service do most homeowners need first?",
        answer:
          "It depends on the attic condition. Some homes need better insulation. Others need removal, cleanup, sealing, or a combination before insulation can really work."
      },
      {
        question: "Do attic services usually overlap?",
        answer:
          "Yes. Comfort issues, contamination, leakage, and heat-management problems often show up together in the same attic."
      },
      {
        question: "How do I move from a service overview to local help?",
        answer:
          "Start with the service that matches the attic problem. From there, the page can route you into the matching local service pages or straight into an inspection request."
      }
    ],
    trust_elements: [
      "Five core attic services",
      "Whole-attic thinking instead of isolated patches",
      "Clear route into local service pages"
    ]
  },
  {
    slug: "locations",
    url: "/locations/",
    page_type: "core",
    market: null,
    city: null,
    primary_keyword: "good attic locations",
    secondary_keywords: ["service areas", "attic services near me", "markets served"],
    seo_title: "Good Attic Locations | Salt Lake City, St. Louis & Kansas City",
    meta_description:
      "Explore Good Attic markets in Salt Lake City, St. Louis, and Kansas City and find the right local attic service page for your area.",
    h1: "Good Attic Locations",
    intro:
      "Good Attic currently organizes service around three primary markets: Salt Lake City, St. Louis, and Kansas City. Each market page leads to local service pages and nearby city pages built for that area.",
    page_purpose: "Location hub",
    cta_primary: "Choose your market",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Locations", url: "/locations/" }
    ],
    canonical_url: `${site.baseUrl}/locations/`,
    related_links: marketCatalog.map((market) => ({ label: market.name, url: `/${market.slug}/` })),
    faq_items: [
      {
        question: "Which markets does Good Attic serve?",
        answer: "Good Attic currently focuses on Salt Lake City, St. Louis, and Kansas City."
      },
      {
        question: "How do I find the right local service page?",
        answer:
          "Start with the market page for your area. From there, you can move into the service pages and nearby city pages tied to that market."
      }
    ],
    trust_elements: ["One domain", "Three real markets", "Clear local routing"]
  },
  {
    slug: "resources",
    url: "/resources/",
    page_type: "core",
    market: null,
    city: null,
    primary_keyword: "attic resources",
    secondary_keywords: [
      "attic insulation cost",
      "attic removal vs top off",
      "attic air sealing guide",
      "attic pest contamination signs"
    ],
    seo_title: "Attic Resources | Cost, Insulation, Air Sealing & Pest Guides",
    meta_description:
      "Explore Good Attic resources covering attic insulation cost, insulation removal decisions, attic air sealing, attic fan fit, and signs of attic pest contamination.",
    h1: "Attic Resources",
    intro:
      "Good Attic resources are built to help homeowners make better attic decisions before they book anything. The goal is to explain what changes price, when a scope gets bigger than expected, and how to think through insulation, cleanup, sealing, pests, and ventilation like one connected attic system.",
    page_purpose: "Authority hub",
    cta_primary: "Explore attic guides",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Resources", url: "/resources/" }
    ],
    canonical_url: `${site.baseUrl}/resources/`,
    related_links: [
      { label: "Attic Services", url: "/services/" },
      { label: "Salt Lake City, UT", url: "/salt-lake-city-ut/" },
      { label: "St. Louis, MO", url: "/st-louis-mo/" },
      { label: "Kansas City, MO", url: "/kansas-city-mo/" }
    ],
    faq_items: [
      {
        question: "Will Good Attic resource pages include exact pricing?",
        answer:
          "Only when the team has a real, supportable way to publish it. For now, the guides focus on what changes attic pricing and why honest estimates vary so much from home to home."
      },
      {
        question: "Are these resources tied to real Good Attic services?",
        answer:
          "Yes. Every guide is meant to route homeowners toward the right service page, market page, or inspection request once the attic decision becomes clearer."
      },
      {
        question: "Why build resources instead of a generic blog?",
        answer:
          "Because attic decisions are usually practical, not inspirational. Homeowners want clarity on scope, fit, cleanup, pricing drivers, and what the next step should actually be."
      }
    ],
    trust_elements: [
      "Built around real attic decision questions",
      "Structured to support the service pages, not distract from them",
      "No fake pricing, fake projects, or fake office claims"
    ]
  },
  {
    slug: "reviews",
    url: "/reviews/",
    page_type: "core",
    market: null,
    city: null,
    primary_keyword: "good attic reviews",
    secondary_keywords: ["customer reviews", "testimonials", "attic company reviews"],
    seo_title: "Good Attic Reviews | What Homeowners Say",
    meta_description:
      "Read Good Attic reviews and see why homeowners trust our team for attic insulation, insulation removal, attic cleanup, and attic upgrades.",
    h1: "Good Attic Reviews",
    intro:
      "The Good Attic experience is built around the things homeowners usually mention when a project actually goes well: clear communication, a clean scope, respectful crews, and visible results at the end. This page is where approved homeowner feedback and review proof can live as the brand grows.",
    page_purpose: "Proof / trust",
    cta_primary: "Request an attic estimate",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Reviews", url: "/reviews/" }
    ],
    canonical_url: `${site.baseUrl}/reviews/`,
    related_links: [
      { label: "Contact Good Attic", url: "/contact/" },
      { label: "Attic Services", url: "/services/" }
    ],
    faq_items: [
      {
        question: "What kinds of feedback does Good Attic want the site to showcase?",
        answer:
          "The strongest proof will always be approved homeowner reviews that speak to cleanliness, clarity, communication, and visible attic results."
      },
      {
        question: "Will this page include Google reviews?",
        answer:
          "Yes. Approved excerpts or a synced review feed can be added here as Good Attic connects its review sources."
      },
      {
        question: "Can I ask about past homeowner experiences before booking?",
        answer:
          "Yes. The team can talk through the process, what homeowners usually care about, and what a clear attic scope should include."
      }
    ],
    trust_elements: [
      "Google review styling already established on the homepage",
      "Real homeowner feedback only",
      "Launch-ready space for approved review content"
    ]
  },
  {
    slug: "financing",
    url: "/financing/",
    page_type: "core",
    market: null,
    city: null,
    primary_keyword: "attic financing",
    secondary_keywords: ["insulation financing", "home improvement financing"],
    seo_title: "Financing Options | Good Attic",
    meta_description:
      "Learn about Good Attic financing options and take the next step on attic insulation, insulation removal, or attic upgrade work.",
    h1: "Financing Options",
    intro:
      "Some attic projects are simple, and some are more involved. The financing page exists to support homeowners who want to understand payment flexibility before moving forward on removal, cleanup, insulation, air sealing, or other attic upgrades.",
    page_purpose: "Conversion support",
    cta_primary: "Ask about financing",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Financing", url: "/financing/" }
    ],
    canonical_url: `${site.baseUrl}/financing/`,
    related_links: [
      { label: "Contact Good Attic", url: "/contact/" },
      { label: "Attic Services", url: "/services/" }
    ],
    faq_items: [
      {
        question: "Does Good Attic offer financing on every project?",
        answer:
          "Financing availability can vary by project and approved program, so the right next step is to ask about current options once the attic scope is clear."
      },
      {
        question: "When should I bring up financing?",
        answer:
          "The best time is once the attic has been assessed and the right scope is in front of you. That keeps the conversation tied to real project needs."
      },
      {
        question: "Can financing still work for a multi-step attic plan?",
        answer:
          "That is exactly the kind of situation where financing support may be useful, especially when removal, sanitation, sealing, and insulation all belong in the same project."
      }
    ],
    trust_elements: [
      "Financing details confirmed during quoting",
      "Supportive conversion path for larger attic scopes",
      "Clear handoff into contact and quoting"
    ]
  },
  {
    slug: "contact",
    url: "/contact/",
    page_type: "core",
    market: null,
    city: null,
    primary_keyword: "contact good attic",
    secondary_keywords: ["schedule estimate", "request attic inspection"],
    seo_title: "Contact Good Attic | Request an Attic Estimate",
    meta_description:
      "Contact Good Attic to request an estimate, ask a question, or get help with attic insulation, attic cleanup, or attic comfort issues.",
    h1: "Contact Good Attic",
    intro:
      "Use the form below to tell Good Attic what is happening in the attic and what kind of help you need. The goal is to make the next step feel clear from the first request, whether the project starts with insulation, removal, cleanup, air sealing, or a full attic reset.",
    page_purpose: "Lead capture",
    cta_primary: "Request an attic estimate",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Contact", url: "/contact/" }
    ],
    canonical_url: `${site.baseUrl}/contact/`,
    related_links: [
      { label: "Financing Options", url: "/financing/" },
      { label: "Attic Services", url: "/services/" },
      { label: "Good Attic Locations", url: "/locations/" }
    ],
    faq_items: [
      {
        question: "Can I call or text instead of using the form?",
        answer: "Yes. Good Attic supports call, text, and form-based contact so homeowners can start whichever way feels easiest."
      },
      {
        question: "What should I include in the request?",
        answer:
          "The symptoms you notice, the size or type of home if you know it, your location, and anything else that helps explain what the attic seems to be doing."
      },
      {
        question: "Do I need to know which service I need before reaching out?",
        answer:
          "No. A big part of the process is helping homeowners sort out whether the attic needs insulation, removal, sanitation, sealing, or a combination."
      }
    ],
    trust_elements: [
      "Call, text, or form contact options",
      "Dynamic lead form already used on the homepage",
      "Routing prepared for all three launch markets"
    ]
  }
];

const homeRecord = {
  slug: "",
  url: "/",
  page_type: "core",
  market: null,
  city: null,
  primary_keyword: "good attic",
  secondary_keywords: ["attic insulation company", "attic specialist", "attic services"],
  seo_title: "Good Attic | Premium Attic Insulation & Attic Services",
  meta_description:
    "Good Attic helps homeowners solve hot and cold rooms, old insulation, attic pest issues, and energy waste with premium attic services.",
  h1: "Premium Attic Insulation & Attic Services",
  intro:
    "The homepage remains the brand authority page and central conversion hub. It should route homeowners toward services, locations, and real market hubs without losing the premium homepage design direction already approved.",
  page_purpose: "Brand authority + conversion",
  cta_primary: "Get a free attic assessment",
  breadcrumb_items: [{ label: "Home", url: "/" }],
  canonical_url: `${site.baseUrl}/`,
  related_links: [
    { label: "Attic Services", url: "/services/" },
    { label: "Good Attic Locations", url: "/locations/" },
    { label: "Salt Lake City, UT", url: "/salt-lake-city-ut/" },
    { label: "St. Louis, MO", url: "/st-louis-mo/" },
    { label: "Kansas City, MO", url: "/kansas-city-mo/" }
  ],
  faq_items: [],
  trust_elements: ["Homepage preserved", "Market routing added", "Design language remains the anchor"]
};

function serviceBySlug(slug) {
  return serviceCatalog.find((service) => service.slug === slug);
}

function marketBySlug(slug) {
  return marketCatalog.find((market) => market.slug === slug);
}

function resourceFeatureImage(resource) {
  if (resource.slug.startsWith("attic-insulation-cost-")) return proofAssets.hotColdInsulation;
  if (resource.slug === "insulation-removal-vs-top-off") return proofAssets.dirtyReset;
  if (resource.slug === "attic-air-sealing-vs-more-insulation") return proofAssets.airSealing;
  if (resource.slug === "signs-of-attic-pest-contamination") return proofAssets.pestDamage;
  if (resource.slug === "attic-fan-vs-ventilation-fix") return proofAssets.fans;
  if (resource.slug === "what-r-value-means-for-an-attic") return proofAssets.insulation;
  if (resource.slug === "why-upstairs-rooms-stay-hot") return proofAssets.hotColdHouse;
  if (resource.slug === "when-attic-cleanup-becomes-restoration") return proofAssets.grossAttic;
  if (resource.slug === "what-happens-during-an-attic-inspection") return proofAssets.sales;
  return proofAssets.sales;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cityState(city) {
  const match = city.name.match(/,\s*([A-Z]{2})$/);
  return match ? match[1] : "";
}

function pageFilePath(urlPath) {
  return urlPath === "/" ? "/index.html" : `${urlPath.replace(/\/$/, "")}/index.html`;
}

function splitTarget(target) {
  const [pathname, hash] = target.split("#");
  const page = {
    pathname: pathname || "/",
    hash: hash ? `#${hash}` : ""
  };

  return page;
}

function hrefFrom(currentUrl, target) {
  if (/^(tel:|sms:|mailto:|https?:)/.test(target)) {
    return target;
  }

  const { pathname, hash } = splitTarget(target);

  if (pathname === currentUrl) {
    return hash || "./";
  }

  const fromDir = path.posix.dirname(pageFilePath(currentUrl));
  const toFile = pageFilePath(pathname);
  let relative = path.posix.relative(fromDir, toFile) || "index.html";

  if (relative === "index.html") {
    relative = "./";
  } else if (relative.endsWith("/index.html")) {
    relative = `${relative.slice(0, -"index.html".length)}`;
  }

  return `${relative}${hash}`;
}

function assetHref(currentUrl, assetPath) {
  const fromDir = path.posix.dirname(pageFilePath(currentUrl));
  return path.posix.relative(fromDir, `/${assetPath}`) || path.posix.basename(assetPath);
}

function renderBreadcrumbs(page, currentUrl) {
  return `
    <nav class="breadcrumbs reveal" aria-label="Breadcrumbs">
      ${page.breadcrumb_items
        .map((item, index) => {
          const isLast = index === page.breadcrumb_items.length - 1;
          return `
            ${index > 0 ? '<span class="breadcrumbs__sep">/</span>' : ""}
            ${
              isLast
                ? `<span aria-current="page">${escapeHtml(item.label)}</span>`
                : `<a href="${hrefFrom(currentUrl, item.url)}">${escapeHtml(item.label)}</a>`
            }
          `;
        })
        .join("")}
    </nav>
  `;
}

function renderBreadcrumbJsonLd(page) {
  const itemListElement = page.breadcrumb_items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.label,
    item: item.url === "/" ? `${site.baseUrl}/` : `${site.baseUrl}${item.url}`
  }));

  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement
  })}</script>`;
}

function phoneForPage(page) {
  if (page?.market && marketPhones[page.market]) {
    return marketPhones[page.market];
  }

  return {
    phoneDisplay: site.phoneDisplay,
    phoneHref: site.phoneHref,
    smsHref: site.smsHref
  };
}

function renderSiteJsonLd(page) {
  const pagePhone = phoneForPage(page);
  const areaServed = marketCatalog.map((market) => ({
    "@type": "AdministrativeArea",
    name: market.name
  }));
  const contactPoint = Object.values(
    marketCatalog.reduce((acc, market) => {
      const phone = marketPhones[market.slug];
      acc[phone.phoneDisplay] = {
        "@type": "ContactPoint",
        contactType: "customer service",
        telephone: phone.phoneDisplay,
        areaServed: market.name,
        availableLanguage: "English",
        url: `${site.baseUrl}${market.slug ? `/${market.slug}/` : "/"}`
      };
      return acc;
    }, {})
  );

  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${site.baseUrl}/#organization`,
        name: site.name,
        url: `${site.baseUrl}/`,
        logo: `${site.baseUrl}/assets/good-attic-logo.png`,
        description: site.description,
        telephone: pagePhone.phoneDisplay,
        areaServed,
        contactPoint
      },
      {
        "@type": "WebSite",
        "@id": `${site.baseUrl}/#website`,
        name: site.name,
        url: `${site.baseUrl}/`,
        description: site.description,
        inLanguage: "en-US",
        publisher: { "@id": `${site.baseUrl}/#organization` }
      }
    ]
  })}</script>`;
}

function renderFaqJsonLd(page) {
  if (!page.faq_items?.length) return "";

  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faq_items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer
      }
    }))
  })}</script>`;
}

function renderServiceJsonLd(page) {
  if (!["service", "core-service"].includes(page.page_type)) return "";

  const matchedService = serviceCatalog.find((item) => item.slug === page.slug);
  if (!matchedService) return "";

  const areaServed =
    page.page_type === "service" && page.market
      ? [{ "@type": "AdministrativeArea", name: marketCatalog.find((market) => market.slug === page.market)?.name || page.market }]
      : marketCatalog.map((market) => ({ "@type": "AdministrativeArea", name: market.name }));

  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${page.canonical_url}#service`,
    name: page.h1,
    serviceType: matchedService.name,
    description: page.intro || page.meta_description,
    provider: { "@id": `${site.baseUrl}/#organization` },
    areaServed,
    url: page.canonical_url
  })}</script>`;
}

function renderArticleJsonLd(page) {
  if (page.page_type !== "resource") return "";

  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.h1,
    description: page.intro || page.meta_description,
    mainEntityOfPage: page.canonical_url,
    url: page.canonical_url,
    publisher: { "@id": `${site.baseUrl}/#organization` },
    about: [page.primary_keyword, ...(page.secondary_keywords || [])]
  })}</script>`;
}

function navLink(currentUrl, target, label) {
  const pathname = splitTarget(target).pathname;
  const isActive =
    pathname !== "/" &&
    (currentUrl === pathname || (pathname.endsWith("/") && currentUrl.startsWith(pathname) && pathname !== "/"));

  return `<a href="${hrefFrom(currentUrl, target)}"${isActive ? ' class="is-active"' : ""}>${escapeHtml(label)}</a>`;
}

function imageForPage(page) {
  if (page.page_type === "resource") return resourceFeatureImage(page);

  if (["service", "core-service"].includes(page.page_type)) {
    const matchedService = serviceCatalog.find((item) => item.slug === page.slug);
    return matchedService?.image || proofAssets.insulation;
  }

  if (page.page_type === "market") return proofAssets.sales;
  if (page.page_type === "support") return proofAssets.sales;
  if (page.slug === "reviews") return proofAssets.sales;
  if (page.slug === "services") return proofAssets.insulation;
  if (page.slug === "locations") return proofAssets.sales;
  if (page.slug === "financing") return proofAssets.sales;
  if (page.slug === "contact") return proofAssets.sales;
  if (page.slug === "about") return proofAssets.sales;

  return proofAssets.insulation;
}

function renderMetaTags(page, currentUrl) {
  const absoluteUrl = page.canonical_url;
  const imagePath = imageForPage(page);
  const absoluteImage = `${site.baseUrl}/${imagePath}`;
  const ogType = page.page_type === "resource" ? "article" : "website";

  return `
  <meta property="og:title" content="${escapeHtml(page.seo_title)}">
  <meta property="og:description" content="${escapeHtml(page.meta_description)}">
  <meta property="og:url" content="${escapeHtml(absoluteUrl)}">
  <meta property="og:type" content="${escapeHtml(ogType)}">
  <meta property="og:site_name" content="${escapeHtml(site.name)}">
  <meta property="og:image" content="${escapeHtml(absoluteImage)}">
  <meta property="og:image:alt" content="${escapeHtml(page.h1)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(page.seo_title)}">
  <meta name="twitter:description" content="${escapeHtml(page.meta_description)}">
  <meta name="twitter:image" content="${escapeHtml(absoluteImage)}">
  <meta name="theme-color" content="#0f5a43">`;
}

function renderImg(currentUrl, src, alt, options = {}) {
  const className = options.className ? ` class="${escapeHtml(options.className)}"` : "";
  const loading = options.loading || "lazy";
  const decoding = options.decoding || "async";
  const fetchpriority = options.fetchpriority ? ` fetchpriority="${escapeHtml(options.fetchpriority)}"` : "";
  const ariaHidden = options.ariaHidden ? ' aria-hidden="true"' : "";
  return `<img${className} src="${escapeHtml(assetHref(currentUrl, src))}" alt="${escapeHtml(alt || "")}" loading="${escapeHtml(
    loading
  )}" decoding="${escapeHtml(decoding)}"${fetchpriority}${ariaHidden}>`;
}

function relatedLinkImage(url) {
  const resource = resourcePages.find((page) => page.url === url);
  if (resource) return resourceFeatureImage(resource);

  const serviceMatch = url.match(/^\/(?:services\/)?(attic-insulation|insulation-removal|attic-pest-remediation|attic-fans|attic-air-sealing)\/$/);
  if (serviceMatch) return serviceBySlug(serviceMatch[1])?.image || proofAssets.sales;

  if (/^\/(salt-lake-city-ut|st-louis-mo|kansas-city-mo)\/service-areas\//.test(url)) return proofAssets.sales;
  if (/^\/(salt-lake-city-ut|st-louis-mo|kansas-city-mo)\/$/.test(url)) return proofAssets.sales;
  if (/^\/(salt-lake-city-ut|st-louis-mo|kansas-city-mo)\/(attic-insulation|insulation-removal|attic-pest-remediation|attic-fans|attic-air-sealing)\//.test(url)) {
    const parts = url.split("/").filter(Boolean);
    return serviceBySlug(parts[1])?.image || proofAssets.sales;
  }

  if (url === "/reviews/") return proofAssets.sales;
  if (url === "/contact/") return proofAssets.sales;
  if (url === "/financing/") return proofAssets.sales;
  if (url === "/locations/") return proofAssets.sales;
  if (url === "/services/") return proofAssets.insulation;

  return proofAssets.sales;
}

function relatedLinkText(url, label) {
  if (url.startsWith("/resources/")) return `Use ${label} as the supporting guide before choosing the next attic service or local market path.`;
  if (url.startsWith("/services/")) return `Review ${label} to understand the core attic service path before moving into a local market page.`;
  if (/^\/(salt-lake-city-ut|st-louis-mo|kansas-city-mo)\/service-areas\//.test(url)) {
    return `Open ${label} for a more local support page that still routes back through the correct market hub and phone path.`;
  }
  if (/^\/(salt-lake-city-ut|st-louis-mo|kansas-city-mo)\/$/.test(url)) {
    return `Open ${label} for the full local market hub, service pages, city support pages, and the right market contact path.`;
  }
  if (/^\/(salt-lake-city-ut|st-louis-mo|kansas-city-mo)\/(attic-insulation|insulation-removal|attic-pest-remediation|attic-fans|attic-air-sealing)\//.test(url)) {
    return `Use ${label} when you want attic guidance tied to a specific metro and service instead of a broader overview page.`;
  }
  if (url === "/reviews/") return "Move into the reviews and proof page when you want clearer homeowner trust signals and documented attic evidence.";
  if (url === "/contact/") return "Use the contact page when you are ready to turn the research path into a documented attic next step.";
  if (url === "/financing/") return "Open financing when the attic scope is becoming clearer and the homeowner needs payment-path context too.";
  if (url === "/locations/") return "Use the locations page to pick the right real market hub before drilling further into city or service pages.";
  return `Open ${label} as the next relevant page in the attic planning path.`;
}

function renderRelatedLinksSection(page, currentUrl) {
  const uniqueLinks = (page.related_links || []).filter((item, index, list) => item.url !== page.url && list.findIndex((candidate) => candidate.url === item.url) === index);
  if (!uniqueLinks.length) return "";

  const cards = uniqueLinks.slice(0, 3).map((item) => ({
    url: item.url,
    title: item.label,
    kicker: "Best next page",
    text: relatedLinkText(item.url, item.label),
    image: relatedLinkImage(item.url),
    alt: item.label,
    cta: "Open page"
  }));

  return `
    <section class="section">
      <div class="section-heading reveal">
        <p class="eyebrow">Best next pages</p>
        <h2>Keep moving through the site without hitting a dead end.</h2>
        <p class="section-subcopy">These are the most relevant next pages from here based on the current attic topic, market, or support path.</p>
      </div>
      ${renderFeatureGrid(cards, currentUrl, true)}
    </section>
  `;
}

function renderHeader(currentUrl, page) {
  const pagePhone = phoneForPage(page);

  return `
    <header class="site-header" data-header>
      <a class="brand" href="${hrefFrom(currentUrl, "/")}" aria-label="Good Attic home">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>Good Attic</span>
      </a>

      <div class="mobile-header-actions">
        <div class="phone-dropdown mobile-header-phone" data-phone-dropdown>
          <button class="nav-cta nav-cta--phone mobile-phone-button" type="button" aria-expanded="false" data-phone-dropdown-toggle>
            ${escapeHtml(pagePhone.phoneDisplay)}
          </button>
          <div class="phone-dropdown__menu">
            <a href="${pagePhone.phoneHref}">Call</a>
            <a href="${pagePhone.smsHref}">Text</a>
          </div>
        </div>

        <button class="menu-toggle" type="button" aria-label="Open navigation" aria-expanded="false" data-menu-toggle>
          <span></span>
          <span></span>
        </button>
      </div>

      <nav class="nav" data-nav>
        ${navLink(currentUrl, "/services/", "Services")}
        ${navLink(currentUrl, "/reviews/", "Reviews")}
        ${navLink(currentUrl, "/financing/", "Financing")}
        <div class="nav-dropdown" data-dropdown>
          <button class="nav-dropdown__button" type="button" aria-expanded="false" data-dropdown-toggle>
            Service Areas
          </button>
          <div class="nav-dropdown__menu">
            <a href="${hrefFrom(currentUrl, "/locations/")}">All Locations</a>
            <a href="${hrefFrom(currentUrl, "/salt-lake-city-ut/")}">Salt Lake City</a>
            <a href="${hrefFrom(currentUrl, "/st-louis-mo/")}">St. Louis</a>
            <a href="${hrefFrom(currentUrl, "/kansas-city-mo/")}">Kansas City</a>
          </div>
        </div>
        ${navLink(currentUrl, "/about/", "About")}
        <div class="phone-dropdown" data-phone-dropdown>
          <button class="nav-cta nav-cta--phone" type="button" aria-expanded="false" data-phone-dropdown-toggle>
            ${escapeHtml(pagePhone.phoneDisplay)}
          </button>
          <div class="phone-dropdown__menu">
            <a href="${pagePhone.phoneHref}">Call</a>
            <a href="${pagePhone.smsHref}">Text</a>
          </div>
        </div>
        <button class="nav-cta" type="button" data-open-modal>Get A Quote</button>
      </nav>
    </header>
  `;
}

function renderFooter() {
  return `
    <footer class="footer">
      <p class="footer-links">
        <a href="/">Home</a>
        <a href="/services/">Services</a>
        <a href="/resources/">Resources</a>
        <a href="/locations/">Locations</a>
        <a href="/contact/">Contact</a>
      </p>
      <p>© <span data-year></span> ${escapeHtml(site.name)}. ${escapeHtml(site.footerSummary)}</p>
      <p>${escapeHtml(site.footerDisclaimer)}</p>
    </footer>
  `;
}

function renderProjectPicker(currentUrl, compact = false) {
  const options = [
    {
      label: "Attic Insulation",
      value: "Attic Insulation",
      image: "assets/attic-insulation.png"
    },
    {
      label: "Insulation Removal",
      value: "Insulation Removal",
      image: "assets/attic-insulation-removal.png"
    },
    {
      label: "Attic Pest Issues",
      value: "Attic Pest Issues",
      image: "assets/animals-in-the-attic.png"
    },
    {
      label: "Attic Air Sealing",
      value: "Attic Air Sealing",
      image: "assets/attic-air-sealing.png"
    },
    {
      label: "Attic Fans",
      value: "Attic Fans",
      image: "assets/attic-fans.png"
    },
    {
      label: "Other",
      value: "Other",
      image: "assets/good-attic-logo-cropped.png",
      isOther: true
    }
  ];

  return `
    <fieldset class="project-picker${compact ? " project-picker--compact" : ""}">
      <legend class="screen-reader-text">Type of project</legend>
      <p class="project-picker__title">Type of project</p>
      <p class="project-picker__hint">Select all that apply</p>
      ${options
        .map(
          (option) => `
            <label class="project-option${option.isOther ? " project-option--other" : ""}">
              <input type="checkbox" name="project_type" value="${escapeHtml(option.value)}">
              <span class="project-option__image">${renderImg(currentUrl, option.image, "", { ariaHidden: true })}</span>
              <span class="project-option__label">${escapeHtml(option.label)}</span>
            </label>
          `
        )
        .join("")}
    </fieldset>
  `;
}

function renderModal(currentUrl) {
  return `
    <div class="modal" aria-hidden="true" data-modal>
      <div class="modal-backdrop" data-close-modal></div>
      <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <button class="modal-close" type="button" aria-label="Close modal" data-close-modal>&times;</button>
        <div class="modal-visual">
          <div class="mini-phone attic-mini">
            <span class="mini-logo" aria-hidden="true"></span>
            <strong>Good Attic</strong>
            <p>Photo-based attic assessments for homeowners who want a clear plan.</p>
          </div>
        </div>
        <div class="modal-content">
          <div class="modal-progress" data-modal-progress aria-hidden="true"><span></span></div>
          <h2 id="modal-title">Request your free attic quote.</h2>
          <p>Takes about 30 seconds to complete.</p>
          <form class="contact-form modal-form" data-lead-form data-form-name="Quote modal form" data-ghl-webhook="/api/leads">
            <input type="hidden" name="lead_source" value="Good Attic website">
            <input type="hidden" name="form_name" value="Quote modal form">
            <input type="hidden" name="source_page" data-source-page>
            ${renderProjectPicker(currentUrl, true)}
            <h3 class="form-section-title">Contact</h3>
            <div class="form-two">
              <label>
                <span>First name</span>
                <input type="text" name="first_name" autocomplete="given-name" required>
              </label>
              <label>
                <span>Last name</span>
                <input type="text" name="last_name" autocomplete="family-name" required>
              </label>
            </div>
            <div class="form-two">
              <label>
                <span>Phone number</span>
                <input type="tel" name="phone" autocomplete="tel" required>
              </label>
              <label>
                <span>Email</span>
                <input type="email" name="email" autocomplete="email" required>
              </label>
            </div>
            <h3 class="form-section-title">Property Address</h3>
            <label>
              <span>Street address</span>
              <input type="text" name="street_address" autocomplete="address-line1" required>
            </label>
            <div class="form-three">
              <label>
                <span>City</span>
                <input type="text" name="city" autocomplete="address-level2" required>
              </label>
              <label>
                <span>State</span>
                <input type="text" name="state" autocomplete="address-level1" required>
              </label>
              <label>
                <span>ZIP code</span>
                <input type="text" name="zip" autocomplete="postal-code" inputmode="numeric" required>
              </label>
            </div>
            <h3 class="form-section-title">Appointment Preference</h3>
            <div class="form-two">
              <label>
                <span>Preferred day</span>
                <input type="date" name="preferred_day">
              </label>
              <label>
                <span>Preferred time</span>
                <select name="preferred_time">
                  <option value="">Select</option>
                  <option>Morning</option>
                  <option>Midday</option>
                  <option>Afternoon</option>
                  <option>Evening</option>
                  <option>Anytime</option>
                </select>
              </label>
            </div>
            <label>
              <span>Additional notes</span>
              <textarea name="additional_notes" rows="3"></textarea>
            </label>
            <button class="button primary" type="submit">Request My Free Quote</button>
            <p class="form-status" data-form-status aria-live="polite"></p>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderLeadForm(currentUrl) {
  return `
    <form class="contact-form reveal lead-form" data-lead-form data-form-name="Contact page form" data-ghl-webhook="/api/leads">
      <input type="hidden" name="lead_source" value="Good Attic website">
      <input type="hidden" name="form_name" value="Contact page form">
      <input type="hidden" name="source_page" data-source-page>

      ${renderProjectPicker(currentUrl)}

      <h3 class="form-section-title">Contact</h3>
      <div class="form-two">
        <label>
          <span>First name</span>
          <input type="text" name="first_name" autocomplete="given-name" placeholder="First name" required>
        </label>
        <label>
          <span>Last name</span>
          <input type="text" name="last_name" autocomplete="family-name" placeholder="Last name" required>
        </label>
      </div>

      <div class="form-two">
        <label>
          <span>Phone number</span>
          <input type="tel" name="phone" autocomplete="tel" placeholder="${escapeHtml(site.phoneDisplay)}" required>
        </label>
        <label>
          <span>Email</span>
          <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required>
        </label>
      </div>

      <h3 class="form-section-title">Property Address</h3>
      <label>
        <span>Street address</span>
        <input type="text" name="street_address" autocomplete="address-line1" placeholder="Street address" required>
      </label>

      <div class="form-three">
        <label>
          <span>City</span>
          <input type="text" name="city" autocomplete="address-level2" placeholder="City" required>
        </label>
        <label>
          <span>State</span>
          <input type="text" name="state" autocomplete="address-level1" placeholder="State" required>
        </label>
        <label>
          <span>ZIP code</span>
          <input type="text" name="zip" autocomplete="postal-code" inputmode="numeric" placeholder="ZIP" required>
        </label>
      </div>

      <h3 class="form-section-title">Appointment Preference</h3>
      <div class="form-two">
        <label>
          <span>Preferred day for free quote</span>
          <input type="date" name="preferred_day">
        </label>
        <label>
          <span>Preferred time of day</span>
          <select name="preferred_time">
            <option value="">Select one</option>
            <option>Morning</option>
            <option>Midday</option>
            <option>Afternoon</option>
            <option>Evening</option>
            <option>Anytime</option>
          </select>
        </label>
      </div>

      <label>
        <span>Additional notes for the team</span>
        <textarea name="additional_notes" rows="4" placeholder="Tell us what you are seeing, what rooms feel uncomfortable, or anything else we should know."></textarea>
      </label>

      <button class="button primary" type="submit">Request My Free Quote</button>
      <p class="form-status" data-form-status aria-live="polite"></p>
    </form>
  `;
}

function renderHomepageLeadForm(currentUrl, formName) {
  return `
    <form class="contact-form reveal lead-form" data-lead-form data-form-name="${escapeHtml(formName)}" data-ghl-webhook="/api/leads">
      <input type="hidden" name="lead_source" value="Good Attic website">
      <input type="hidden" name="form_name" value="${escapeHtml(formName)}">
      <input type="hidden" name="source_page" data-source-page>

      ${renderProjectPicker(currentUrl)}

      <h3 class="form-section-title">Contact</h3>
      <div class="form-two">
        <label>
          <span>First name</span>
          <input type="text" name="first_name" autocomplete="given-name" placeholder="First name" required>
        </label>
        <label>
          <span>Last name</span>
          <input type="text" name="last_name" autocomplete="family-name" placeholder="Last name" required>
        </label>
      </div>

      <div class="form-two">
        <label>
          <span>Phone number</span>
          <input type="tel" name="phone" autocomplete="tel" placeholder="${escapeHtml(site.phoneDisplay)}" required>
        </label>
        <label>
          <span>Email</span>
          <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required>
        </label>
      </div>

      <h3 class="form-section-title">Property Address</h3>
      <label>
        <span>Street address</span>
        <input type="text" name="street_address" autocomplete="address-line1" placeholder="Street address" required>
      </label>

      <div class="form-three">
        <label>
          <span>City</span>
          <input type="text" name="city" autocomplete="address-level2" placeholder="City" required>
        </label>
        <label>
          <span>State</span>
          <input type="text" name="state" autocomplete="address-level1" placeholder="State" required>
        </label>
        <label>
          <span>ZIP code</span>
          <input type="text" name="zip" autocomplete="postal-code" inputmode="numeric" placeholder="ZIP" required>
        </label>
      </div>

      <h3 class="form-section-title">Appointment Preference</h3>
      <div class="form-two">
        <label>
          <span>Preferred day for free quote</span>
          <input type="date" name="preferred_day">
        </label>
        <label>
          <span>Preferred time of day</span>
          <select name="preferred_time">
            <option value="">Select one</option>
            <option>Morning</option>
            <option>Midday</option>
            <option>Afternoon</option>
            <option>Evening</option>
            <option>Anytime</option>
          </select>
        </label>
      </div>

      <label>
        <span>Additional notes for the team</span>
        <textarea name="additional_notes" rows="4" placeholder="Tell us what you are seeing, what rooms feel uncomfortable, or anything else we should know."></textarea>
      </label>

      <button class="button primary" type="submit">Request My Free Quote</button>
      <p class="form-status" data-form-status aria-live="polite"></p>
    </form>
  `;
}

function renderHiddenBreadcrumbs(page, currentUrl) {
  return `
    <nav class="screen-reader-text" aria-label="Breadcrumbs">
      <ol>
        ${page.breadcrumb_items
          .map((item, index) => {
            const isLast = index === page.breadcrumb_items.length - 1;
            return `<li>${
              isLast
                ? `<span aria-current="page">${escapeHtml(item.label)}</span>`
                : `<a href="${hrefFrom(currentUrl, item.url)}">${escapeHtml(item.label)}</a>`
            }</li>`;
          })
          .join("")}
      </ol>
    </nav>
  `;
}

function serviceUiName(service) {
  return service.slug === "attic-pest-remediation" ? "Attic Pest Issues" : service.name;
}

function renderTileGrid(items) {
  return `
    <div class="tile-grid">
      ${items
        .map(
          (item) => `
            <article class="info-tile reveal">
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.text)}</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderFeatureGrid(cards, currentUrl, withImages = false) {
  return `
    <div class="feature-grid">
      ${cards
        .map(
          (card) => `
            <a class="feature-card page-card-link reveal" href="${hrefFrom(currentUrl, card.url)}">
              ${
                withImages
                  ? `<span class="page-card-link__media">${renderImg(currentUrl, card.image, card.alt || card.title)}</span>`
                  : ""
              }
              ${card.kicker ? `<p class="eyebrow page-card-link__kicker">${escapeHtml(card.kicker)}</p>` : ""}
              <h3>${escapeHtml(card.title)}</h3>
              <p>${escapeHtml(card.text)}</p>
              <span class="page-card-link__cta">${escapeHtml(card.cta || "Explore page")}</span>
            </a>
          `
        )
        .join("")}
    </div>
  `;
}

function renderEvidenceGrid(items, currentUrl) {
  return `
    <div class="feature-grid evidence-grid">
      ${items
        .map(
          (item) => `
            <article class="feature-card evidence-card reveal">
              <span class="page-card-link__media">${renderImg(currentUrl, item.image, item.alt || item.title)}</span>
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.text)}</p>
              ${item.caption ? `<span class="page-card-link__cta">${escapeHtml(item.caption)}</span>` : ""}
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderProofQueueGrid(items, currentUrl) {
  return `
    <div class="feature-grid proof-queue-grid">
      ${items
        .map(
          (item) => `
            <article class="feature-card proof-queue-card reveal${item.stars ? " proof-queue-card--review" : ""}">
              <span class="page-card-link__media">${renderImg(currentUrl, item.image, item.alt || item.title)}</span>
              ${item.kicker ? `<p class="eyebrow page-card-link__kicker">${escapeHtml(item.kicker)}</p>` : ""}
              <h3>${escapeHtml(item.title)}</h3>
              ${item.stars ? renderReviewStars() : ""}
              ${item.stars ? renderExpandableReviewText(item.text, "proof-review__quote") : `<p>${escapeHtml(item.text)}</p>`}
              ${item.status ? `<span class="proof-status">${escapeHtml(item.status)}</span>` : ""}
              ${
                item.meta?.length
                  ? `<div class="proof-meta-list">${item.meta.map((meta) => `<span>${escapeHtml(meta)}</span>`).join("")}</div>`
                  : ""
              }
              ${
                item.url && item.cta
                  ? `<a class="page-card-link__cta" href="${hrefFrom(currentUrl, item.url)}">${escapeHtml(item.cta)}</a>`
                  : ""
              }
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderAudiencePanels(items) {
  return `
    <div class="audience-panels">
      ${items
        .map(
          (item) => `
            <article class="audience-panel reveal">
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.text)}</p>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderFaq(items) {
  return `
    <div class="faq-list">
      ${items
        .map(
          (item) => `
            <details class="faq-item reveal">
              <summary>${escapeHtml(item.question)}</summary>
              <p>${escapeHtml(item.answer)}</p>
            </details>
          `
        )
        .join("")}
    </div>
  `;
}

function renderCtaStrip(currentUrl, title, text, primary) {
  return `
    <section class="cta-strip reveal">
      <div>
        <p class="eyebrow">${escapeHtml(primary.kicker || "Next step")}</p>
        <h2>${escapeHtml(title)}</h2>
        <p class="section-subcopy section-subcopy--light">${escapeHtml(text)}</p>
      </div>
      <div class="cta-strip__actions">
        <a class="button primary" href="${hrefFrom(currentUrl, primary.url)}">${escapeHtml(primary.label)}</a>
        <a class="button secondary" href="${hrefFrom(currentUrl, "/financing/")}">Financing Options</a>
      </div>
    </section>
  `;
}

function renderStructuredSection(section, currentUrl) {
  if (section.layout === "tiles") return renderTileGrid(section.items);
  if (section.layout === "panels") return renderAudiencePanels(section.items);
  if (section.layout === "features") return renderFeatureGrid(section.items, currentUrl, section.withImages || false);
  return "";
}

function renderResourcePage(page, currentUrl) {
  return `
    ${renderHero(currentUrl, page, {
      eyebrow: page.hero?.eyebrow || "Resources",
      cardKicker: page.hero?.cardKicker || "Decision guide",
      cardTitle: page.hero?.cardTitle || page.h1,
      cardText: page.hero?.cardText || page.intro,
      cardPoints: page.hero?.cardPoints || page.trust_elements
    })}

    ${page.sections
      .map(
        (section) => `
          <section class="section">
            <div class="section-heading reveal">
              <p class="eyebrow">${escapeHtml(section.eyebrow)}</p>
              <h2>${escapeHtml(section.heading)}</h2>
              ${section.subcopy ? `<p class="section-subcopy">${escapeHtml(section.subcopy)}</p>` : ""}
            </div>
            ${renderStructuredSection(section, currentUrl)}
          </section>
        `
      )
      .join("")}

    <section class="section">
      <div class="section-heading reveal">
        <p class="eyebrow">FAQ</p>
        <h2>Questions about ${escapeHtml(page.h1.toLowerCase())}.</h2>
      </div>
      ${renderFaq(page.faq_items)}
    </section>

    ${renderRelatedLinksSection(page, currentUrl)}

    ${renderCtaStrip(currentUrl, page.cta.title, page.cta.text, page.cta.primary)}
  `;
}

function renderHero(currentUrl, page, options = {}) {
  const actions =
    options.actions ||
    [
      { label: page.cta_primary, url: "/contact/" },
      { label: "Get A Quote", modal: true }
    ];

  return `
    <section class="section page-hero${options.heroClass ? ` ${escapeHtml(options.heroClass)}` : ""}">
      ${renderBreadcrumbs(page, currentUrl)}
      <div class="page-hero__layout">
        <div class="page-hero__copy">
          <p class="eyebrow">${escapeHtml(options.eyebrow || page.h1)}</p>
          <h1>${escapeHtml(page.h1)}</h1>
          <p class="page-intro">${escapeHtml(page.intro)}</p>
          ${
            actions.length
              ? `<div class="page-hero__actions">
                  ${actions
                    .map((action) =>
                      action.modal
                        ? `<button class="button ${action.secondary ? "secondary" : "primary"}" type="button" data-open-modal>${escapeHtml(
                            action.label
                          )}</button>`
                        : `<a class="button ${action.secondary ? "secondary" : "primary"}" href="${hrefFrom(
                            currentUrl,
                            action.url
                          )}">${escapeHtml(action.label)}</a>`
                    )
                    .join("")}
                </div>`
              : ""
          }
        </div>
        <aside class="inspection-panel page-hero__card">
          <p class="panel-kicker">${escapeHtml(options.cardKicker || "Good Attic")}</p>
          <h2>${escapeHtml(options.cardTitle || "A better attic plan starts with the right route.")}</h2>
          <p>${escapeHtml(
            options.cardText ||
              "Use the links and sections on this page to move from broad attic problems into the right local pages without leaving the design system behind."
          )}</p>
          ${
            options.cardPoints
              ? `<div class="page-chip-list">${options.cardPoints
                  .map((point) => `<span class="page-chip">${escapeHtml(point)}</span>`)
                  .join("")}</div>`
              : ""
          }
        </aside>
      </div>
    </section>
  `;
}

function buildMarketLinks(currentUrl, market) {
  return serviceCatalog.map((service) => ({
    url: `/${market.slug}/${service.slug}/`,
    title: service.name,
    kicker: market.shortName,
    text: service.summary,
    image: service.image,
    alt: `${service.name} service in ${market.name}`,
    cta: "View local service"
  }));
}

function buildSupportCityLinks(currentUrl, market) {
  return market.supportCities.map((city) => ({
    url: `/${market.slug}/service-areas/${city.slug}/`,
    title: city.name,
    kicker: "Service area",
    text: `Explore the attic services, common local issues, and next-step links for homeowners in ${city.shortName}.`,
    image: "assets/good-attic-insulation-sales-appointment.png",
    alt: `${city.name} service area support page`,
    cta: "Explore city page"
  }));
}

function renderHeroReviewBanner(includeReviewCount = false) {
  return `
    <div class="hero-review-banner" aria-label="Google review rating">
      <span class="hero-review-banner__google">G</span>
      <strong>5.0</strong>
      <span class="hero-review-banner__stars" aria-label="Five star rating">★★★★★</span>
      ${includeReviewCount ? '<span class="hero-review-banner__count">100+</span>' : ""}
      <span>Google Reviews</span>
    </div>
  `;
}

function renderSharedAtticHealthLead() {
  return `<div class="inspection-lead inspection-lead--module reveal">A <span class="gradient-text">Good Attic</span> quietly changes how your whole home feels.</div>`;
}

function renderSharedReviewBand(widgetMarkup) {
  return `
    <section class="media-band reveal">
      <div class="media-caption">
        <p>A <span class="gradient-text">Good Attic</span> quietly changes how your whole home feels.</p>
      </div>
      ${widgetMarkup}
    </section>
  `;
}

function renderSharedAtticHealthCard(ariaLabel, scoreLabel = "Attic Health Score") {
  return `
    <div class="hero-device attic-card reveal" aria-label="${escapeHtml(ariaLabel)}">
      <div class="inspection-panel">
        <p class="panel-kicker">${escapeHtml(scoreLabel)}</p>
        <div class="score-row">
          <div class="score-column">
            <div class="score-ring score-ring--before" data-score-ring data-score="42">
              <strong data-score-value>0</strong>
              <span>before Good Attic</span>
            </div>
            <div class="inspection-list inspection-list--before">
              <p><span></span> Compressed or missing insulation</p>
              <p><span></span> Air leaks around attic penetrations</p>
              <p><span></span> Dust, odors, or contaminated material</p>
              <p><span></span> Pest activity or nesting debris</p>
            </div>
          </div>
          <div class="score-column">
            <div class="score-ring score-ring--after" data-score-ring data-score="100">
              <strong data-score-value>0</strong>
              <span>after Good Attic</span>
            </div>
            <div class="inspection-list">
              <p><span></span> Contaminated insulation removed</p>
              <p><span></span> Air leaks sealed for efficiency</p>
              <p><span></span> Attic fully sanitized</p>
              <p><span></span> Ventilation optimized</p>
              <p><span></span> Fresh insulation installed</p>
            </div>
          </div>
        </div>
        <button class="button primary" type="button" data-open-modal>Schedule a Visit</button>
      </div>
    </div>
  `;
}

function renderExpandableReviewText(text, className) {
  const isLong = text.length > 230;

  return `
    <div class="review-copy${isLong ? " is-collapsible" : ""}" data-review-card>
      <p class="${className}" data-review-copy>${escapeHtml(text)}</p>
      ${
        isLong
          ? '<button class="review-toggle" type="button" data-review-toggle aria-expanded="false">Read more</button>'
          : ""
      }
    </div>
  `;
}

function renderReviewWidgetHeader(title, kicker = "Google Reviews") {
  return `
    <div class="review-widget__header">
      <div class="google-mark" aria-hidden="true">
        <span>G</span>
      </div>
      <div>
        <p class="panel-kicker">${escapeHtml(kicker)}</p>
        <h2>${escapeHtml(title)}</h2>
        <div class="review-widget__rating" aria-label="5 out of 5 stars on Google Reviews">
          <strong>5.0</strong>
          <span class="stars" aria-hidden="true">★★★★★</span>
          <span>100+ Google Reviews</span>
        </div>
      </div>
    </div>
  `;
}

function renderReviewStars(className = "review-stars") {
  return `
    <div class="${className}" aria-label="5 out of 5 stars">
      <span aria-hidden="true">★</span>
      <span aria-hidden="true">★</span>
      <span aria-hidden="true">★</span>
      <span aria-hidden="true">★</span>
      <span aria-hidden="true">★</span>
    </div>
  `;
}

function renderMiniReviewCard(entry, currentUrl) {
  return `
    <article class="review-excerpt-mini">
      ${renderReviewStars()}
      ${renderExpandableReviewText(entry.quote, "review-excerpt-mini__quote")}
      <div class="review-excerpt-mini__meta">
        <strong>${escapeHtml(entry.reviewerLabel || "Local homeowner")}</strong>
        <span>${escapeHtml(entry.source || "Approved review excerpt")}</span>
      </div>
      ${
        entry.targetUrl && entry.targetLabel
          ? `<a class="page-card-link__cta" href="${hrefFrom(currentUrl, entry.targetUrl)}">${escapeHtml(entry.targetLabel)}</a>`
          : ""
      }
    </article>
  `;
}

function marketHubReviewEntries(marketSlug) {
  return approvedReviewEntries({ marketSlug }).filter((entry) => !entry.city);
}

function renderMarketReviewWidget(currentUrl, market) {
  const reviewEntries = marketHubReviewEntries(market.slug);

  return `
    <aside class="review-widget review-widget--market" aria-label="${escapeHtml(market.shortName)} Google review widget">
      ${renderReviewWidgetHeader(`${market.shortName} homeowner feedback`)}
      <div class="review-widget__stack">
        <div class="review-widget__shell">
          <strong>${escapeHtml(market.shortName)} review widget zone</strong>
          <p>Use this area for the actual Google Business Profile review widget tied to the ${escapeHtml(
            market.shortName
          )} market so the location hub carries the fuller live review feed.</p>
          <a class="page-card-link__cta" href="${hrefFrom(currentUrl, "/reviews/")}">Open review library</a>
        </div>
        ${
          reviewEntries.length
            ? `
              <div class="review-carousel" aria-label="${escapeHtml(market.shortName)} approved homeowner excerpts">
                <div class="review-carousel__track">
                  ${reviewEntries
                    .map(
                      (entry) => `
                        <article class="review-carousel__card">
                          ${renderReviewStars()}
                          ${renderExpandableReviewText(entry.quote, "review-carousel__quote")}
                          <div class="review-carousel__meta">
                            <strong>${escapeHtml(entry.reviewerLabel || "Local homeowner")}</strong>
                            <span>${escapeHtml(entry.source || "Approved review excerpt")}</span>
                          </div>
                        </article>
                      `
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }
      </div>
    </aside>
  `;
}

function renderCityReviewWidget(currentUrl, market, city) {
  const reviewEntries = approvedReviewEntries({ marketSlug: market.slug })
    .filter((entry) => entry.city === city.slug)
    .slice(0, 3);

  if (reviewEntries.length) {
    return `
      <aside class="review-widget review-widget--city" aria-label="${escapeHtml(city.shortName)} homeowner reviews">
        ${renderReviewWidgetHeader(`${city.shortName} trust signals`, "Local homeowner reviews")}
        <div class="review-excerpt-list">
          ${reviewEntries.map((entry) => renderMiniReviewCard(entry, currentUrl)).join("")}
        </div>
      </aside>
    `;
  }

  return `
    <aside class="review-widget review-widget--city" aria-label="${escapeHtml(city.shortName)} homeowner reviews">
      ${renderReviewWidgetHeader(`${city.shortName} proof path`, "Local homeowner reviews")}
      <div class="review-widget__shell">
        <strong>${escapeHtml(city.shortName)} excerpt zone</strong>
        <p>Use this section for individual approved homeowner excerpts that match the attic issues, service mix, and local trust questions most relevant near ${escapeHtml(
          city.shortName
        )}.</p>
        <a class="page-card-link__cta" href="${hrefFrom(currentUrl, "/reviews/")}">Open review library</a>
      </div>
    </aside>
  `;
}

function buildMarketEvidenceGallery(market) {
  return [
    {
      title: "Compromised insulation conditions",
      text: `In ${market.shortName}, Good Attic documents when the existing insulation is dusty, uneven, contaminated, or simply no longer a strong base for the next step.`,
      image: proofAssets.dirtyReset,
      alt: `Dirty attic insulation conditions commonly documented in ${market.name}`,
      caption: "Document the actual attic condition before deciding on the scope."
    },
    {
      title: "Coverage and install readiness",
      text: `Assessment photos help show whether the attic floor is ready for added insulation, needs edge/pathway prep, or should be reset first.`,
      image: proofAssets.hotColdInsulation,
      alt: `Attic insulation depth and coverage conditions documented in ${market.name}`,
      caption: "A stronger attic scope starts with visible evidence, not guesswork."
    },
    {
      title: "Air sealing and bypass targets",
      text: `Good Attic documents where the attic boundary is open so insulation, sealing, and cleanup can be sequenced into one clearer plan.`,
      image: proofAssets.airSealing,
      alt: `Attic air sealing targets documented in ${market.name}`,
      caption: "Show what needs to be tightened before the attic is finished."
    }
  ];
}

function buildServiceEvidenceGallery(market, service) {
  const galleries = {
    "attic-insulation": [
      {
        title: "Thin or uneven attic coverage",
        text: `Photos help show where the attic insulation is falling short in ${market.shortName}, especially when upper-floor comfort complaints are stronger than the attic looks at first glance.`,
        image: proofAssets.hotColdInsulation,
        alt: `${service.name} assessment documentation in ${market.name}`,
        caption: "Document whether the attic needs a top-off or a more complete reset."
      },
      {
        title: "Conditions that block a simple top-off",
        text: "Dirty material, rodent activity, and buried leakage points all change whether more insulation alone is the honest answer.",
        image: proofAssets.grossDusty,
        alt: `Compromised attic insulation conditions in ${market.name}`,
        caption: "Show what is underneath before adding new material on top."
      },
      {
        title: "A cleaner, more intentional finished attic floor",
        text: "The finished result should show cleaner coverage, a better target depth, and an attic that looks like it was rebuilt on purpose.",
        image: proofAssets.insulation,
        alt: `Finished attic insulation outcome in ${market.name}`,
        caption: "A better attic should look more deliberate, not just fuller."
      }
    ],
    "insulation-removal": [
      {
        title: "Material that is no longer worth building on",
        text: `Removal scopes in ${market.shortName} start with documenting contamination, settling, odor, or material breakdown that changes the whole attic plan.`,
        image: proofAssets.dirtyReset,
        alt: `Insulation removal conditions documented in ${market.name}`,
        caption: "Removal begins when the base layer is no longer the right foundation."
      },
      {
        title: "Access to the attic floor after the reset",
        text: "Once the old material is out, the attic floor becomes easier to inspect, seal, sanitize, and prepare for what comes next.",
        image: proofAssets.removal,
        alt: `Attic reset and insulation removal process in ${market.name}`,
        caption: "A clean reset reveals what the attic actually needs next."
      },
      {
        title: "A cleaner handoff into restoration",
        text: "The better finish line is not just emptier. It is an attic that is ready for sealing, sanitation, and the right reinstall strategy.",
        image: proofAssets.grossAttic,
        alt: `Attic restoration readiness after insulation removal in ${market.name}`,
        caption: "Removal should set up the rest of the attic plan, not interrupt it."
      }
    ],
    "attic-pest-remediation": [
      {
        title: "The real spread of contamination",
        text: `Good Attic documents how much insulation, debris, and attic surface area in ${market.shortName} have actually been affected after pest activity.`,
        image: proofAssets.pests,
        alt: `Attic pest contamination documented in ${market.name}`,
        caption: "The visible mess is not always the full extent of the problem."
      },
      {
        title: "Insulation damage that changes the scope",
        text: "Rodent or squirrel activity often leaves behind more than a cleanup problem. It can leave the attic with insulation that is no longer worth saving.",
        image: proofAssets.pestDamage,
        alt: `Insulation damage from attic pests in ${market.name}`,
        caption: "Documentation helps separate exclusion work from real attic restoration."
      },
      {
        title: "A healthier attic environment",
        text: "The attic should feel cleaner, more trustworthy, and better prepared for reinstallation than it did while the contamination was still being tolerated.",
        image: proofAssets.removal,
        alt: `Cleaner attic environment after pest remediation in ${market.name}`,
        caption: "A finished remediation scope restores the attic, not just the homeowner's patience."
      }
    ],
    "attic-fans": [
      {
        title: "The attic heat-management context",
        text: `In ${market.shortName}, Good Attic documents whether the fan conversation is actually about trapped heat, weak insulation, open bypasses, or a combination.`,
        image: proofAssets.fans,
        alt: `Attic fan assessment context in ${market.name}`,
        caption: "The fan should support the attic system, not hide what is wrong with it."
      },
      {
        title: "Ventilation pathways and fit",
        text: "The attic has to be a real candidate for fan support, which means documenting how the current airflow path is working before a product gets recommended.",
        image: proofAssets.unevenTemps,
        alt: `Ventilation pathway documentation for attic fans in ${market.name}`,
        caption: "Good fan recommendations come after the airflow story is clear."
      },
      {
        title: "A better-supported attic heat plan",
        text: "When the attic is a strong fit, the end result should show a fan that belongs in a broader comfort strategy rather than acting like a stand-alone fix.",
        image: proofAssets.fans,
        alt: `Attic fan outcome in ${market.name}`,
        caption: "Heat-management products should fit the attic, not lead it blindly."
      }
    ],
    "attic-air-sealing": [
      {
        title: "Open attic bypasses and leakage targets",
        text: `Good Attic documents where the attic floor is actually open in ${market.shortName} so the sealing plan is based on real leakage, not assumptions.`,
        image: proofAssets.airSealing,
        alt: `Attic air sealing targets documented in ${market.name}`,
        caption: "Find the leaks first so the scope matches the real attic boundary."
      },
      {
        title: "Conditions that affect sealing access",
        text: "If the attic floor is buried under compromised material, the documentation should make it clear when cleanup or removal belongs before thorough sealing.",
        image: proofAssets.grossDusty,
        alt: `Attic floor access conditions affecting air sealing in ${market.name}`,
        caption: "A buried attic floor can change how the sealing work needs to happen."
      },
      {
        title: "A tighter attic boundary under the final insulation layer",
        text: "The end result should support a cleaner, more complete attic floor instead of leaving the underlying leakage problem untreated.",
        image: proofAssets.airSealing,
        alt: `Completed attic boundary support in ${market.name}`,
        caption: "Sealing should strengthen the attic floor the insulation depends on."
      }
    ]
  };

  return galleries[service.slug];
}

function buildMarketOutcomePanels(market) {
  return [
    {
      title: "Before-and-after documentation should be obvious",
      text: `Homeowners in ${market.shortName} should be able to see what changed through photos, scope notes, and a clearer final attic condition.`
    },
    {
      title: "The attic should feel cleaner, not just more expensive",
      text: "A premium attic outcome means the work resolved contamination, access, and finish-quality questions instead of only adding materials."
    },
    {
      title: "Comfort guidance should match the documented findings",
      text: "The finished attic story should connect directly to what was actually observed during inspection, not drift into generic promises."
    }
  ];
}

function buildCityEvidenceGallery(market, city) {
  return [
    {
      title: `${city.shortName} attic conditions that change the scope`,
      text: `Good Attic uses the ${market.shortName} team to document whether homes near ${city.shortName} need a clean top-off, a boundary correction, or a more complete attic reset.`,
      image: proofAssets.grossDusty,
      alt: `Attic conditions commonly documented near ${city.name}`,
      caption: "Assessment evidence helps route the home into the right market service path."
    },
    {
      title: "Visible insulation and access readiness",
      text: "The team documents whether the attic is ready for direct improvement or whether removal, cleanup, and prep work belong first.",
      image: proofAssets.hotColdHouse,
      alt: `Insulation and attic readiness near ${city.name}`,
      caption: "The right next step depends on what the attic is ready to support."
    },
    {
      title: "A cleaner handoff into the right local service page",
      text: `Once the attic is documented clearly, homeowners in ${city.shortName} can move into the correct ${market.shortName} service page with more confidence and less guesswork.`,
      image: proofAssets.sales,
      alt: `Attic documentation and homeowner guidance near ${city.name}`,
      caption: "Clear findings make the next local step easier to trust."
    }
  ];
}

function buildCityInspectionChecklist(market, city) {
  return [
    {
      title: `${city.shortName} attic condition and insulation quality`,
      text: `Good Attic checks whether homes near ${city.shortName} have a clean top-off opportunity, a settled insulation layer, or attic material that is no longer worth building on.`
    },
    {
      title: "Boundary leakage and comfort imbalance clues",
      text: `The ${market.shortName} team documents whether open attic bypasses, dusty airflow, or weak coverage are helping drive the comfort complaints homeowners notice first.`
    },
    {
      title: "Cleanup, access, and restoration readiness",
      text: `If the attic near ${city.shortName} needs removal, sanitation, or better access before the final install belongs, the inspection should show that clearly instead of skipping ahead to the easy sale.`
    }
  ];
}

function buildCityEscalationPanels(market, city) {
  return [
    {
      title: "The attic problem is bigger than one symptom",
      text: `When homes in ${city.shortName} have hot rooms, dirty insulation, and higher energy strain at the same time, the attic usually needs a broader plan than a one-line product pitch.`
    },
    {
      title: "The attic needs access before the real fix can happen",
      text: `If compromised insulation or debris is covering the attic floor, the project often expands because cleanup, removal, or prep work need to happen before the final improvement belongs.`
    },
    {
      title: "The homeowner wants the attic to feel resolved, not patched",
      text: `The cleaner answer in ${city.shortName} is often the one that leaves the attic easier to trust afterward, even when that means a fuller scope than the homeowner expected at first.`
    }
  ];
}

function buildCityResourceCards(market, city) {
  const combinedCityText = [
    city.intro,
    ...(city.commonProblems || []).flatMap((item) => [item.title, item.text]),
    ...(city.whyCall || []),
    ...(city.faq || []).flatMap((item) => [item.question, item.answer])
  ]
    .join(" ")
    .toLowerCase();

  const cards = [];

  cards.push({
    url: "/resources/what-happens-during-an-attic-inspection/",
    title: "What Happens During an Attic Inspection",
    kicker: "Best next guide",
    text: `Use this guide when homeowners in ${city.shortName} need a clearer picture of what the attic visit should document before choosing a service path.`,
    image: proofAssets.sales,
    alt: `Attic inspection guide for ${city.name}`,
    cta: "Read inspection guide"
  });

  if (combinedCityText.includes("hot upstairs") || combinedCityText.includes("upper") || combinedCityText.includes("heat")) {
    cards.push({
      url: "/resources/why-upstairs-rooms-stay-hot/",
      title: "Why Upstairs Rooms Stay Hot",
      kicker: "Comfort symptom guide",
      text: `This guide helps ${city.shortName} homeowners connect upstairs discomfort to the attic causes that usually need insulation, sealing, or broader correction.`,
      image: proofAssets.hotColdHouse,
      alt: `Hot upstairs attic guide for ${city.name}`,
      cta: "Read comfort guide"
    });
  }

  if (
    combinedCityText.includes("dirty") ||
    combinedCityText.includes("cleanup") ||
    combinedCityText.includes("contamin") ||
    combinedCityText.includes("pest") ||
    combinedCityText.includes("rodent")
  ) {
    cards.push({
      url: "/resources/when-attic-cleanup-becomes-restoration/",
      title: "When Attic Cleanup Becomes Restoration",
      kicker: "Cleanup scope guide",
      text: `This guide helps ${city.shortName} homeowners understand when the attic needs a cleaner reset instead of a small cleanup or quick top-off.`,
      image: proofAssets.grossAttic,
      alt: `Attic cleanup and restoration guide for ${city.name}`,
      cta: "Read cleanup guide"
    });
  }

  cards.push({
    url: `/resources/attic-insulation-cost-${market.slug}/`,
    title: `Attic Insulation Cost in ${market.name}`,
    kicker: "Local cost guide",
    text: `Use the ${market.shortName} cost guide when the local question is not just what the attic needs, but what usually makes the honest quote in this market grow.`,
    image: proofAssets.hotColdInsulation,
    alt: `Attic insulation cost guide for ${market.name}`,
    cta: "Compare cost drivers"
  });

  if (combinedCityText.includes("fan") || combinedCityText.includes("ventilation")) {
    cards.push({
      url: "/resources/attic-fan-vs-ventilation-fix/",
      title: "Attic Fan vs Ventilation Fix",
      kicker: "Ventilation guide",
      text: `This guide helps ${city.shortName} homeowners avoid forcing the attic fan conversation before the rest of the attic story is clear.`,
      image: proofAssets.fans,
      alt: `Attic fan guide for ${city.name}`,
      cta: "Read fan guide"
    });
  }

  const unique = [];
  const seen = new Set();
  for (const card of cards) {
    if (!seen.has(card.url)) {
      seen.add(card.url);
      unique.push(card);
    }
  }

  return unique.slice(0, 4);
}

function buildCoreServicePage(service) {
  const coreServiceTitles = {
    "attic-insulation": "Attic Insulation Services",
    "insulation-removal": "Insulation Removal Services",
    "attic-pest-remediation": "Attic Pest Remediation Services",
    "attic-fans": "Attic Fan Services",
    "attic-air-sealing": "Attic Air Sealing Services"
  };

  const primaryKeywords = {
    "attic-insulation": "attic insulation services",
    "insulation-removal": "insulation removal services",
    "attic-pest-remediation": "attic pest remediation services",
    "attic-fans": "attic fan services",
    "attic-air-sealing": "attic air sealing services"
  };

  const metaDescriptions = {
    "attic-insulation":
      "Learn how Good Attic approaches attic insulation services for comfort, efficiency, and whole-attic performance, then find the right local page.",
    "insulation-removal":
      "Learn how Good Attic handles insulation removal for dirty, damaged, or contaminated attics, then find the right local service page.",
    "attic-pest-remediation":
      "Learn how Good Attic approaches attic pest remediation, cleanup, and restoration, then find the matching local service page.",
    "attic-fans":
      "Learn how Good Attic uses attic fan solutions to support ventilation and heat control, then find the right local service page.",
    "attic-air-sealing":
      "Learn how Good Attic approaches attic air sealing to reduce leaks, dust transfer, and energy waste, then find the right local service page."
  };

  const page = {
    slug: service.slug,
    url: `/services/${service.slug}/`,
    page_type: "core-service",
    market: null,
    city: null,
    primary_keyword: primaryKeywords[service.slug],
    secondary_keywords: [
      `${service.name.toLowerCase()} company`,
      `${service.name.toLowerCase()} contractor`,
      "attic services"
    ],
    seo_title: `${coreServiceTitles[service.slug]} | Good Attic`,
    meta_description: metaDescriptions[service.slug],
    h1: coreServiceTitles[service.slug],
    intro: `Good Attic approaches ${service.name.toLowerCase()} as part of a complete attic system. ${service.summary}`,
    page_purpose: "Central service detail page",
    cta_primary: "Book an Attic Inspection",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Services", url: "/services/" },
      { label: service.name, url: `/services/${service.slug}/` }
    ],
    canonical_url: `${site.baseUrl}/services/${service.slug}/`,
    related_links: [
      { label: "Attic Services", url: "/services/" },
      ...marketCatalog.map((market) => ({
        label: `${service.name} in ${market.name}`,
        url: `/${market.slug}/${service.slug}/`
      })),
      ...service.related.map((relatedSlug) => {
        const relatedService = serviceCatalog.find((item) => item.slug === relatedSlug);
        return { label: relatedService.name, url: `/services/${relatedSlug}/` };
      }),
      { label: "Contact Good Attic", url: "/contact/" }
    ],
    faq_items: service.faq,
    trust_elements: [
      "Central service overview",
      "Routes into local service pages",
      "Built around the full attic system"
    ]
  };

  page.render = (currentUrl) => `
    ${renderHero(currentUrl, page, {
      eyebrow: "Core Service",
      cardKicker: "Service overview",
      cardTitle: service.heroHeading,
      cardText:
        "This page explains the service, the problems it solves, and how it fits into a complete attic plan. Use the local links below when you want service details for a specific metro.",
      cardPoints: service.process,
      actions: [{ label: "Book an Attic Inspection", modal: true }]
    })}

    <section class="section">
      <div class="section-heading reveal">
        <p class="eyebrow">What this service solves</p>
        <h2>${escapeHtml(service.name)} helps when the attic is creating these kinds of problems.</h2>
      </div>
      ${renderTileGrid(service.symptoms)}
    </section>

    <section class="section">
      <div class="section-heading reveal">
        <p class="eyebrow">When it fits</p>
        <h2>When ${escapeHtml(service.name.toLowerCase())} is the right next step.</h2>
      </div>
      ${renderAudiencePanels(service.rightFit)}
    </section>

    <section class="section">
      <div class="section-heading reveal">
        <p class="eyebrow">Local service pages</p>
        <h2>Find ${escapeHtml(service.name.toLowerCase())} in your market.</h2>
        <p class="section-subcopy">${escapeHtml(
          "Choose the closest metro to see how this service applies in that local market."
        )}</p>
      </div>
      ${renderFeatureGrid(
        marketCatalog.map((market) => ({
          url: `/${market.slug}/${service.slug}/`,
          title: `${service.name} in ${market.name}`,
          kicker: "Local service page",
          text: service.marketIntro[market.slug],
          image: service.image,
          alt: `${service.name} in ${market.name}`,
          cta: "View local page"
        })),
        currentUrl,
        true
      )}
    </section>

    <section class="section">
      <div class="section-heading reveal">
        <p class="eyebrow">Related services</p>
        <h2>${escapeHtml(service.name)} often works best with the rest of the attic plan.</h2>
      </div>
      ${renderFeatureGrid(
        service.related.map((relatedSlug) => {
          const relatedService = serviceCatalog.find((item) => item.slug === relatedSlug);
          return {
            url: `/services/${relatedSlug}/`,
            title: relatedService.name,
            kicker: "Related service",
            text: relatedService.summary,
            image: relatedService.image,
            alt: relatedService.name,
            cta: "Learn More"
          };
        }),
        currentUrl,
        true
      )}
    </section>

    <section class="section">
      <div class="section-heading reveal">
        <p class="eyebrow">FAQ</p>
        <h2>Questions about ${escapeHtml(service.name.toLowerCase())}.</h2>
      </div>
      ${renderFaq(service.faq)}
    </section>

    ${renderCtaStrip(
      currentUrl,
      `Need help with ${service.name.toLowerCase()}?`,
      "Send the attic details directly and Good Attic will help route the project into the right service and market path.",
      { label: "Book an Attic Inspection", url: "/contact/", kicker: "Conversion" }
    )}
  `;

  return page;
}

function buildMarketPage(market) {
  const marketPhone = marketPhones[market.slug] || phoneForPage(null);
  const evidenceGallery = buildMarketEvidenceGallery(market);
  const outcomePanels = buildMarketOutcomePanels(market);
  const page = {
    slug: market.slug,
    url: `/${market.slug}/`,
    page_type: "market",
    market: market.slug,
    city: null,
    primary_keyword: market.primaryKeyword,
    secondary_keywords: market.secondaryKeywords,
    seo_title: market.seoTitle,
    meta_description: market.metaDescription,
    h1: market.h1,
    intro: market.intro,
    page_purpose: "Local authority page for that market",
    cta_primary: "Schedule attic estimate",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Locations", url: "/locations/" },
      { label: market.name, url: `/${market.slug}/` }
    ],
    canonical_url: `${site.baseUrl}/${market.slug}/`,
    related_links: [
      ...serviceCatalog.map((service) => ({ label: service.name, url: `/${market.slug}/${service.slug}/` })),
      ...market.supportCities.map((city) => ({ label: city.name, url: `/${market.slug}/service-areas/${city.slug}/` }))
    ],
    faq_items: market.faq,
    trust_elements: market.trustElements
  };

  page.render = (currentUrl) => `
    ${renderHiddenBreadcrumbs(page, currentUrl)}
    <section class="hero section-pin hero--market">
      <div class="hero-copy reveal">
        ${renderHeroReviewBanner(true)}
        <p class="eyebrow">Premium Attic Services in ${escapeHtml(market.shortName)}</p>
        <h1 class="hero-display">${escapeHtml(page.h1)}</h1>
        <p class="hero-text">${escapeHtml(page.intro)}</p>
        <div class="hero-actions">
          <button class="button primary" type="button" data-open-modal>Get A Free Attic Assessment</button>
          <div class="hero-actions__secondary">
            <a class="button secondary" href="${marketPhone.phoneHref}">Call Us</a>
            <a class="button secondary" href="${marketPhone.smsHref}">Text Us</a>
          </div>
        </div>
        <div class="hero-service-carousel" aria-label="Good Attic services in ${escapeHtml(market.shortName)}">
          <button class="hero-service-arrow hero-service-arrow--prev" type="button" aria-label="Scroll services left">&larr;</button>
          <div class="hero-service-window">
            <div class="hero-service-track">
              ${serviceCatalog
                .map(
                  (service) => `
                    <a class="hero-service-card" href="${hrefFrom(currentUrl, `/${market.slug}/${service.slug}/`)}">
                      <img src="${escapeHtml(assetHref(currentUrl, service.image))}" alt="">
                      <span>${escapeHtml(serviceUiName(service))}</span>
                    </a>
                  `
                )
                .join("")}
            </div>
          </div>
          <button class="hero-service-arrow hero-service-arrow--next" type="button" aria-label="Scroll services right">&rarr;</button>
        </div>
      </div>
      ${renderSharedAtticHealthCard(`${market.shortName} attic inspection summary`, `${market.shortName} Attic Health Score`)}
    </section>

    ${renderSharedReviewBand(renderMarketReviewWidget(currentUrl, market))}

    <section id="services" class="service-showcase section reveal" data-service-carousel>
      <p class="eyebrow service-showcase__label">Our Services</p>
      <div class="service-showcase__stage">
        ${serviceCatalog
          .map(
            (service, index) => `
              <article class="service-showcase__slide${index === 0 ? " is-active" : ""}" data-service-slide>
                <img src="${escapeHtml(assetHref(currentUrl, service.image))}" alt="${escapeHtml(serviceUiName(service))} service in ${escapeHtml(market.name)}">
                <div class="service-showcase__overlay">
                  <p class="panel-kicker">${escapeHtml(serviceUiName(service))}</p>
                  <h3>${escapeHtml(service.heroHeading)}</h3>
                  <p>${escapeHtml(service.marketIntro[market.slug])}</p>
                </div>
              </article>
            `
          )
          .join("")}

        <button class="service-showcase__control service-showcase__control--prev" type="button" aria-label="Previous service" data-service-prev>&larr;</button>
        <button class="service-showcase__control service-showcase__control--next" type="button" aria-label="Next service" data-service-next>&rarr;</button>
        <button class="button primary service-showcase__cta" type="button" data-open-modal>Get Started</button>

        <div class="service-showcase__rail" aria-label="Service carousel thumbnails">
          ${serviceCatalog
            .map(
              (service, index) => `
                <button class="service-thumb${index === 0 ? " is-active" : ""}" type="button" data-service-thumb aria-label="Show ${escapeHtml(serviceUiName(service))} slide">
                  <img src="${escapeHtml(assetHref(currentUrl, service.image))}" alt="">
                  <span>${escapeHtml(serviceUiName(service))}</span>
                </button>
              `
            )
            .join("")}
        </div>
      </div>
      <button class="button primary service-showcase__mobile-cta" type="button" data-open-modal>Get Started</button>
    </section>

    <section class="section">
      <div class="section-heading reveal">
        <p class="eyebrow">Service Areas</p>
        <h2>Explore the cities connected to the ${escapeHtml(market.shortName)} market.</h2>
        <p class="section-subcopy">Use these city pages to confirm coverage and move into the localized Good Attic path for the home.</p>
      </div>
      <div class="home-hub-links reveal">
        ${market.supportCities
          .map(
            (city) => `
              <a class="home-hub-chip" href="${hrefFrom(currentUrl, `/${market.slug}/service-areas/${city.slug}/`)}">${escapeHtml(city.name)}</a>
            `
          )
          .join("")}
      </div>
    </section>

    <section class="attic-map section reveal" aria-labelledby="attic-map-title">
      <div class="attic-map__copy">
        <p class="eyebrow">Explore the attic system</p>
        <h2 id="attic-map-title">Every attic in ${escapeHtml(market.shortName)} has a few spots where issues arise.</h2>
        <p>Hover over the dots to see how Good Attic turns common problem areas into a cleaner, healthier, more efficient space.</p>
        <button class="button primary attic-map__cta" type="button" data-open-modal>Book an Attic Inspection</button>
      </div>

      <div class="house-3d" aria-label="Interactive attic service diagram">
        <img class="house-illustration" src="${escapeHtml(assetHref(currentUrl, "assets/good-attic-house-cutaway.svg"))}" alt="">
        <span class="house-logo-roof" aria-hidden="true"></span>

        <button class="hotspot hotspot--insulation" type="button" aria-label="Insulation upgrades" data-hotspot>
          <span></span>
          <span class="hotspot-card">
            <strong>Attic Sanitation</strong>
            <small>Attic spaces can be the perfect place to harbor mold, mildew, dust, as well as pest feces, urine, and remains (yuck).<br><br>Getting this stuff removed is only part 1. Good Attic ensures proper, full sanitation of the entire space to fully eliminate contaminants.</small>
          </span>
        </button>

        <button class="hotspot hotspot--insulation-depth" type="button" aria-label="Insulation depth" data-hotspot>
          <span></span>
          <span class="hotspot-card">
            <strong>Insulation Depth</strong>
            <small>Most homes have old, broken down, and/or low insulation. This leads to discomfort in the home and hundreds of wasted dollars on utility bills, as well as over-worked HVAC equipment.<br><br>Good Attic uses only the best insulation materials that don't settle, installed to modern ENERGY STAR recommended levels.</small>
          </span>
        </button>

        <button class="hotspot hotspot--insulation-edge" type="button" aria-label="Insulation edge coverage" data-hotspot>
          <span></span>
          <span class="hotspot-card">
            <strong>Soffit Ventilation</strong>
            <small>Old insulation often plugs up vital soffit airflow, leading to extreme attic temps, ice damming, and moisture issues.<br><br>Good Attic installs baffles to protect soffit airflow from present &amp; future blockage.</small>
          </span>
        </button>

        <button class="hotspot hotspot--air" type="button" aria-label="Air sealing" data-hotspot>
          <span></span>
          <span class="hotspot-card">
            <strong>Air Sealing</strong>
            <small>The attic floor has gaps where pipes, wires, light fixtures, and other openings can add up to a gaping hole, exchanging conditioned air with dust/contaminants from the attic space.<br><br>Good Attic air seals these gaps with foam to create a singular barrier between the living space and attic.</small>
          </span>
        </button>

        <button class="hotspot hotspot--sanitize" type="button" aria-label="Sanitizing and cleanup" data-hotspot>
          <span></span>
          <span class="hotspot-card">
            <strong>Insulation Removal</strong>
            <small>Between deteriorating insulation, moisture issues, and pests making themselves at home, attics get pretty dusty and gross.<br><br>Good Attic specializes in professional, safe attic insulation removal &amp; disposal techniques using a HEPA vacuum setup, ensuring attic contaminants do not enter your living space.</small>
          </span>
        </button>

        <button class="hotspot hotspot--ventilation" type="button" aria-label="Ventilation optimization" data-hotspot>
          <span></span>
          <span class="hotspot-card">
            <strong>Attic Ventilation</strong>
            <small>Under-ventilated attics can easily reach 160+ degrees. That reduces insulation effectiveness, roof life, and invites mold, as well as over-working your A/C unit to keep your top floor cool.<br><br>Good Attic's attic fan solutions address this issue directly, keeping air moving through the attic on autopilot.</small>
          </span>
        </button>
      </div>
      <p class="hotspot-exit-hint" aria-hidden="true">tap to exit</p>
      <button class="button primary attic-map__cta attic-map__cta--mobile" type="button" data-open-modal>Book an Attic Inspection</button>
    </section>

    <section class="section feature-section">
      <div class="section-heading reveal">
        <p class="eyebrow">Our Process</p>
        <h2>Everything your attic in ${escapeHtml(market.shortName)} needs, handled with one coordinated plan.</h2>
      </div>

      <div class="process-carousel-shell" data-process-carousel>
        <button class="carousel-control carousel-control--prev" type="button" data-carousel-prev aria-label="Previous process step">&larr;</button>
        <div class="process-carousel-window">
          <div class="feature-grid process-carousel" aria-label="Good Attic process steps" data-carousel-track>
            <article class="feature-card reveal">
              <span class="card-icon">Step 1</span>
              <h3>Submit a Request</h3>
              <p>To get started, you'll want to submit your info here online, or you can give us a call or text.</p>
              <button class="button primary process-card-button" type="button" data-open-modal>Get Started</button>
            </article>
            <article class="feature-card reveal">
              <span class="card-icon">Step 2</span>
              <h3>Project Assessed</h3>
              <p>Once you get in touch with us, we will collect a full scope understanding of your project, either in-person, or virtually if you'd like. We will then create a tailored quote to meet your needs.</p>
            </article>
            <article class="feature-card reveal">
              <span class="card-icon">Step 3</span>
              <h3>Project Scheduled</h3>
              <p>After your quote is accepted, our friendly Project Manager will reach out and ensure the project is scheduled to fit your needs.</p>
            </article>
            <article class="feature-card reveal">
              <span class="card-icon">Step 4</span>
              <h3>Insulation Removal</h3>
              <p>Removal of compromised materials and debris, performed safely and effectively.</p>
            </article>
            <article class="feature-card reveal">
              <span class="card-icon">Step 5</span>
              <h3>Sanitation &amp; Air Sealing</h3>
              <p>Targeted sealing around penetrations, gaps, and bypasses that let conditioned air escape into the attic.</p>
              <p>This is followed by a complete attic sanitation.</p>
            </article>
            <article class="feature-card reveal">
              <span class="card-icon">Step 6</span>
              <h3>Attic Upgrades</h3>
              <p>Pest access points eliminated, premium insulation installed to modern energy standards, and ventilation improvements addressed.</p>
            </article>
            <article class="feature-card reveal">
              <span class="card-icon">Step 7</span>
              <h3>Done Right Guarantee</h3>
              <p>Project completed, work guaranteed, homeowner satisfied, and attic restored.</p>
            </article>
          </div>
        </div>
        <button class="carousel-control carousel-control--next" type="button" data-carousel-next aria-label="Next process step">&rarr;</button>
      </div>
    </section>

    <section class="quote-section reveal">
      <blockquote>
        Good Attic backs every project with our Done Right Guarantee.
      </blockquote>
      <p>As a family-owned company, integrity comes first. We warranty all our work, and refuse to leave any customer unsatisfied.</p>
    </section>

    <section id="problems" class="story-blocks">
      <article class="story reveal">
        <div>
          <p class="eyebrow">01 / Air Quality</p>
          <h2>Dust, odors, and old insulation should not be part of daily life in ${escapeHtml(market.shortName)}.</h2>
          <p>In ${escapeHtml(market.shortName)}, homeowners often start here when dirty insulation, attic dust, or contamination begin affecting how the house feels. Good Attic looks at cleanup, sanitation, sealing, and insulation as one connected attic path.</p>
        </div>
        <img class="image-transparent" src="${escapeHtml(assetHref(currentUrl, "assets/gross-attic.png"))}" alt="Gross attic with old dirty insulation">
      </article>

      <article class="story reverse reveal">
        <div>
          <p class="eyebrow">02 / Comfort</p>
          <h2>Rooms that never feel right in ${escapeHtml(market.shortName)} often start above the ceiling.</h2>
          <p>${escapeHtml(market.whyText)}</p>
        </div>
        <img class="image-transparent" src="${escapeHtml(assetHref(currentUrl, "assets/hot-cold-uneven-temperatures-attic.png"))}" alt="House cutaway showing uneven hot and cold attic temperature issues">
      </article>

      <article class="story reveal">
        <div>
          <p class="eyebrow">03 / Pest Damage</p>
          <h2>After pests make the attic their home, the attic needs a full restoration.</h2>
          <p>Pest-damaged insulation, droppings, odors, and contamination can all linger in ${escapeHtml(market.shortName)} homes long after the animals are gone. Good Attic focuses on the cleanup, sanitation, and restoration that makes the space better than before.</p>
        </div>
        <img class="image-transparent image-pest-damage" src="${escapeHtml(assetHref(currentUrl, "assets/pest-issues-in-attic-transparent-v2.png"))}" alt="Pest activity and contamination inside a damaged attic">
      </article>
    </section>

    <section class="section split-section">
      <div class="section-heading reveal">
        <p class="eyebrow">Warning Signs</p>
        <h2>Homeowners in ${escapeHtml(market.shortName)} call us when the attic starts affecting everyday life.</h2>
      </div>
      ${renderTileGrid(market.commonProblems)}
    </section>

    <section class="section">
      <div class="section-heading reveal">
        <p class="eyebrow">Inspection findings</p>
        <h2>What Good Attic documents before recommending work in ${escapeHtml(market.shortName)}.</h2>
        <p class="section-subcopy">${escapeHtml(
          "The assessment should make the attic visible enough that the scope can be explained clearly, photographed honestly, and sequenced into the right next step."
        )}</p>
      </div>
      ${renderEvidenceGrid(evidenceGallery, currentUrl)}
    </section>

    <section class="section">
      <div class="section-heading reveal">
        <p class="eyebrow">Proof ready for this market</p>
        <h2>The evidence and review inputs that should strengthen ${escapeHtml(market.shortName)} first.</h2>
        <p class="section-subcopy">${escapeHtml(
          "This section is designed to accept real approved review excerpts and project evidence later without changing the page structure again."
        )}</p>
      </div>
      ${renderProofQueueGrid(buildDocumentedProofCards({ marketSlug: market.slug }), currentUrl)}
    </section>

    <section class="section">
      <div class="section-heading reveal">
        <p class="eyebrow">What changes after the work</p>
        <h2>The attic should look and feel more resolved when the right scope is finished.</h2>
      </div>
      ${renderAudiencePanels(outcomePanels)}
    </section>

    <section class="cta-strip reveal">
      <div>
        <p class="eyebrow">Start with clarity</p>
        <h2>Get a documented attic assessment in ${escapeHtml(market.shortName)} before deciding what to do next.</h2>
      </div>
      <button class="button primary" type="button" data-open-modal>Request Inspection</button>
    </section>

    <section id="process" class="section creators">
      <div class="creator-sticky reveal">
        <p class="eyebrow">Process</p>
        <h2>A calm, transparent experience for ${escapeHtml(market.shortName)} homeowners with a space most people never see.</h2>
        <img src="${escapeHtml(assetHref(currentUrl, "assets/good-attic-insulation-sales-appointment.png"))}" alt="Good Attic project manager reviewing an attic insulation quote with a homeowner">
      </div>

      <div class="creator-list">
        <article class="feature-card reveal"><h3>1. Inspect</h3><p>We review insulation levels, contamination, ventilation clues, air leaks, access, and visible attic conditions.</p></article>
        <article class="feature-card reveal"><h3>2. Document</h3><p>You receive plain-language findings with photos, priorities, and clear scope options.</p></article>
        <article class="feature-card reveal"><h3>3. Perform</h3><p>Our team protects the home, removes compromised material, cleans the space, and installs the right solution.</p></article>
        <article class="feature-card reveal"><h3>4. Verify</h3><p>Final walkthroughs and photos show what changed, what was installed, and how the attic was left.</p></article>
      </div>
    </section>

    <section id="trust" class="section venture-section">
      <div class="section-heading reveal">
        <p class="eyebrow">Why homeowners trust Good Attic</p>
        <h2>Premium service in ${escapeHtml(market.shortName)} means more than better materials.</h2>
        <p>${escapeHtml(market.trustElements.join(". "))}.</p>
      </div>
      <div class="audience-panels">
        <article class="audience-panel reveal">
          <h3>High-trust experience</h3>
          <p>No scare tactics. No vague quotes. Just a clear assessment, a clean scope, and a project plan you can understand.</p>
          <div class="trust-button-row">
            <a class="button primary" href="${marketPhone.phoneHref}">Call Us</a>
            <a class="button primary" href="${marketPhone.smsHref}">Text Us</a>
          </div>
        </article>
        <article class="audience-panel reveal">
          <h3>Day 1 accuracy</h3>
          <p>The form below helps homeowners in ${escapeHtml(market.shortName)} share the right details, so Good Attic can respond with useful next steps.</p>
          <a class="button primary trust-form-button" href="#contact">Start the Form</a>
        </article>
      </div>
    </section>

    <section id="about" class="section about">
      <div class="section-heading reveal">
        <p class="eyebrow">About</p>
        <h2>Built for homeowners in ${escapeHtml(market.shortName)} who want the attic handled correctly.</h2>
        <p>${escapeHtml(market.whyText)}</p>
      </div>
      <div class="people-grid proof-grid">
        <article class="person-card reveal">
          <div class="proof-number">&lt;5min</div>
          <div>
            <h3>Fast follow-up</h3>
            <p>Designed for quick lead review and next-step scheduling.</p>
          </div>
        </article>
        <article class="person-card reveal">
          <div class="proof-number">100%</div>
          <div>
            <h3>Photo-forward scopes</h3>
            <p>Homeowners should see the problem before approving the fix.</p>
          </div>
        </article>
      </div>
    </section>

    <section id="contact" class="section contact">
      <div class="contact-info reveal">
        <p class="eyebrow">Get a quote</p>
        <h2>Tell us what is happening in your attic in ${escapeHtml(market.shortName)}.</h2>
        <p>Share the project type, contact details, preferred quote timing, and any helpful notes. Your request goes straight to the team so we can follow up with the right next step.</p>
        <p class="contact-note">Lead source, page URL, and project type are captured so every request can route into the right local follow-up path.</p>
      </div>

      ${renderHomepageLeadForm(currentUrl, `${market.shortName} market contact form`)}
    </section>
  `;

  return page;
}

function buildServicePage(market, service) {
  const marketShort = market.shortName.toLowerCase();
  const insights = buildMarketServiceInsights(market, service);
  const evidenceGallery = buildServiceEvidenceGallery(market, service);
  const serviceReviewCount = approvedReviewEntries({ marketSlug: market.slug, serviceSlug: service.slug }).length;
  const faqItems = [...service.faq, ...insights.extraFaq];
  const secondaryKeywords = {
    "attic-insulation": [
      `blown-in attic insulation ${marketShort}`,
      `attic insulation contractor ${marketShort}`
    ],
    "insulation-removal": [`attic insulation removal ${marketShort}`, `remove old insulation ${marketShort}`],
    "attic-pest-remediation": [`rodent attic cleanup ${marketShort}`, `contaminated attic insulation ${marketShort}`],
    "attic-fans": [`solar attic fans ${marketShort}`, `attic fan installation ${marketShort}`],
    "attic-air-sealing": [`attic sealing ${marketShort}`, `air leak sealing attic ${marketShort}`]
  }[service.slug];

  const page = {
    slug: service.slug,
    url: `/${market.slug}/${service.slug}/`,
    page_type: "service",
    market: market.slug,
    city: null,
    primary_keyword: `${service.slug.replace(/-/g, " ")} ${market.shortName.toLowerCase()}`.replace(
      "attic pest remediation",
      "attic pest remediation"
    ),
    secondary_keywords: secondaryKeywords,
    seo_title: {
      "attic-insulation": `Attic Insulation in ${market.name} | Good Attic`,
      "insulation-removal": `Insulation Removal in ${market.name} | Good Attic`,
      "attic-pest-remediation": `Attic Pest Remediation in ${market.name} | Good Attic`,
      "attic-fans": `Attic Fans in ${market.name} | Good Attic`,
      "attic-air-sealing": `Attic Air Sealing in ${market.name} | Good Attic`
    }[service.slug],
    meta_description: {
      "salt-lake-city-ut": {
        "attic-insulation":
          "Need attic insulation in Salt Lake City? Good Attic helps solve hot and cold rooms, energy waste, and underperforming attic insulation.",
        "insulation-removal":
          "Good Attic removes old, dirty, damaged, or contaminated attic insulation in Salt Lake City and helps homeowners start fresh.",
        "attic-pest-remediation":
          "Get help with rodent-contaminated insulation, nesting debris, attic odors, and attic pest cleanup in Salt Lake City.",
        "attic-fans":
          "Good Attic installs attic fan solutions in Salt Lake City to help reduce attic heat buildup and support better attic performance.",
        "attic-air-sealing":
          "Stop attic air leaks in Salt Lake City with attic air sealing designed to improve comfort, efficiency, and year-round performance."
      },
      "st-louis-mo": {
        "attic-insulation":
          "Need attic insulation in St. Louis? Good Attic helps solve hot upstairs rooms, winter heat loss, and energy waste.",
        "insulation-removal":
          "Good Attic removes old, dirty, damaged, or contaminated attic insulation in St. Louis and prepares attics for the right next step.",
        "attic-pest-remediation":
          "Get help with attic pest contamination, nesting debris, rodent damage, and attic cleanup in St. Louis.",
        "attic-fans":
          "Good Attic provides attic fan solutions in St. Louis to help manage attic heat buildup and improve attic ventilation support.",
        "attic-air-sealing":
          "Good Attic helps St. Louis homeowners reduce attic air leaks that contribute to comfort problems and energy loss."
      },
      "kansas-city-mo": {
        "attic-insulation":
          "Need attic insulation in Kansas City? Good Attic helps reduce attic heat gain, winter heat loss, and underperforming insulation problems.",
        "insulation-removal":
          "Good Attic removes old, dirty, damaged, or contaminated attic insulation in Kansas City and helps homeowners reset the attic the right way.",
        "attic-pest-remediation":
          "Get help with attic pest cleanup, rodent-damaged insulation, nesting debris, and attic contamination in Kansas City.",
        "attic-fans":
          "Good Attic installs attic fan solutions in Kansas City to help reduce attic heat buildup and support better attic airflow.",
        "attic-air-sealing":
          "Good Attic helps Kansas City homeowners stop attic air leaks that contribute to comfort issues and energy waste."
      }
    }[market.slug][service.slug],
    h1: {
      "attic-insulation": `Attic Insulation in ${market.name}`,
      "insulation-removal": `Insulation Removal in ${market.name}`,
      "attic-pest-remediation": `Attic Pest Remediation in ${market.name}`,
      "attic-fans": `Attic Fans in ${market.name}`,
      "attic-air-sealing": `Attic Air Sealing in ${market.name}`
    }[service.slug],
    intro: service.marketIntro[market.slug],
    page_purpose: "Money page for service + market intent",
    cta_primary: `Get ${service.name.toLowerCase()} help`,
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Locations", url: "/locations/" },
      { label: market.name, url: `/${market.slug}/` },
      { label: service.name, url: `/${market.slug}/${service.slug}/` }
    ],
    canonical_url: `${site.baseUrl}/${market.slug}/${service.slug}/`,
    related_links: [
      { label: market.name, url: `/${market.slug}/` },
      ...market.supportCities.map((city) => ({
        label: city.name,
        url: `/${market.slug}/service-areas/${city.slug}/`
      })),
      ...service.related.map((relatedSlug) => {
        const relatedService = serviceCatalog.find((item) => item.slug === relatedSlug);
        return { label: relatedService.name, url: `/${market.slug}/${relatedSlug}/` };
      }),
      { label: "Contact Good Attic", url: "/contact/" },
      { label: "Financing Options", url: "/financing/" }
    ],
    faq_items: faqItems,
    trust_elements: [
      `Focused ${service.name.toLowerCase()} scope`,
      `Connected back to the ${market.shortName} hub`,
      "Built to work with the rest of the attic system"
    ],
    render: (currentUrl) => `
      ${renderHero(currentUrl, page, {
        eyebrow: `${market.shortName} • ${service.name}`,
        cardKicker: "Why homeowners call",
        cardTitle: service.heroHeading,
        cardText: service.marketReason[market.slug],
        cardPoints: service.process
      })}

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">What this service solves</p>
          <h2>${escapeHtml(service.name)} helps when the attic is causing these kinds of problems.</h2>
        </div>
        ${renderTileGrid(service.symptoms)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Local attic patterns</p>
          <h2>Why ${escapeHtml(service.name.toLowerCase())} issues show up this way in ${escapeHtml(market.shortName)}.</h2>
          <p class="section-subcopy">${escapeHtml(
            `The goal is to explain what is actually happening in attics across ${market.shortName}, not just repeat a generic service description.`
          )}</p>
        </div>
        ${renderTileGrid(insights.localDrivers)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Inspection checkpoints</p>
          <h2>What Good Attic checks before recommending ${escapeHtml(service.name.toLowerCase())} in ${escapeHtml(market.shortName)}.</h2>
          <p class="section-subcopy">${escapeHtml(
            `A stronger recommendation comes from reading the attic correctly first, especially when comfort, contamination, and energy loss are overlapping.`
          )}</p>
        </div>
        ${renderTileGrid(insights.inspectionPoints)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Inspection proof</p>
          <h2>What Good Attic documents during a real ${escapeHtml(service.name.toLowerCase())} assessment in ${escapeHtml(market.shortName)}.</h2>
          <p class="section-subcopy">${escapeHtml(
            "These are the kinds of attic conditions and finish-quality checkpoints the team documents so the recommendation is tied to visible findings instead of generic assumptions."
          )}</p>
        </div>
        ${renderEvidenceGrid(evidenceGallery, currentUrl)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Proof path for this service</p>
          <h2>The real project evidence that should eventually support ${escapeHtml(service.name.toLowerCase())} in ${escapeHtml(market.shortName)}.</h2>
          <p class="section-subcopy">${escapeHtml(
            "These proof slots are set up so approved project photos and documented findings can drop into the right page later without redesigning the service architecture."
          )}</p>
        </div>
        ${renderProofQueueGrid(buildDocumentedProofCards({ marketSlug: market.slug, serviceSlug: service.slug }), currentUrl)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">When it fits</p>
          <h2>When ${escapeHtml(service.name.toLowerCase())} is the right next step in ${escapeHtml(market.shortName)}.</h2>
        </div>
        ${renderAudiencePanels(service.rightFit)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Scope decisions</p>
          <h2>When the honest answer in ${escapeHtml(market.shortName)} is more than a simple one-line fix.</h2>
          <p class="section-subcopy">${escapeHtml(
            `These are the moments where the attic usually needs a broader plan so the homeowner gets a cleaner, more durable result.`
          )}</p>
        </div>
        ${renderAudiencePanels(insights.escalationPoints)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">What the scope can include</p>
          <h2>How ${escapeHtml(service.name.toLowerCase())} usually gets built into a better attic plan.</h2>
          <p class="section-subcopy">${escapeHtml(
            `Good Attic is not trying to oversell the project. The point is to sequence the right work so the attic finishes cleaner and performs better.`
          )}</p>
        </div>
        ${renderTileGrid(insights.scopeIncludes)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Nearby cities</p>
          <h2>Nearby cities connected to this ${escapeHtml(market.shortName)} service.</h2>
          <p class="section-subcopy">${escapeHtml(
            "These city pages confirm nearby service coverage while keeping the project connected to the right metro team."
          )}</p>
        </div>
        ${renderFeatureGrid(
          market.supportCities.slice(0, 4).map((city) => ({
            url: `/${market.slug}/service-areas/${city.slug}/`,
            title: city.name,
            kicker: "Service area",
            text: city.intro,
            image: service.image,
            alt: `${service.name} in ${city.name}`,
            cta: "View city page"
          })),
          currentUrl,
          false
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Related services</p>
          <h2>${escapeHtml(service.name)} usually works best as part of a broader attic plan.</h2>
          <p class="section-subcopy">${escapeHtml(
            "These related services often come up in the same attic assessment because comfort, cleanup, airflow, and insulation usually overlap."
          )}</p>
        </div>
        ${renderFeatureGrid(
          service.related.map((relatedSlug) => {
            const relatedService = serviceCatalog.find((item) => item.slug === relatedSlug);
            return {
              url: `/${market.slug}/${relatedSlug}/`,
              title: relatedService.name,
              kicker: market.shortName,
              text: relatedService.summary,
              image: relatedService.image,
              alt: `${relatedService.name} in ${market.name}`,
              cta: "View related service"
            };
          }),
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Approved review excerpts</p>
          <h2>${escapeHtml(
            serviceReviewCount
              ? `Homeowner feedback already reinforcing ${service.name.toLowerCase()} in ${market.shortName}.`
              : `The homeowner feedback themes that should reinforce ${service.name.toLowerCase()} in ${market.shortName}.`
          )}</h2>
        </div>
        ${renderProofQueueGrid(buildReviewExcerptCards({ marketSlug: market.slug, serviceSlug: service.slug, limit: 3 }), currentUrl)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">FAQ</p>
          <h2>Questions about ${escapeHtml(service.name.toLowerCase())} in ${escapeHtml(market.shortName)}.</h2>
        </div>
        ${renderFaq(faqItems)}
      </section>

      ${renderCtaStrip(
        currentUrl,
        `Need ${service.name.toLowerCase()} in ${market.shortName}?`,
        "Use the contact page for a full request or open the quote modal for a quick start. Financing stays linked here because larger attic scopes often need it.",
        { label: "Request an Attic Estimate", url: "/contact/", kicker: "Conversion" }
      )}
    `
  };

  return page;
}

function buildCityPage(market, city) {
  const evidenceGallery = buildCityEvidenceGallery(market, city);
  const inspectionChecklist = buildCityInspectionChecklist(market, city);
  const escalationPanels = buildCityEscalationPanels(market, city);
  const cityResourceCards = buildCityResourceCards(market, city);
  const marketPhone = marketPhones[market.slug] || phoneForPage(null);
  const page = {
    slug: city.slug,
    url: `/${market.slug}/service-areas/${city.slug}/`,
    page_type: "support",
    market: market.slug,
    city: city.slug,
    primary_keyword: `attic services ${city.shortName.toLowerCase()} ${cityState(city).toLowerCase()}`.replace("'s", "'s"),
    secondary_keywords: [
      `attic insulation ${city.shortName.toLowerCase()}`,
      `insulation removal ${city.shortName.toLowerCase()}`,
      `attic company ${city.shortName.toLowerCase()}`
    ],
    seo_title: `Attic Services in ${city.name} | Good Attic`,
    meta_description:
      {
        "salt-lake-city-ut": {
          "west-jordan-ut":
            "Good Attic serves West Jordan homeowners with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
          "sandy-ut":
            "Good Attic helps Sandy homeowners solve attic comfort, insulation, and attic cleanup issues with premium attic services.",
          "draper-ut":
            "Good Attic provides attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing in Draper.",
          "american-fork-ut":
            "Good Attic serves American Fork homeowners with attic insulation, attic cleanup, attic fans, and attic air sealing."
        },
        "st-louis-mo": {
          "chesterfield-mo":
            "Good Attic serves Chesterfield homeowners with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
          "st-charles-mo":
            "Good Attic helps St. Charles homeowners with premium attic services built around comfort, cleanup, and energy performance.",
          "ballwin-mo":
            "Good Attic provides attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing in Ballwin.",
          "o-fallon-mo":
            "Good Attic serves O'Fallon homeowners with attic services designed to improve comfort, reduce waste, and clean up damaged insulation."
        },
        "kansas-city-mo": {
          "overland-park-ks":
            "Good Attic serves Overland Park homeowners with attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing.",
          "olathe-ks":
            "Good Attic helps Olathe homeowners solve attic comfort, cleanup, and energy-loss issues with premium attic services.",
          "lee-s-summit-mo":
            "Good Attic provides attic insulation, insulation removal, attic pest remediation, attic fans, and attic air sealing in Lee's Summit.",
          "lenexa-ks":
            "Good Attic serves Lenexa homeowners with premium attic services designed to improve comfort and clean up attic problems."
        }
      }[market.slug][city.slug],
    h1: `Attic Services in ${city.name}`,
    intro: city.intro,
    page_purpose: "City support page for suburb/city search demand",
    cta_primary: "Tell us what your attic is doing",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Locations", url: "/locations/" },
      { label: market.name, url: `/${market.slug}/` },
      { label: city.name, url: `/${market.slug}/service-areas/${city.slug}/` }
    ],
    canonical_url: `${site.baseUrl}/${market.slug}/service-areas/${city.slug}/`,
    related_links: [
      { label: market.name, url: `/${market.slug}/` },
      ...serviceCatalog.map((service) => ({ label: service.name, url: `/${market.slug}/${service.slug}/` })),
      { label: "Contact Good Attic", url: "/contact/" }
    ],
    faq_items: city.faq,
    trust_elements: [
      `Supported through the ${market.shortName} market`,
      "Real service coverage reassurance",
      "Clear local guidance without unsupported office claims"
    ],
    render: (currentUrl) => `
      ${renderHiddenBreadcrumbs(page, currentUrl)}
      <section class="hero section-pin hero--city">
        <div class="hero-copy reveal">
          ${renderHeroReviewBanner(true)}
          <p class="eyebrow">Service Area</p>
          <h1 class="hero-display">Attic Services in ${escapeHtml(city.shortName)}</h1>
          <p class="hero-text">${escapeHtml(page.intro)}</p>
          <div class="hero-actions">
            <button class="button primary" type="button" data-open-modal>Get A Free Attic Assessment</button>
            <div class="hero-actions__secondary">
              <a class="button secondary" href="${marketPhone.phoneHref}">Call Us</a>
              <a class="button secondary" href="${marketPhone.smsHref}">Text Us</a>
            </div>
          </div>
          <div class="hero-service-carousel" aria-label="Good Attic services near ${escapeHtml(city.shortName)}">
            <button class="hero-service-arrow hero-service-arrow--prev" type="button" aria-label="Scroll services left">&larr;</button>
            <div class="hero-service-window">
              <div class="hero-service-track">
                ${serviceCatalog
                  .map(
                    (service) => `
                      <a class="hero-service-card" href="${hrefFrom(currentUrl, `/${market.slug}/${service.slug}/`)}">
                        <img src="${escapeHtml(assetHref(currentUrl, service.image))}" alt="">
                        <span>${escapeHtml(serviceUiName(service))}</span>
                      </a>
                    `
                  )
                  .join("")}
              </div>
            </div>
            <button class="hero-service-arrow hero-service-arrow--next" type="button" aria-label="Scroll services right">&rarr;</button>
          </div>
        </div>
        ${renderSharedAtticHealthCard(`${city.shortName} attic inspection summary`, `${city.shortName} Attic Health Score`)}
      </section>

      ${renderSharedReviewBand(renderCityReviewWidget(currentUrl, market, city))}

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Common local issues</p>
          <h2>What homeowners in ${escapeHtml(city.shortName)} usually notice first.</h2>
        </div>
        ${renderTileGrid(city.commonProblems)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Inspection checkpoints nearby</p>
          <h2>What Good Attic checks before routing a ${escapeHtml(city.shortName)} attic into the right local scope.</h2>
          <p class="section-subcopy">${escapeHtml(
            `The goal is to document what the attic is actually doing near ${city.shortName} before the project gets reduced to the first service label that sounds plausible.`
          )}</p>
        </div>
        ${renderTileGrid(inspectionChecklist)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">What gets documented</p>
          <h2>How Good Attic turns a ${escapeHtml(city.shortName)} attic problem into a clearer local service path.</h2>
          <p class="section-subcopy">${escapeHtml(
            "The goal of this local page is not to fake a branch office. It is to show how the attic gets documented and routed into the right market team and scope."
          )}</p>
        </div>
        ${renderEvidenceGrid(evidenceGallery, currentUrl)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">When the scope gets bigger</p>
          <h2>What usually turns a ${escapeHtml(city.shortName)} attic project into a broader correction.</h2>
          <p class="section-subcopy">${escapeHtml(
            "These are the moments where the attic usually needs a more complete plan so the homeowner gets a cleaner result and a more trustworthy finish line."
          )}</p>
        </div>
        ${renderAudiencePanels(escalationPanels)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Available services</p>
          <h2>Five Good Attic service pages connected to ${escapeHtml(city.shortName)}.</h2>
          <p class="section-subcopy">${escapeHtml(
            "Use these service links to match the attic problem to the right solution in this market."
          )}</p>
        </div>
        ${renderFeatureGrid(
          serviceCatalog.map((service) => ({
            url: `/${market.slug}/${service.slug}/`,
            title: service.name,
            kicker: market.shortName,
            text: service.summary,
            image: service.image,
            alt: `${service.name} for ${city.name}`,
            cta: "View service"
          })),
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Best next guides</p>
          <h2>The resource pages that usually help ${escapeHtml(city.shortName)} homeowners make the next attic decision faster.</h2>
          <p class="section-subcopy">${escapeHtml(
            "These guides are chosen to support the exact kinds of attic questions homeowners near this city tend to have before they commit to a service path."
          )}</p>
        </div>
        ${renderFeatureGrid(cityResourceCards, currentUrl, true)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Why homeowners call</p>
          <h2>Why ${escapeHtml(city.shortName)} homeowners use the ${escapeHtml(market.shortName)} Good Attic hub.</h2>
        </div>
        ${renderAudiencePanels(
          city.whyCall.map((item, index) => ({
            title: ["Clear local fit", "Whole-attic route", "Premium homeowner experience"][index] || `Reason ${index + 1}`,
            text: item
          }))
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">How the local path works</p>
          <h2>How ${escapeHtml(city.shortName)} routes into the right Good Attic market and next step.</h2>
        </div>
        ${renderFeatureGrid(
          [
            {
              url: `/${market.slug}/`,
              title: `${market.name} market hub`,
              kicker: "Main local authority page",
              text: `Start with the ${market.shortName} hub when you want the full local attic story, city support pages, and the ${marketPhone.phoneDisplay} market contact path in one place.`,
              image: proofAssets.sales,
              alt: `${market.name} market hub`,
              cta: "Open market hub"
            },
            {
              url: "/contact/",
              title: "Contact Good Attic",
              kicker: "Direct request path",
              text: `Use the contact page when the attic symptoms are already clear enough to send the request straight into the ${market.shortName} team.`,
              image: proofAssets.insulation,
              alt: `Contact Good Attic from ${city.name}`,
              cta: "Start a request"
            },
            {
              url: "/resources/what-happens-during-an-attic-inspection/",
              title: "What Happens During an Attic Inspection",
              kicker: "Expectation-setting guide",
              text: "Use the inspection guide when the homeowner wants to understand how the attic findings turn into a smarter local recommendation.",
              image: proofAssets.grossAttic,
              alt: `Attic inspection expectations for ${city.name}`,
              cta: "Read guide"
            }
          ],
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">FAQ</p>
          <h2>Questions from homeowners in ${escapeHtml(city.shortName)}.</h2>
        </div>
        ${renderFaq(city.faq)}
      </section>

      ${renderCtaStrip(
        currentUrl,
        `Need attic help in ${city.shortName}?`,
        `Start with the ${market.shortName} market hub or send a request directly through contact so the right local service path can start.`,
        { label: "Tell Us About Your Attic", url: "/contact/", kicker: "Conversion" }
      )}
    `
  };

  return page;
}

function buildCostResourcePage(market) {
  const insulationService = serviceBySlug("attic-insulation");
  const removalService = serviceBySlug("insulation-removal");
  const sealingService = serviceBySlug("attic-air-sealing");

  const costDrivers = {
    "salt-lake-city-ut": [
      {
        title: "How much of the attic can actually be built on",
        text: "The quote changes when the attic is ready for added insulation versus when cleanup, removal, or sealing have to happen first."
      },
      {
        title: "Whether the attic is dusty, dirty, or pest-affected",
        text: "A cleaner attic can sometimes move straight into insulation, but contamination or rodent history often changes both labor and sequencing."
      },
      {
        title: "How much upper-floor comfort correction the home needs",
        text: "When bonus rooms, garage-adjacent rooms, or exposed upper spaces are suffering, the final scope often becomes more measured than a simple depth top-off."
      },
      {
        title: "Access, edges, and pathway prep",
        text: "The attic can need more setup when the goal is a cleaner, better-finished install rather than just blowing material into the open floor."
      }
    ],
    "st-louis-mo": [
      {
        title: "Older attic layouts can change labor fast",
        text: "1.5-story homes, kneewall-adjacent spaces, and mixed-age attics often need more assessment and prep than an open suburban attic."
      },
      {
        title: "Humidity history and musty material matter",
        text: "If the insulation is dirty, stale, or not worth building on, the price conversation shifts from adding insulation to resetting the attic correctly."
      },
      {
        title: "Air leakage can make a simple insulation quote incomplete",
        text: "Many St. Louis attics need the boundary tightened before added insulation can perform the way the homeowner expects."
      },
      {
        title: "The attic may be solving more than one complaint",
        text: "When the home has hot second floors, winter discomfort, and attic contamination at the same time, the quote usually reflects a fuller system fix."
      }
    ],
    "kansas-city-mo": [
      {
        title: "Square footage is only the starting point",
        text: "The attic price depends far more on what condition the insulation is in and what has to happen before fresh material becomes the finished layer."
      },
      {
        title: "Seasonal comfort complaints often point to combined work",
        text: "When the upstairs is hot in summer and drafty in winter, the attic may need more than just deeper insulation."
      },
      {
        title: "Pest history or dusty material changes the plan",
        text: "Aged or contaminated insulation can turn the conversation from cost-per-area thinking into a real restoration scope."
      },
      {
        title: "The cleaner the attic finish, the more deliberate the prep",
        text: "A premium attic outcome usually means tighter sequencing, better access planning, and a more complete rebuild of the attic floor."
      }
    ]
  }[market.slug];

  const scopeGrowth = {
    "salt-lake-city-ut": [
      {
        title: "The attic needs removal before new insulation",
        text: "Top-offs stop making sense when the attic floor is dusty, pest-affected, or built on material that is already underperforming."
      },
      {
        title: "Air sealing belongs in the same estimate",
        text: "A leaky attic floor can make new insulation work harder than it should, so the better estimate sometimes includes both steps together."
      },
      {
        title: "Heat-management details need attention too",
        text: "Baffles, intake pathways, and the overall attic layout can all affect whether the install stays clean and performs correctly."
      }
    ],
    "st-louis-mo": [
      {
        title: "Dirty or musty insulation is the real first problem",
        text: "In many St. Louis homes, the attic needs a cleaner reset before new material deserves to be the finish line."
      },
      {
        title: "Older homes often need a tighter boundary too",
        text: "When attic bypasses are obvious, the estimate may expand because insulation alone is not the full answer."
      },
      {
        title: "Pest aftermath can turn a comfort project into a restoration project",
        text: "Squirrels, mice, and rodent contamination change what has to be removed, cleaned, and rebuilt before the attic feels healthy again."
      }
    ],
    "kansas-city-mo": [
      {
        title: "The attic has enough old material to justify a reset",
        text: "If the base layer is dirty, damaged, or not performing well, the smarter price conversation is about restoration rather than just adding more."
      },
      {
        title: "Air sealing is needed before the final insulation layer",
        text: "The attic boundary often has to be tightened first so the new insulation has a better chance of supporting comfort all year."
      },
      {
        title: "The attic is solving a bigger comfort problem than expected",
        text: "When multiple upstairs complaints all point upward, the estimate can grow because the attic system needs a more complete correction."
      }
    ]
  }[market.slug];

  const quoteChecklist = [
    {
      title: "What the attic looks like today",
      text: "An honest estimate should explain whether the attic is clean enough to build on or whether removal, cleanup, or sanitation comes first."
    },
    {
      title: "Whether the recommendation is insulation-only or system-based",
      text: "Homeowners should know if the quote assumes air sealing, pathway prep, or other attic corrections to make the insulation recommendation stick."
    },
    {
      title: "What target the install is trying to reach",
      text: "The quote should make it clear what the attic is being improved toward rather than simply listing material without context."
    },
    {
      title: "Why one estimate is larger than another",
      text: "The right provider should be able to explain exactly which attic conditions are making the scope cleaner, bigger, or more complete."
    }
  ];

  const faqItems = [
    {
      question: `Can Good Attic give exact attic insulation pricing online for ${market.shortName}?`,
      answer: `Not responsibly without seeing the attic. Honest attic insulation cost in ${market.shortName} depends on the condition of the existing insulation, whether removal or sealing belongs in the job, and how complete the attic scope really needs to be.`
    },
    {
      question: `Why do attic insulation quotes in ${market.shortName} vary so much from house to house?`,
      answer: `Because the attic itself changes the project. Clean top-off situations, dirty reset situations, and combined insulation-plus-sealing projects are all very different scopes even when two homes look similar from outside.`
    },
    {
      question: `What usually makes attic insulation cost more in ${market.shortName}?`,
      answer: `Contaminated insulation, older attic layouts, air sealing needs, harder access, and a more complete restoration plan are some of the most common reasons the attic cost grows.`
    }
  ];

  return {
    slug: `attic-insulation-cost-${market.slug}`,
    url: `/resources/attic-insulation-cost-${market.slug}/`,
    page_type: "resource",
    market: market.slug,
    city: null,
    primary_keyword: `attic insulation cost ${market.shortName.toLowerCase()}`,
    secondary_keywords: [
      `blown in insulation cost ${market.shortName.toLowerCase()}`,
      `attic insulation estimate ${market.shortName.toLowerCase()}`,
      `insulation quote ${market.shortName.toLowerCase()}`
    ],
    seo_title: `Attic Insulation Cost in ${market.name} | What Changes the Price`,
    meta_description: `Learn what actually changes attic insulation cost in ${market.name}, including attic condition, removal needs, air sealing, and how a real estimate gets built.`,
    h1: `Attic Insulation Cost in ${market.name}`,
    intro: `If you are researching attic insulation cost in ${market.shortName}, the first thing to know is that honest pricing depends on attic condition more than headline square-footage math. Good Attic treats cost as a scope question: what has to happen in the attic before new insulation becomes a real solution?`,
    page_purpose: "Authority article for cost intent",
    cta_primary: "Request a local attic estimate",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Resources", url: "/resources/" },
      { label: `Attic Insulation Cost in ${market.name}`, url: `/resources/attic-insulation-cost-${market.slug}/` }
    ],
    canonical_url: `${site.baseUrl}/resources/attic-insulation-cost-${market.slug}/`,
    related_links: [
      { label: `Attic Insulation in ${market.name}`, url: `/${market.slug}/${insulationService.slug}/` },
      { label: removalService.name, url: `/${market.slug}/${removalService.slug}/` },
      { label: sealingService.name, url: `/${market.slug}/${sealingService.slug}/` },
      { label: market.name, url: `/${market.slug}/` },
      { label: "Financing Options", url: "/financing/" }
    ],
    faq_items: faqItems,
    trust_elements: [
      "No fake published price ranges",
      "Built around real attic cost drivers",
      "Routes into the correct local service and market pages"
    ],
    hero: {
      eyebrow: `Resources • ${market.shortName}`,
      cardKicker: "Why pricing changes",
      cardTitle: `The attic condition in ${market.shortName} is what usually shapes the cost most.`,
      cardText: `Square footage matters, but the bigger pricing question is whether the attic is ready for insulation or whether cleanup, sealing, or restoration have to happen first.`,
      cardPoints: [
        "Condition of current insulation",
        "Need for removal or cleanup",
        "Need for air sealing or prep",
        "How complete the attic fix needs to be"
      ]
    },
    sections: [
      {
        eyebrow: "What changes the price",
        heading: `The biggest attic insulation cost drivers in ${market.shortName}.`,
        subcopy:
          "This is where homeowners usually separate a simple top-off situation from an attic that needs a more complete plan.",
        layout: "tiles",
        items: costDrivers
      },
      {
        eyebrow: "When the scope grows",
        heading: `The attic conditions that usually make a quote in ${market.shortName} bigger than expected.`,
        subcopy:
          "A more expensive estimate is not automatically a bad one. Sometimes it is simply the more honest version of the attic problem.",
        layout: "panels",
        items: scopeGrowth
      },
      {
        eyebrow: "What a better estimate includes",
        heading: "What homeowners should expect an attic insulation estimate to explain clearly.",
        subcopy:
          "The estimate should teach the homeowner something useful about the attic, not just present a line item and a signature box.",
        layout: "tiles",
        items: quoteChecklist
      },
      {
        eyebrow: "Keep going",
        heading: `The next pages that help the cost conversation in ${market.shortName}.`,
        layout: "features",
        withImages: true,
        items: [
          {
            url: `/${market.slug}/${insulationService.slug}/`,
            title: `Attic Insulation in ${market.name}`,
            kicker: "Local service page",
            text: insulationService.marketIntro[market.slug],
            image: insulationService.image,
            alt: `Attic insulation in ${market.name}`,
            cta: "View local service"
          },
          {
            url: `/${market.slug}/${removalService.slug}/`,
            title: `${removalService.name} in ${market.name}`,
            kicker: "Scope decision",
            text: removalService.marketIntro[market.slug],
            image: removalService.image,
            alt: `${removalService.name} in ${market.name}`,
            cta: "Compare next step"
          },
          {
            url: `/${market.slug}/`,
            title: `${market.name} market hub`,
            kicker: "Market page",
            text: market.intro,
            image: "assets/good-attic-insulation-sales-appointment.png",
            alt: `${market.name} attic services`,
            cta: "Open market hub"
          }
        ]
      }
    ],
    cta: {
      title: `Need a real attic insulation estimate in ${market.shortName}?`,
      text: "The cleanest next step is still a documented attic assessment. That is how the cost conversation stays tied to the actual attic instead of guesswork.",
      primary: { label: "Request a Local Estimate", url: "/contact/", kicker: "Next step" }
    }
  };
}

function buildResourcePage(config) {
  return {
    ...config,
    page_type: "resource",
    city: null
  };
}

function buildLocalizedResourceCards(serviceSlug, kickerLabel, ctaLabel) {
  const service = serviceBySlug(serviceSlug);

  return marketCatalog.map((market) => ({
    url: `/${market.slug}/${serviceSlug}/`,
    title: `${service.name} in ${market.name}`,
    kicker: `${market.shortName} • ${kickerLabel}`,
    text: service.marketIntro[market.slug],
    image: service.image,
    alt: `${service.name} in ${market.name}`,
    cta: ctaLabel
  }));
}

function buildMarketRouteCards(kickerLabel, ctaLabel, textBuilder) {
  return marketCatalog.map((market) => ({
    url: `/${market.slug}/`,
    title: market.name,
    kicker: `${market.shortName} • ${kickerLabel}`,
    text:
      typeof textBuilder === "function"
        ? textBuilder(market)
        : `${market.intro} Use ${marketPhones[market.slug].phoneDisplay} when you want the local call or text path for ${market.shortName}.`,
    image: proofAssets.sales,
    alt: `${market.name} market routing`,
    cta: ctaLabel
  }));
}

function matchesProofScope(entry, scope = {}) {
  if (scope.marketSlug && entry.market && entry.market !== scope.marketSlug) return false;
  if (scope.serviceSlug && entry.serviceSlug && entry.serviceSlug !== scope.serviceSlug) return false;
  if (scope.citySlug && entry.city && entry.city !== scope.citySlug) return false;
  return true;
}

function approvedReviewEntries(scope = {}) {
  return approvedReviewExcerpts.filter((entry) => matchesProofScope(entry, scope));
}

function documentedProofEntries(scope = {}) {
  return documentedProjectProof.filter((entry) => matchesProofScope(entry, scope));
}

function buildReviewExcerptCards(scope = {}) {
  const market = scope.marketSlug ? marketBySlug(scope.marketSlug) : null;
  const service = scope.serviceSlug ? serviceBySlug(scope.serviceSlug) : null;
  let actualEntries = approvedReviewEntries(scope);

  if (scope.citySlug) {
    actualEntries = actualEntries.filter((entry) => entry.city === scope.citySlug);
  }

  if (scope.serviceSlug) {
    actualEntries = actualEntries.filter((entry) => entry.serviceSlug === scope.serviceSlug);
  }

  if (typeof scope.limit === "number") {
    actualEntries = actualEntries.slice(0, scope.limit);
  }

  if (actualEntries.length) {
    return actualEntries.map((entry) => ({
      kicker: entry.source || "Approved review excerpt",
      title: entry.title || entry.reviewerLabel || "Homeowner excerpt",
      text: entry.quote,
      stars: true,
      image: entry.image || proofAssets.sales,
      alt: entry.alt || entry.title || entry.reviewerLabel || "Approved homeowner review excerpt",
      status: "Approved 5-star excerpt",
      meta: [entry.market ? `Market: ${marketBySlug(entry.market)?.name || entry.market}` : null, entry.focus || null].filter(Boolean),
      url: entry.targetUrl || "/reviews/",
      cta: entry.targetLabel || "Open target page"
    }));
  }

  const scopeLabel = service && market ? `${service.name} in ${market.name}` : market ? market.name : service ? service.name : "Good Attic";
  const serviceImage = service?.image || proofAssets.sales;

  return [
    {
      kicker: "Ready for approved excerpt",
      title: `Communication review for ${scopeLabel}`,
      text: `Add a real approved homeowner excerpt that mentions how clearly the attic findings, scope, and next steps were explained.`,
      image: serviceImage,
      alt: `Review excerpt shell for ${scopeLabel}`,
      status: "Waiting on approved quote",
      meta: ["Theme: clarity and communication", market ? `Primary landing page: ${market.name}` : "Primary landing page: reviews"],
      url: "/reviews/",
      cta: "Proof page destination"
    },
    {
      kicker: "Ready for approved excerpt",
      title: `Cleanliness and homeowner respect review for ${scopeLabel}`,
      text: "This slot is for a real review excerpt that speaks to cleanliness, respectful crews, and how the home was treated during the project.",
      image: proofAssets.grossAttic,
      alt: `Cleanliness review shell for ${scopeLabel}`,
      status: "Waiting on approved quote",
      meta: ["Theme: cleanliness and care", service ? `Best fit: ${service.name}` : "Best fit: reviews and market pages"],
      url: "/reviews/",
      cta: "Proof page destination"
    },
    {
      kicker: "Ready for approved excerpt",
      title: `Result-focused review for ${scopeLabel}`,
      text: "Use a real approved excerpt that mentions the finished attic, the comfort improvement, or why the homeowner felt better about the house afterward.",
      image: proofAssets.insulation,
      alt: `Outcome review shell for ${scopeLabel}`,
      status: "Waiting on approved quote",
      meta: ["Theme: visible result", market ? `Best secondary target: ${market.name} market page` : "Best secondary target: top service pages"],
      url: market ? `/${market.slug}/` : "/services/",
      cta: "Open target page"
    }
  ];
}

function buildDocumentedProofCards(scope = {}) {
  const market = scope.marketSlug ? marketBySlug(scope.marketSlug) : null;
  const service = scope.serviceSlug ? serviceBySlug(scope.serviceSlug) : null;
  const city = scope.citySlug && market ? market.supportCities.find((item) => item.slug === scope.citySlug) : null;
  const actualEntries = documentedProofEntries(scope);

  if (actualEntries.length) {
    return actualEntries.map((entry) => ({
      kicker: entry.kicker || null,
      title: entry.title,
      text: entry.text,
      image: entry.image || proofAssets.sales,
      alt: entry.alt || entry.title,
      status: entry.status || "Approved asset",
      meta: [entry.assetType ? `Asset: ${entry.assetType}` : null, entry.targetLabel || null].filter(Boolean),
      url: entry.targetUrl || "/reviews/",
      cta: entry.targetLabel || "Open target page"
    }));
  }

  const scopeLabel =
    service && market
      ? `${service.name} in ${market.name}`
      : city && market
        ? `${city.name} through ${market.name}`
        : market
          ? market.name
          : service
            ? service.name
            : "Good Attic";

  return [
    {
      title: `Before-condition photos for ${scopeLabel}`,
      text: "Add real attic photos that show why the attic needed the work before the project started, especially when the final recommendation was more than a simple top-off.",
      image: proofAssets.dirtyReset,
      alt: `Before-condition proof shell for ${scopeLabel}`,
      status: "Waiting on real photos",
      meta: ["Needed: before-condition set", service ? `Best page target: ${service.name}` : "Best page target: reviews and market pages"],
      url: service && market ? `/${market.slug}/${service.slug}/` : market ? `/${market.slug}/` : "/reviews/",
      cta: "Open target page"
    },
    {
      title: `Inspection findings and scope notes for ${scopeLabel}`,
      text: "This slot is for real documented findings that show what the attic inspection uncovered and why the scope was sequenced the way it was.",
      image: proofAssets.sales,
      alt: `Inspection findings proof shell for ${scopeLabel}`,
      status: "Waiting on documented findings",
      meta: ["Needed: findings summary + photo set", market ? `Market path: ${market.name}` : "Market path: reviews"],
      url: market ? `/${market.slug}/` : "/reviews/",
      cta: "Open target page"
    },
    {
      title: `Finished-attic outcome for ${scopeLabel}`,
      text: "Use real after photos that show the attic looked cleaner, more intentional, and more complete after the work was finished.",
      image: service?.image || proofAssets.insulation,
      alt: `Finished-attic proof shell for ${scopeLabel}`,
      status: "Waiting on after photos",
      meta: ["Needed: after-condition set", city ? `Support page: ${city.name}` : "Support page: top market and service pages"],
      url: city && market ? `/${market.slug}/service-areas/${city.slug}/` : service && market ? `/${market.slug}/${service.slug}/` : "/reviews/",
      cta: "Open target page"
    }
  ];
}

const resourcePages = [
  ...marketCatalog.map((market) => buildCostResourcePage(market)),
  buildResourcePage({
    slug: "insulation-removal-vs-top-off",
    url: "/resources/insulation-removal-vs-top-off/",
    market: null,
    primary_keyword: "insulation removal vs top off",
    secondary_keywords: [
      "should old attic insulation be removed",
      "can you add insulation over old insulation",
      "when to remove attic insulation"
    ],
    seo_title: "Insulation Removal vs Top-Off | How to Decide What the Attic Needs",
    meta_description:
      "Learn when old attic insulation can be topped off, when it should be removed first, and what conditions usually make a full attic reset the smarter choice.",
    h1: "Insulation Removal vs Top-Off",
    intro:
      "Homeowners usually ask this question when the attic clearly needs help but the old insulation is still technically there. The real decision is not whether material exists. It is whether the attic you have today is clean and stable enough to build on honestly.",
    page_purpose: "Authority article for insulation decision intent",
    cta_primary: "Get attic guidance",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Resources", url: "/resources/" },
      { label: "Insulation Removal vs Top-Off", url: "/resources/insulation-removal-vs-top-off/" }
    ],
    canonical_url: `${site.baseUrl}/resources/insulation-removal-vs-top-off/`,
    related_links: [
      { label: "Insulation Removal Services", url: "/services/insulation-removal/" },
      { label: "Attic Insulation Services", url: "/services/attic-insulation/" },
      { label: "Attic Pest Remediation Services", url: "/services/attic-pest-remediation/" },
      { label: "Attic Resources", url: "/resources/" }
    ],
    faq_items: [
      {
        question: "When can old attic insulation be topped off instead of removed?",
        answer:
          "A top-off is usually still on the table when the existing insulation is clean, reasonably even, and still worth using as a base layer for the next phase."
      },
      {
        question: "What usually pushes the attic toward full insulation removal?",
        answer:
          "Contamination, pest damage, heavy settling, moisture history, odors, and insulation that no longer feels worth building on are some of the most common reasons the attic needs a cleaner reset."
      },
      {
        question: "Can removal and re-insulation happen in one coordinated project?",
        answer:
          "Yes. That is often the cleanest path because the attic can be reset, sealed, and rebuilt in the right order instead of being handled as disconnected jobs."
      }
    ],
    trust_elements: [
      "Decision support before selling a scope",
      "Built around attic condition, not generic rules",
      "Routes into removal and insulation service pages"
    ],
    hero: {
      eyebrow: "Resources • Scope decisions",
      cardKicker: "What actually changes the answer",
      cardTitle: "The attic condition matters more than whether some insulation is already present.",
      cardText:
        "A lot of homeowners hear that they can just add more material. Sometimes that is true. Sometimes it simply covers over contamination, settling, or leakage that should have been addressed first.",
      cardPoints: [
        "Clean vs contaminated material",
        "Even vs settled coverage",
        "Accessible vs buried attic floor",
        "Simple top-off vs full attic reset"
      ]
    },
    sections: [
      {
        eyebrow: "When a top-off still makes sense",
        heading: "The attic conditions that usually support adding insulation over what is already there.",
        layout: "tiles",
        items: [
          {
            title: "The existing insulation is still clean",
            text: "If the attic material is not contaminated, odorous, or obviously damaged, the base layer may still be worth keeping."
          },
          {
            title: "Coverage is thin, not broken",
            text: "The best top-off situations usually involve underperforming depth rather than a full attic that has already gone bad."
          },
          {
            title: "The attic floor can still be prepared correctly",
            text: "If the important attic areas remain accessible enough for any needed prep, a top-off can stay on the table."
          }
        ]
      },
      {
        eyebrow: "When removal is the more honest answer",
        heading: "The attic conditions that usually justify a reset before anything new is installed.",
        layout: "panels",
        items: [
          {
            title: "Contamination or pest history",
            text: "Rodent damage, droppings, nesting debris, and odors usually mean the attic deserves cleanup rather than concealment."
          },
          {
            title: "Settled or broken-down material",
            text: "If the old insulation is already compacted, inconsistent, or no longer acting like a healthy base layer, adding more on top may not solve much."
          },
          {
            title: "The attic needs air sealing or sanitation access",
            text: "Sometimes the old insulation is physically in the way of the better scope, which makes removal part of doing the project correctly."
          }
        ]
      },
      {
        eyebrow: "What the better project usually looks like",
        heading: "How Good Attic thinks about the sequence once the attic tells the truth.",
        layout: "tiles",
        items: [
          {
            title: "Reset the attic floor when needed",
            text: "Removal creates a cleaner starting point for the attic work that actually matters next."
          },
          {
            title: "Seal or sanitize before reinstalling",
            text: "The attic should be corrected in the order that gives the final insulation layer the best chance of holding up."
          },
          {
            title: "Rebuild with a clearer finish line",
            text: "The goal is to leave the homeowner with an attic that feels resolved, not just fuller."
          }
        ]
      },
      {
        eyebrow: "Best next pages",
        heading: "The service pages that usually help once this decision becomes clearer.",
        layout: "features",
        withImages: true,
        items: [
          {
            url: "/services/insulation-removal/",
            title: "Insulation Removal Services",
            kicker: "Core service",
            text: serviceBySlug("insulation-removal").summary,
            image: serviceBySlug("insulation-removal").image,
            alt: "Insulation removal services",
            cta: "View removal service"
          },
          {
            url: "/services/attic-insulation/",
            title: "Attic Insulation Services",
            kicker: "Core service",
            text: serviceBySlug("attic-insulation").summary,
            image: serviceBySlug("attic-insulation").image,
            alt: "Attic insulation services",
            cta: "View insulation service"
          },
          {
            url: "/services/attic-pest-remediation/",
            title: "Attic Pest Remediation Services",
            kicker: "Related cleanup",
            text: serviceBySlug("attic-pest-remediation").summary,
            image: serviceBySlug("attic-pest-remediation").image,
            alt: "Attic pest remediation services",
            cta: "View cleanup path"
          }
        ]
      },
      {
        eyebrow: "Local service paths",
        heading: "If the attic likely needs a reset, use the closest local removal page next.",
        subcopy:
          "These are the fastest routes from this decision guide into the local market pages where removal scopes actually get explained in context.",
        layout: "features",
        withImages: true,
        items: buildLocalizedResourceCards("insulation-removal", "Local removal path", "Open local service")
      }
    ],
    cta: {
      title: "Need help deciding whether the attic should be removed or built on?",
      text: "That decision gets easier once the attic is documented clearly. Start there, and the right scope usually reveals itself.",
      primary: { label: "Request an Attic Assessment", url: "/contact/", kicker: "Next step" }
    }
  }),
  buildResourcePage({
    slug: "attic-air-sealing-vs-more-insulation",
    url: "/resources/attic-air-sealing-vs-more-insulation/",
    market: null,
    primary_keyword: "attic air sealing vs more insulation",
    secondary_keywords: [
      "do I need air sealing or insulation",
      "attic bypasses vs insulation depth",
      "air sealing before insulation"
    ],
    seo_title: "Attic Air Sealing vs More Insulation | What the Home Usually Needs First",
    meta_description:
      "Learn how to think through attic air sealing versus adding more insulation, what each one actually solves, and when the best attic plan includes both.",
    h1: "Attic Air Sealing vs More Insulation",
    intro:
      "This is one of the most common attic questions because both options sound like they should help. They do, but they solve different problems. The real decision is about whether the attic boundary is open, under-insulated, or both at the same time.",
    page_purpose: "Authority article for sealing vs insulation intent",
    cta_primary: "Get attic guidance",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Resources", url: "/resources/" },
      { label: "Attic Air Sealing vs More Insulation", url: "/resources/attic-air-sealing-vs-more-insulation/" }
    ],
    canonical_url: `${site.baseUrl}/resources/attic-air-sealing-vs-more-insulation/`,
    related_links: [
      { label: "Attic Air Sealing Services", url: "/services/attic-air-sealing/" },
      { label: "Attic Insulation Services", url: "/services/attic-insulation/" },
      { label: "Attic Resources", url: "/resources/" }
    ],
    faq_items: [
      {
        question: "Can more insulation fix a leaky attic floor by itself?",
        answer:
          "Not usually. More insulation helps with thermal resistance, but it does not close the actual leakage paths where conditioned air escapes or dusty attic air moves back toward the house."
      },
      {
        question: "Can attic air sealing matter even when the home already has insulation?",
        answer:
          "Yes. Many homes have enough insulation to look acceptable at a glance but still leak badly enough at the attic floor that comfort and efficiency suffer."
      },
      {
        question: "When does the best attic plan include both sealing and insulation?",
        answer:
          "Very often. Once the attic floor is tighter, the insulation has a better chance of doing its job the way the homeowner expects."
      }
    ],
    trust_elements: [
      "Explains the difference between two commonly confused upgrades",
      "Built around how the attic boundary actually works",
      "Routes into the right core service pages"
    ],
    hero: {
      eyebrow: "Resources • Performance decisions",
      cardKicker: "Different problems, different jobs",
      cardTitle: "Insulation slows heat flow. Air sealing closes the openings underneath it.",
      cardText:
        "A lot of homeowners end up choosing between the two when the attic may really need both. The attic performs best when the boundary is tighter and the insulation layer is built on top of that stronger base.",
      cardPoints: [
        "Open bypasses vs thin coverage",
        "Dusty air movement vs weak thermal layer",
        "Boundary correction before top-off decisions",
        "Combined scopes when both issues are real"
      ]
    },
    sections: [
      {
        eyebrow: "What insulation is solving",
        heading: "When more insulation is clearly part of the answer.",
        layout: "tiles",
        items: [
          {
            title: "The attic simply needs a stronger thermal layer",
            text: "If the insulation depth is low, uneven, or obviously settled, improving it is often essential for more stable comfort."
          },
          {
            title: "Upper rooms are exposing heat gain or heat loss",
            text: "Hot upstairs rooms in summer and winter discomfort can both point to a weak insulation layer."
          },
          {
            title: "The attic is otherwise ready for the next layer",
            text: "When the attic is clean and the boundary is in decent shape, insulation can become the most direct performance upgrade."
          }
        ]
      },
      {
        eyebrow: "What air sealing is solving",
        heading: "When the attic boundary itself is the bigger first problem.",
        layout: "panels",
        items: [
          {
            title: "Conditioned air is leaking through the ceiling plane",
            text: "Open penetrations, top-plate gaps, and attic bypasses let the house bleed energy even if insulation is already present."
          },
          {
            title: "Dust or attic air seems to be moving into the house",
            text: "That kind of attic-to-home exchange usually points back to leakage, not just a missing layer of insulation."
          },
          {
            title: "The insulation needs a better base to sit on",
            text: "Sealing first can keep the final insulation layer from covering up the real weakness in the attic floor."
          }
        ]
      },
      {
        eyebrow: "When the answer is both",
        heading: "Why the strongest attic projects often combine sealing and insulation instead of forcing a false choice.",
        layout: "tiles",
        items: [
          {
            title: "The attic is open and under-insulated",
            text: "That is one of the most common real-world combinations, which is why single-upgrade answers can feel incomplete."
          },
          {
            title: "The homeowner wants a longer-lasting result",
            text: "A tighter boundary gives the finished insulation layer a better chance of performing the way the scope promised."
          },
          {
            title: "The attic is already being reset or rebuilt",
            text: "If the attic is open for cleanup, removal, or major work anyway, it is often the right time to correct both issues in one pass."
          }
        ]
      },
      {
        eyebrow: "Best next pages",
        heading: "Where to go next once the attic decision is getting clearer.",
        layout: "features",
        withImages: true,
        items: [
          {
            url: "/services/attic-air-sealing/",
            title: "Attic Air Sealing Services",
            kicker: "Core service",
            text: serviceBySlug("attic-air-sealing").summary,
            image: serviceBySlug("attic-air-sealing").image,
            alt: "Attic air sealing services",
            cta: "View air sealing service"
          },
          {
            url: "/services/attic-insulation/",
            title: "Attic Insulation Services",
            kicker: "Core service",
            text: serviceBySlug("attic-insulation").summary,
            image: serviceBySlug("attic-insulation").image,
            alt: "Attic insulation services",
            cta: "View insulation service"
          },
          {
            url: "/contact/",
            title: "Request an attic assessment",
            kicker: "Next step",
            text: "If the home is showing both leakage and insulation symptoms, the attic assessment is the cleanest way to separate the real causes.",
            image: "assets/good-attic-insulation-sales-appointment.png",
            alt: "Request an attic assessment",
            cta: "Start a request"
          }
        ]
      },
      {
        eyebrow: "Local service paths",
        heading: "Use the closest local attic air sealing page when the boundary problem feels market-specific.",
        subcopy:
          "These local service pages are the quickest way to move from the general decision into climate-aware attic guidance.",
        layout: "features",
        withImages: true,
        items: buildLocalizedResourceCards("attic-air-sealing", "Local sealing path", "Open local service")
      }
    ],
    cta: {
      title: "Need help figuring out whether the attic needs sealing, insulation, or both?",
      text: "That is exactly the kind of decision the attic assessment is built to clarify before the project gets over-simplified.",
      primary: { label: "Request an Attic Assessment", url: "/contact/", kicker: "Next step" }
    }
  }),
  buildResourcePage({
    slug: "signs-of-attic-pest-contamination",
    url: "/resources/signs-of-attic-pest-contamination/",
    market: null,
    primary_keyword: "signs of attic pest contamination",
    secondary_keywords: [
      "rodent attic contamination signs",
      "attic cleanup after rodents",
      "attic insulation contaminated by pests"
    ],
    seo_title: "Signs of Attic Pest Contamination | What to Watch for After Rodents",
    meta_description:
      "Learn the common signs of attic pest contamination, what usually lingers after rodents are gone, and when the attic needs cleanup, removal, and restoration instead of a simple patch.",
    h1: "Signs of Attic Pest Contamination",
    intro:
      "A lot of homeowners assume the problem ends once the animals are gone. In reality, the attic can stay unhealthy long after that point if droppings, nesting debris, damaged insulation, and odor are still sitting above the ceiling.",
    page_purpose: "Authority article for pest contamination intent",
    cta_primary: "Get attic guidance",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Resources", url: "/resources/" },
      { label: "Signs of Attic Pest Contamination", url: "/resources/signs-of-attic-pest-contamination/" }
    ],
    canonical_url: `${site.baseUrl}/resources/signs-of-attic-pest-contamination/`,
    related_links: [
      { label: "Attic Pest Remediation Services", url: "/services/attic-pest-remediation/" },
      { label: "Insulation Removal Services", url: "/services/insulation-removal/" },
      { label: "Attic Resources", url: "/resources/" }
    ],
    faq_items: [
      {
        question: "What is the difference between pest control and attic remediation?",
        answer:
          "Pest control or exclusion addresses the animals. Attic remediation addresses the contaminated insulation, nesting debris, droppings, odor, and restoration work left behind."
      },
      {
        question: "Does contaminated insulation always have to be removed?",
        answer:
          "Not always every inch, but affected material usually needs more than surface attention. The attic has to be inspected to see how widespread the contamination really is."
      },
      {
        question: "What should homeowners look for after rodents have been in the attic?",
        answer:
          "Odor, visible nesting debris, droppings, torn insulation, dusty material, and attic sections that no longer feel clean or trustworthy are some of the most common signs."
      }
    ],
    trust_elements: [
      "Clarifies what remains after the animals are gone",
      "Bridges homeowners into real cleanup and restoration pages",
      "Built around visible attic conditions, not fear-based claims"
    ],
    hero: {
      eyebrow: "Resources • Cleanup decisions",
      cardKicker: "What lingers after pests",
      cardTitle: "The attic can still need real restoration even after the rodent problem is technically over.",
      cardText:
        "That is why the best next step is often not just asking whether pests were present. It is asking what was left behind in the insulation and the attic environment.",
      cardPoints: [
        "Droppings and nesting debris",
        "Damaged or shredded insulation",
        "Persistent attic odor",
        "Cleanup vs full restoration decisions"
      ]
    },
    sections: [
      {
        eyebrow: "What homeowners usually notice",
        heading: "The most common signs the attic is still contaminated after rodents or other pests.",
        layout: "tiles",
        items: [
          {
            title: "Visible debris or droppings",
            text: "Loose nesting material, waste, and concentrated mess usually mean the attic needs more than a cosmetic touch-up."
          },
          {
            title: "Insulation that looks torn, flattened, or dirty",
            text: "Pests often leave insulation physically damaged and no longer worth treating like a clean base layer."
          },
          {
            title: "Odor that lingers even when the animal issue is gone",
            text: "That kind of attic smell usually points to contamination that still needs to be removed or sanitized."
          }
        ]
      },
      {
        eyebrow: "Why the attic still needs attention",
        heading: "What pest contamination often changes about the attic project.",
        layout: "panels",
        items: [
          {
            title: "The insulation may no longer be worth building on",
            text: "If the material is contaminated or damaged enough, the attic often needs removal before it can become healthy again."
          },
          {
            title: "Cleanup and sanitation become part of the real scope",
            text: "The attic may need direct restoration steps beyond simply installing new insulation."
          },
          {
            title: "The homeowner usually wants the attic to feel clean again",
            text: "That finish line is bigger than just removing the worst visible debris. It means making the attic easier to trust."
          }
        ]
      },
      {
        eyebrow: "What the better next step looks like",
        heading: "How the attic usually gets restored after contamination becomes obvious.",
        layout: "tiles",
        items: [
          {
            title: "Assess how widespread the damage really is",
            text: "The attic should be evaluated as a whole instead of assuming the issue stopped where the first visible mess was found."
          },
          {
            title: "Remove and clean what the attic actually needs",
            text: "That may include damaged insulation, contaminated debris, and sanitation work that supports a healthier finish."
          },
          {
            title: "Rebuild the attic as a cleaner system",
            text: "The strongest outcome comes when the attic is restored, not merely cleaned enough to move on from."
          }
        ]
      },
      {
        eyebrow: "Best next pages",
        heading: "The Good Attic pages that usually help once contamination is confirmed.",
        layout: "features",
        withImages: true,
        items: [
          {
            url: "/services/attic-pest-remediation/",
            title: "Attic Pest Remediation Services",
            kicker: "Core service",
            text: serviceBySlug("attic-pest-remediation").summary,
            image: serviceBySlug("attic-pest-remediation").image,
            alt: "Attic pest remediation services",
            cta: "View remediation service"
          },
          {
            url: "/services/insulation-removal/",
            title: "Insulation Removal Services",
            kicker: "Reset the attic",
            text: serviceBySlug("insulation-removal").summary,
            image: serviceBySlug("insulation-removal").image,
            alt: "Insulation removal services",
            cta: "View removal service"
          },
          {
            url: "/contact/",
            title: "Request an attic assessment",
            kicker: "Next step",
            text: "If the attic has visible contamination or odor, the documented assessment is the cleanest way to decide how complete the cleanup needs to be.",
            image: "assets/gross-attic.png",
            alt: "Request an attic assessment after pest contamination",
            cta: "Start a request"
          }
        ]
      },
      {
        eyebrow: "Local service paths",
        heading: "When contamination is obvious, the closest local pest-remediation page is usually the right next stop.",
        subcopy:
          "These pages connect the contamination decision directly to the metro team that can explain cleanup and restoration in local context.",
        layout: "features",
        withImages: true,
        items: buildLocalizedResourceCards("attic-pest-remediation", "Local remediation path", "Open local service")
      }
    ],
    cta: {
      title: "Need help figuring out whether the attic is still contaminated after pests?",
      text: "The next step is to document what is still in the attic and decide whether cleanup, removal, sanitation, and rebuild work belong together.",
      primary: { label: "Request an Attic Assessment", url: "/contact/", kicker: "Next step" }
    }
  }),
  buildResourcePage({
    slug: "attic-fan-vs-ventilation-fix",
    url: "/resources/attic-fan-vs-ventilation-fix/",
    market: null,
    primary_keyword: "attic fan vs ventilation fix",
    secondary_keywords: [
      "will an attic fan fix hot upstairs rooms",
      "attic fan worth it",
      "attic ventilation problems"
    ],
    seo_title: "Attic Fan vs Ventilation Fix | When a Fan Helps and When the Attic Needs More",
    meta_description:
      "Learn when an attic fan can help, when the bigger issue is insulation or attic leakage, and how to think through ventilation support without oversimplifying the attic problem.",
    h1: "Attic Fan vs Ventilation Fix",
    intro:
      "Homeowners often hear attic fans pitched like a universal answer for hot upstairs rooms. Sometimes fan support makes sense. Sometimes the attic needs insulation, boundary work, or a broader ventilation correction before a fan deserves to lead the conversation.",
    page_purpose: "Authority article for attic fan decision intent",
    cta_primary: "Get attic guidance",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Resources", url: "/resources/" },
      { label: "Attic Fan vs Ventilation Fix", url: "/resources/attic-fan-vs-ventilation-fix/" }
    ],
    canonical_url: `${site.baseUrl}/resources/attic-fan-vs-ventilation-fix/`,
    related_links: [
      { label: "Attic Fan Services", url: "/services/attic-fans/" },
      { label: "Attic Insulation Services", url: "/services/attic-insulation/" },
      { label: "Attic Air Sealing Services", url: "/services/attic-air-sealing/" },
      { label: "Attic Resources", url: "/resources/" }
    ],
    faq_items: [
      {
        question: "Will an attic fan fix every hot-upstairs problem by itself?",
        answer:
          "No. A fan may support the attic in the right situation, but many homes with hot upstairs rooms also have weak insulation, open bypasses, or bigger attic airflow issues that a fan alone does not correct."
      },
      {
        question: "When does an attic fan usually make more sense?",
        answer:
          "Usually after the attic has been inspected closely enough to show that the fan would support a real heat-management need instead of distracting from a larger insulation or boundary problem."
      },
      {
        question: "Can an attic fan be part of a broader attic plan?",
        answer:
          "Yes. Fan support can work alongside insulation, air sealing, and cleanup when the attic has earned that recommendation through documented conditions."
      }
    ],
    trust_elements: [
      "Separates fan fit from generic hot-attic sales language",
      "Keeps ventilation conversations tied to attic conditions",
      "Routes into fan, insulation, and sealing paths"
    ],
    hero: {
      eyebrow: "Resources • Ventilation decisions",
      cardKicker: "When a fan belongs",
      cardTitle: "A good attic fan recommendation should follow the attic story, not replace it.",
      cardText:
        "The attic can be hot for more than one reason. The right fix depends on whether the issue is trapped heat, weak insulation, open leakage paths, or a broader ventilation setup that never worked correctly.",
      cardPoints: [
        "Trapped heat vs thin insulation",
        "Ventilation support vs full correction",
        "Airflow pathway fit",
        "When a fan should not lead the project"
      ]
    },
    sections: [
      {
        eyebrow: "When a fan may be part of the answer",
        heading: "The attic conditions that can make fan support worth considering.",
        layout: "tiles",
        items: [
          {
            title: "The attic is holding excessive heat",
            text: "If the attic has a real heat-management problem and the overall setup supports it, fan assistance can become part of the solution."
          },
          {
            title: "The airflow path can actually support the install",
            text: "The recommendation should account for the attic layout, pathway support, and whether the product belongs in that attic design."
          },
          {
            title: "The homeowner needs fan support inside a broader plan",
            text: "A fan can be useful when it is one layer of the attic strategy instead of a stand-alone promise."
          }
        ]
      },
      {
        eyebrow: "When the attic needs more than a fan",
        heading: "The problems that usually point toward a larger correction before a fan deserves center stage.",
        layout: "panels",
        items: [
          {
            title: "The insulation layer is still underperforming",
            text: "If the attic is thin, settled, or poorly insulated, the bigger opportunity may still be improving the thermal layer first."
          },
          {
            title: "The attic floor is open and leaking",
            text: "Boundary leakage can keep the house uncomfortable even when attic heat is part of the picture, which is why sealing questions matter too."
          },
          {
            title: "The attic is dirty or compromised",
            text: "If cleanup, removal, or restoration belong in the scope, a fan should not distract from the more important attic reset work."
          }
        ]
      },
      {
        eyebrow: "What a better ventilation decision looks like",
        heading: "How Good Attic should think through the fan conversation before the quote gets simplified.",
        layout: "tiles",
        items: [
          {
            title: "Document the attic heat context",
            text: "The attic should be evaluated for trapped heat, coverage gaps, and any signs that the fan conversation is masking another problem."
          },
          {
            title: "Check whether the airflow path supports the idea",
            text: "A fan recommendation should fit the attic layout instead of being dropped into every hot-attic conversation by default."
          },
          {
            title: "Connect the fan to the rest of the attic system",
            text: "The best outcome is a home that feels better because the fan supports a clearer attic plan, not because it got sold first."
          }
        ]
      },
      {
        eyebrow: "Best next pages",
        heading: "The pages that usually help once the ventilation question gets clearer.",
        layout: "features",
        withImages: true,
        items: [
          {
            url: "/services/attic-fans/",
            title: "Attic Fan Services",
            kicker: "Core service",
            text: serviceBySlug("attic-fans").summary,
            image: serviceBySlug("attic-fans").image,
            alt: "Attic fan services",
            cta: "View fan service"
          },
          {
            url: "/services/attic-insulation/",
            title: "Attic Insulation Services",
            kicker: "Related comfort path",
            text: serviceBySlug("attic-insulation").summary,
            image: serviceBySlug("attic-insulation").image,
            alt: "Attic insulation services",
            cta: "Compare insulation path"
          },
          {
            url: "/services/attic-air-sealing/",
            title: "Attic Air Sealing Services",
            kicker: "Boundary path",
            text: serviceBySlug("attic-air-sealing").summary,
            image: serviceBySlug("attic-air-sealing").image,
            alt: "Attic air sealing services",
            cta: "Compare sealing path"
          }
        ]
      },
      {
        eyebrow: "Local service paths",
        heading: "When the attic looks like a real fan candidate, move into the closest local fan page next.",
        subcopy:
          "These local pages help keep the ventilation conversation tied to market-specific attic conditions instead of generic fan language.",
        layout: "features",
        withImages: true,
        items: buildLocalizedResourceCards("attic-fans", "Local fan path", "Open local service")
      }
    ],
    cta: {
      title: "Need help figuring out whether the attic needs fan support or a broader correction?",
      text: "The attic assessment is where the ventilation question gets separated from the insulation and boundary questions that often overlap with it.",
      primary: { label: "Request an Attic Assessment", url: "/contact/", kicker: "Next step" }
    }
  }),
  buildResourcePage({
    slug: "what-r-value-means-for-an-attic",
    url: "/resources/what-r-value-means-for-an-attic/",
    market: null,
    primary_keyword: "attic r-value",
    secondary_keywords: [
      "attic insulation depth",
      "how much attic insulation do i need",
      "what r-value means"
    ],
    seo_title: "What R-Value Means for an Attic | How to Think About Insulation Depth",
    meta_description:
      "Learn what attic R-value actually means, why insulation depth is only part of the story, and how Good Attic thinks through modern insulation targets without guesswork.",
    h1: "What R-Value Means for an Attic",
    intro:
      "R-value gets mentioned constantly in attic conversations, but homeowners usually deserve more context than just a number. R-value helps describe thermal resistance, but a better attic plan still depends on attic condition, current depth, air leakage, and whether the space is actually ready for the next layer.",
    page_purpose: "Authority article for attic insulation depth intent",
    cta_primary: "Get attic guidance",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Resources", url: "/resources/" },
      { label: "What R-Value Means for an Attic", url: "/resources/what-r-value-means-for-an-attic/" }
    ],
    canonical_url: `${site.baseUrl}/resources/what-r-value-means-for-an-attic/`,
    related_links: [
      { label: "Attic Insulation Services", url: "/services/attic-insulation/" },
      { label: "Insulation Removal Services", url: "/services/insulation-removal/" },
      { label: "Attic Resources", url: "/resources/" }
    ],
    faq_items: [
      {
        question: "Is R-value the only thing that matters in an attic insulation quote?",
        answer:
          "No. R-value matters, but attic condition, current coverage, leakage, contamination, and whether the space is ready for new insulation all affect the right recommendation too."
      },
      {
        question: "Can a house have the right number on paper but still feel uncomfortable?",
        answer:
          "Yes. Homes can still feel off when the insulation is uneven, settled, buried over leakage points, or part of an attic that was never corrected as a full system."
      },
      {
        question: "Why do homeowners still need an inspection if they already know the attic target they want?",
        answer:
          "Because the attic has to be ready for that target honestly. A deeper install does not fix contamination, access problems, or an open attic boundary underneath it."
      }
    ],
    trust_elements: [
      "Explains the number without pretending the number is the whole job",
      "Keeps insulation targets tied to attic condition",
      "Routes into local insulation pages and cost guides"
    ],
    hero: {
      eyebrow: "Resources • Insulation decisions",
      cardKicker: "What the number means",
      cardTitle: "R-value matters, but the attic still has to be ready for the insulation plan behind it.",
      cardText:
        "A stronger insulation target only works well when the attic underneath it is clean, accessible, and corrected enough to support the install the right way.",
      cardPoints: [
        "Thermal resistance, not magic",
        "Coverage depth and consistency",
        "Boundary issues underneath the insulation",
        "When a deeper target still needs a cleaner attic"
      ]
    },
    sections: [
      {
        eyebrow: "What R-value is actually describing",
        heading: "The simplest way to think about R-value in attic conversations.",
        layout: "tiles",
        items: [
          {
            title: "It describes resistance to heat flow",
            text: "The higher the resistance, the better the attic can usually slow down unwanted heat movement when the install is done well."
          },
          {
            title: "It depends on real coverage, not just the label",
            text: "The attic has to have the depth and consistency to achieve the performance the recommendation is aiming for."
          },
          {
            title: "It works best when the rest of the attic system supports it",
            text: "A stronger number helps most when the attic is not leaking badly or sitting on top of compromised material."
          }
        ]
      },
      {
        eyebrow: "Why the number is not the whole answer",
        heading: "The attic conditions that can make an R-value conversation incomplete by itself.",
        layout: "panels",
        items: [
          {
            title: "The attic may need cleanup or removal first",
            text: "If the current insulation is dirty, contaminated, or broken down, the attic can need a reset before a deeper target means much."
          },
          {
            title: "The attic floor may still be open",
            text: "When major bypasses are still leaking, the insulation layer is being asked to perform over a weak boundary."
          },
          {
            title: "The coverage can be uneven even when material is present",
            text: "A homeowner may have insulation in the attic already and still not have a consistent enough layer to trust the performance."
          }
        ]
      },
      {
        eyebrow: "What a better insulation recommendation includes",
        heading: "The parts of the quote that should sit next to any R-value target.",
        layout: "tiles",
        items: [
          {
            title: "Current attic condition",
            text: "The recommendation should say whether the existing material is worth keeping, topping off, or replacing."
          },
          {
            title: "Prep work that protects the install",
            text: "If sealing, cleanup, or pathway prep are needed, the attic plan should explain that before the new material gets installed."
          },
          {
            title: "A clear finish line for the homeowner",
            text: "The quote should help the homeowner understand what the attic is being improved toward, not just which number got quoted."
          }
        ]
      },
      {
        eyebrow: "Best next pages",
        heading: "The pages that usually help once the insulation target conversation becomes more concrete.",
        layout: "features",
        withImages: true,
        items: [
          {
            url: "/services/attic-insulation/",
            title: "Attic Insulation Services",
            kicker: "Core service",
            text: serviceBySlug("attic-insulation").summary,
            image: serviceBySlug("attic-insulation").image,
            alt: "Attic insulation services",
            cta: "View insulation service"
          },
          {
            url: "/resources/insulation-removal-vs-top-off/",
            title: "Insulation Removal vs Top-Off",
            kicker: "Scope decision",
            text: "Use this guide when the bigger question is not just how much insulation to add, but whether the attic is worth building on first.",
            image: proofAssets.dirtyReset,
            alt: "Insulation removal versus top-off guide",
            cta: "Compare scope paths"
          },
          {
            url: "/resources/",
            title: "Attic Resources",
            kicker: "Research hub",
            text: "Keep going through the decision layer if the attic still feels like a bigger system question than one insulation number.",
            image: proofAssets.sales,
            alt: "Good Attic resources hub",
            cta: "Open resource hub"
          }
        ]
      },
      {
        eyebrow: "Local service paths",
        heading: "Once the target makes more sense, move into the closest local insulation page next.",
        subcopy:
          "These market-specific insulation pages help turn the R-value conversation into a real attic recommendation.",
        layout: "features",
        withImages: true,
        items: buildLocalizedResourceCards("attic-insulation", "Local insulation path", "Open local service")
      }
    ],
    cta: {
      title: "Need help figuring out whether the attic is actually ready for a deeper insulation target?",
      text: "The attic assessment is what separates a useful insulation recommendation from a number that sounds good but sits on top of the wrong conditions.",
      primary: { label: "Request an Attic Assessment", url: "/contact/", kicker: "Next step" }
    }
  }),
  buildResourcePage({
    slug: "why-upstairs-rooms-stay-hot",
    url: "/resources/why-upstairs-rooms-stay-hot/",
    market: null,
    primary_keyword: "why upstairs rooms stay hot",
    secondary_keywords: [
      "hot upstairs bedroom attic",
      "second floor too hot",
      "upstairs hot even with ac"
    ],
    seo_title: "Why Upstairs Rooms Stay Hot | What the Attic Is Usually Doing",
    meta_description:
      "Learn why upstairs rooms stay hot even when AC is running, how the attic often shapes the problem, and what kinds of attic fixes usually make the biggest difference.",
    h1: "Why Upstairs Rooms Stay Hot",
    intro:
      "This is one of the most common attic-driven complaints because upstairs discomfort is rarely caused by just one thing. The attic may be under-insulated, leaking at the boundary, trapping too much heat, or carrying a combination of problems that keep the upper floor from stabilizing.",
    page_purpose: "Authority article for hot upstairs intent",
    cta_primary: "Get attic guidance",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Resources", url: "/resources/" },
      { label: "Why Upstairs Rooms Stay Hot", url: "/resources/why-upstairs-rooms-stay-hot/" }
    ],
    canonical_url: `${site.baseUrl}/resources/why-upstairs-rooms-stay-hot/`,
    related_links: [
      { label: "Attic Insulation Services", url: "/services/attic-insulation/" },
      { label: "Attic Air Sealing Services", url: "/services/attic-air-sealing/" },
      { label: "Attic Fan Services", url: "/services/attic-fans/" },
      { label: "Attic Resources", url: "/resources/" }
    ],
    faq_items: [
      {
        question: "Can the attic really make upstairs rooms hotter even when the air conditioner is running?",
        answer:
          "Yes. Weak insulation, leakage at the attic floor, and excess attic heat can all push the upstairs harder than the rest of the house and make the AC feel less effective."
      },
      {
        question: "Does a hot upstairs always mean the home needs more insulation?",
        answer:
          "Not always. Insulation is often part of the answer, but many homes also need air sealing, cleanup before re-insulating, or a broader look at how the attic is handling heat."
      },
      {
        question: "Why is the problem worse in some rooms than others?",
        answer:
          "The attic can affect rooms unevenly depending on coverage gaps, roof exposure, upper-floor layout, and where the attic boundary is weaker over specific parts of the home."
      }
    ],
    trust_elements: [
      "Built around one of the highest-value homeowner symptom searches",
      "Connects comfort complaints to real attic causes",
      "Routes into the right local service paths instead of guessing"
    ],
    hero: {
      eyebrow: "Resources • Comfort symptoms",
      cardKicker: "What the attic is often doing",
      cardTitle: "Hot upstairs rooms usually mean the attic is not controlling heat and air the way the house needs.",
      cardText:
        "The upstairs may be telling the truth about more than one attic weakness at once, which is why the best fix is often a better attic diagnosis instead of a single guess.",
      cardPoints: [
        "Weak thermal layer",
        "Air leakage through the ceiling plane",
        "Excess attic heat",
        "Room-by-room comfort imbalance"
      ]
    },
    sections: [
      {
        eyebrow: "What can be driving the symptom",
        heading: "The most common attic reasons upstairs rooms stay hotter than the rest of the house.",
        layout: "tiles",
        items: [
          {
            title: "The insulation layer is not strong enough",
            text: "When the attic coverage is thin, settled, or inconsistent, upper rooms can feel the seasonal load more intensely than the rest of the home."
          },
          {
            title: "The attic floor is still leaking",
            text: "Open bypasses and ceiling-plane leakage let conditioned air escape and allow attic conditions to influence the rooms below more directly."
          },
          {
            title: "The attic is holding too much heat",
            text: "When excess attic heat builds up, the upstairs often feels it first, especially in rooms with more roof exposure or broader upper-floor surfaces."
          }
        ]
      },
      {
        eyebrow: "Why one simple guess often misses it",
        heading: "Hot upstairs rooms are often a multi-part attic problem rather than a single-service problem.",
        layout: "panels",
        items: [
          {
            title: "Insulation alone may not finish the job",
            text: "A better thermal layer matters, but if the attic boundary is still open or the space needs a reset first, the result can still feel incomplete."
          },
          {
            title: "A fan is not always the main answer",
            text: "In some homes ventilation support helps. In others it gets too much attention when the bigger issue is still insulation or leakage."
          },
          {
            title: "The attic can deserve a fuller correction",
            text: "When comfort complaints, dust, contamination, or inconsistent coverage all overlap, the homeowner usually needs a more complete attic plan."
          }
        ]
      },
      {
        eyebrow: "What the better next step looks like",
        heading: "How Good Attic should turn the symptom into a smarter attic recommendation.",
        layout: "tiles",
        items: [
          {
            title: "Document the attic conditions over the affected rooms",
            text: "The assessment should show what the insulation, boundary, and heat-management conditions look like where the comfort complaint is strongest."
          },
          {
            title: "Separate the attic causes that overlap",
            text: "The homeowner should learn whether the bigger problem is under-insulation, leakage, trapped heat, or a combination."
          },
          {
            title: "Route into the right service path",
            text: "That can mean insulation, air sealing, fan support, or a larger attic reset depending on what the attic evidence actually shows."
          }
        ]
      },
      {
        eyebrow: "Best next pages",
        heading: "The pages that usually help when upstairs comfort is the reason the homeowner started searching.",
        layout: "features",
        withImages: true,
        items: [
          {
            url: "/services/attic-insulation/",
            title: "Attic Insulation Services",
            kicker: "Core service",
            text: serviceBySlug("attic-insulation").summary,
            image: serviceBySlug("attic-insulation").image,
            alt: "Attic insulation services",
            cta: "View insulation path"
          },
          {
            url: "/services/attic-air-sealing/",
            title: "Attic Air Sealing Services",
            kicker: "Boundary path",
            text: serviceBySlug("attic-air-sealing").summary,
            image: serviceBySlug("attic-air-sealing").image,
            alt: "Attic air sealing services",
            cta: "Compare sealing path"
          },
          {
            url: "/resources/attic-fan-vs-ventilation-fix/",
            title: "Attic Fan vs Ventilation Fix",
            kicker: "Ventilation decision",
            text: "Use this guide when the comfort symptom might be pushing the attic fan conversation too early or too simply.",
            image: proofAssets.fans,
            alt: "Attic fan versus ventilation fix guide",
            cta: "Read fan guide"
          }
        ]
      },
      {
        eyebrow: "Choose the right market",
        heading: "Once the hot-upstairs symptom feels attic-related, move into the nearest market hub next.",
        subcopy:
          "These market pages are the cleanest way to move from the comfort symptom into local service pages and the right contact path.",
        layout: "features",
        withImages: true,
        items: buildMarketRouteCards("Comfort path", "Open market hub", (market) =>
          `Use ${market.shortName} to compare the local insulation, air sealing, and attic fan pages that usually matter most when upstairs rooms are running hot.`
        )
      }
    ],
    cta: {
      title: "Need help figuring out what the attic is doing to the upstairs?",
      text: "The attic assessment is built to turn the comfort complaint into a documented scope instead of another guess about what the house might need.",
      primary: { label: "Request an Attic Assessment", url: "/contact/", kicker: "Next step" }
    }
  }),
  buildResourcePage({
    slug: "when-attic-cleanup-becomes-restoration",
    url: "/resources/when-attic-cleanup-becomes-restoration/",
    market: null,
    primary_keyword: "attic cleanup restoration",
    secondary_keywords: [
      "attic cleanup vs restoration",
      "dirty attic needs insulation removal",
      "attic restoration after contamination"
    ],
    seo_title: "When Attic Cleanup Becomes Restoration | How to Know the Scope Is Bigger",
    meta_description:
      "Learn when an attic needs more than basic cleanup, what usually turns the job into restoration, and how Good Attic thinks through removal, sanitation, sealing, and rebuild work together.",
    h1: "When Attic Cleanup Becomes Restoration",
    intro:
      "A lot of homeowners start out thinking the attic just needs to be cleaned up. Sometimes that is true. Sometimes the attic is telling a bigger story about contaminated insulation, access problems, air leakage, or damage that turns the job into a more complete restoration plan.",
    page_purpose: "Authority article for attic cleanup intent",
    cta_primary: "Get attic guidance",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Resources", url: "/resources/" },
      { label: "When Attic Cleanup Becomes Restoration", url: "/resources/when-attic-cleanup-becomes-restoration/" }
    ],
    canonical_url: `${site.baseUrl}/resources/when-attic-cleanup-becomes-restoration/`,
    related_links: [
      { label: "Insulation Removal Services", url: "/services/insulation-removal/" },
      { label: "Attic Pest Remediation Services", url: "/services/attic-pest-remediation/" },
      { label: "Attic Air Sealing Services", url: "/services/attic-air-sealing/" },
      { label: "Attic Resources", url: "/resources/" }
    ],
    faq_items: [
      {
        question: "What usually turns an attic cleanup into restoration?",
        answer:
          "Contamination, damaged insulation, odor, heavy dust or debris, pest aftermath, and access to hidden leakage or sanitation issues are some of the most common reasons the scope grows."
      },
      {
        question: "Why is cleanup sometimes not enough?",
        answer:
          "Because the attic may need removal, sanitation, sealing, and reinstall work to become healthy and trustworthy again rather than just looking slightly cleaner."
      },
      {
        question: "Can restoration still include new insulation at the end?",
        answer:
          "Yes. In many homes the attic gets cleaned up, corrected, and then rebuilt with the right insulation strategy once the base conditions are finally right."
      }
    ],
    trust_elements: [
      "Clarifies where simple cleanup stops being the honest answer",
      "Connects removal, sanitation, and rebuild logic together",
      "Routes into restoration-oriented service paths"
    ],
    hero: {
      eyebrow: "Resources • Cleanup scope",
      cardKicker: "When the job gets bigger",
      cardTitle: "Some attics do not just need cleaning. They need to be reset and restored with a plan.",
      cardText:
        "The attic deserves a bigger scope when the insulation, surfaces, or boundary conditions are too compromised to treat like a quick tidy-up.",
      cardPoints: [
        "Contamination and odor",
        "Damaged insulation",
        "Sanitation and sealing access",
        "Rebuild logic after the cleanup"
      ]
    },
    sections: [
      {
        eyebrow: "When cleanup is still a smaller conversation",
        heading: "The kinds of attic situations that may stay closer to basic cleanup.",
        layout: "tiles",
        items: [
          {
            title: "The insulation is still worth keeping",
            text: "If the attic material is still clean and healthy overall, the scope may stay smaller than a full reset."
          },
          {
            title: "The issue is localized and not deeply embedded",
            text: "Some attic messes are limited enough that they do not force a full removal or restoration strategy."
          },
          {
            title: "The attic does not need deeper access",
            text: "If the attic floor and key areas are already accessible and trustworthy, cleanup may remain a more contained conversation."
          }
        ]
      },
      {
        eyebrow: "When restoration becomes the honest answer",
        heading: "The attic conditions that usually mean the project has moved beyond a simple cleanup.",
        layout: "panels",
        items: [
          {
            title: "The insulation is dirty, contaminated, or broken down",
            text: "When the base layer itself is the problem, the attic usually needs removal and a cleaner rebuild path."
          },
          {
            title: "Sanitation and boundary work need access",
            text: "If the better attic plan requires getting down to the floor for sanitation or sealing, the project is already leaning toward restoration."
          },
          {
            title: "The homeowner wants the attic to feel healthy again",
            text: "That finish line usually requires more than a lighter cleanup if the attic has been tolerated in poor condition for a long time."
          }
        ]
      },
      {
        eyebrow: "What restoration usually includes",
        heading: "How a bigger attic cleanup project often gets sequenced once the attic tells the truth.",
        layout: "tiles",
        items: [
          {
            title: "Remove what is no longer worth building on",
            text: "Compromised insulation and debris often have to come out before the attic can move into healthier territory."
          },
          {
            title: "Handle sanitation and boundary prep",
            text: "The attic may need cleaning, targeted correction, and sealing access before the final install belongs."
          },
          {
            title: "Rebuild the attic with a clearer endpoint",
            text: "The strongest finish line is an attic that feels restored, not one that merely looks a little less neglected."
          }
        ]
      },
      {
        eyebrow: "Best next pages",
        heading: "The service pages that usually help once cleanup clearly turns into restoration.",
        layout: "features",
        withImages: true,
        items: [
          {
            url: "/services/insulation-removal/",
            title: "Insulation Removal Services",
            kicker: "Reset the attic",
            text: serviceBySlug("insulation-removal").summary,
            image: serviceBySlug("insulation-removal").image,
            alt: "Insulation removal services",
            cta: "View removal path"
          },
          {
            url: "/services/attic-pest-remediation/",
            title: "Attic Pest Remediation Services",
            kicker: "Cleanup and restoration",
            text: serviceBySlug("attic-pest-remediation").summary,
            image: serviceBySlug("attic-pest-remediation").image,
            alt: "Attic pest remediation services",
            cta: "View remediation path"
          },
          {
            url: "/resources/signs-of-attic-pest-contamination/",
            title: "Signs of Attic Pest Contamination",
            kicker: "Related guide",
            text: "Use this guide when the cleanup conversation is expanding because the attic has visible damage, odor, or contamination after pests.",
            image: proofAssets.pestDamage,
            alt: "Signs of attic pest contamination guide",
            cta: "Read contamination guide"
          }
        ]
      },
      {
        eyebrow: "Local service paths",
        heading: "When the attic clearly needs a reset, start with the closest local removal page.",
        subcopy:
          "That is usually the fastest way to move from cleanup language into a real attic restoration scope in local context.",
        layout: "features",
        withImages: true,
        items: buildLocalizedResourceCards("insulation-removal", "Local restoration path", "Open local service")
      }
    ],
    cta: {
      title: "Need help figuring out whether the attic needs a cleanup or a full reset?",
      text: "The documented attic assessment is what separates a smaller cleanup conversation from a true restoration plan that should not be minimized.",
      primary: { label: "Request an Attic Assessment", url: "/contact/", kicker: "Next step" }
    }
  }),
  buildResourcePage({
    slug: "what-happens-during-an-attic-inspection",
    url: "/resources/what-happens-during-an-attic-inspection/",
    market: null,
    primary_keyword: "attic inspection what to expect",
    secondary_keywords: [
      "what happens during attic inspection",
      "attic estimate process",
      "attic assessment what is checked"
    ],
    seo_title: "What Happens During an Attic Inspection | What Homeowners Should Expect",
    meta_description:
      "Learn what Good Attic should document during an attic inspection, what homeowners usually learn from the visit, and how the assessment turns symptoms into a clearer project scope.",
    h1: "What Happens During an Attic Inspection",
    intro:
      "A good attic inspection should feel like clarity, not pressure. Homeowners should come away understanding what the attic looks like today, which problems matter most, and whether the next step is insulation, removal, sealing, cleanup, ventilation support, or a fuller attic restoration plan.",
    page_purpose: "Authority article for attic inspection intent",
    cta_primary: "Request an attic assessment",
    breadcrumb_items: [
      { label: "Home", url: "/" },
      { label: "Resources", url: "/resources/" },
      { label: "What Happens During an Attic Inspection", url: "/resources/what-happens-during-an-attic-inspection/" }
    ],
    canonical_url: `${site.baseUrl}/resources/what-happens-during-an-attic-inspection/`,
    related_links: [
      { label: "Contact Good Attic", url: "/contact/" },
      { label: "About Good Attic", url: "/about/" },
      { label: "Attic Resources", url: "/resources/" }
    ],
    faq_items: [
      {
        question: "What should an attic inspection help the homeowner understand?",
        answer:
          "It should clarify the attic condition, which problems are actually driving the symptoms, and what the right next step looks like without forcing the homeowner to guess between services."
      },
      {
        question: "Does the inspection only look at insulation depth?",
        answer:
          "No. The better inspection also considers contamination, coverage quality, leakage clues, cleanup needs, and whether the attic is ready for the recommended work."
      },
      {
        question: "Why does the inspection matter so much before a quote?",
        answer:
          "Because the attic condition is what determines whether the honest scope is a simple upgrade, a coordinated correction, or a much bigger restoration plan."
      }
    ],
    trust_elements: [
      "Turns the lead step into a clearer service expectation",
      "Reinforces photo-based documentation standards",
      "Routes the homeowner into the right market and service path after the visit"
    ],
    hero: {
      eyebrow: "Resources • Inspection expectations",
      cardKicker: "What clarity should feel like",
      cardTitle: "The attic inspection should explain the problem, not just rush toward a product recommendation.",
      cardText:
        "The homeowner should leave understanding what was documented, what is actually shaping the attic scope, and why the next step makes sense for that specific house.",
      cardPoints: [
        "Current attic condition",
        "Visible performance blockers",
        "Scope logic and sequence",
        "Which local path comes next"
      ]
    },
    sections: [
      {
        eyebrow: "What should get documented",
        heading: "The attic findings that matter most during a real assessment.",
        layout: "tiles",
        items: [
          {
            title: "Insulation condition and coverage",
            text: "The homeowner should learn whether the current insulation is thin, uneven, dirty, contaminated, or still worth keeping as part of the next step."
          },
          {
            title: "Access, boundary, and cleanup clues",
            text: "The inspection should reveal whether the attic needs sealing access, cleanup, sanitation, or other prep before a final insulation plan belongs."
          },
          {
            title: "What is actually driving the symptoms",
            text: "The point is to connect the attic evidence to the homeowner's comfort, odor, contamination, or energy concerns in plain language."
          }
        ]
      },
      {
        eyebrow: "What homeowners should learn from it",
        heading: "The inspection should narrow decisions instead of creating more confusion.",
        layout: "panels",
        items: [
          {
            title: "Whether the attic needs a smaller fix or a broader plan",
            text: "The homeowner should understand if the house is a clean top-off candidate or if the attic is really asking for something bigger."
          },
          {
            title: "Why the recommended sequence matters",
            text: "If cleanup, sealing, or removal belong before reinstall work, the assessment should make that order feel logical and necessary."
          },
          {
            title: "Which local service path makes the most sense next",
            text: "The result should be a clearer route into the correct market page, service page, or quote conversation for that home."
          }
        ]
      },
      {
        eyebrow: "What a better follow-up looks like",
        heading: "How the inspection should turn into a stronger homeowner experience after the visit.",
        layout: "tiles",
        items: [
          {
            title: "Share the attic story clearly",
            text: "The follow-up should help the homeowner revisit the findings and understand what changed in the recommendation once the attic was seen closely."
          },
          {
            title: "Keep the scope tied to the documented evidence",
            text: "The best quotes feel more trustworthy because the homeowner can see exactly what the scope is responding to."
          },
          {
            title: "Route the homeowner to the right next page",
            text: "Local service pages, market pages, and financing support should all reinforce the inspection instead of distracting from it."
          }
        ]
      },
      {
        eyebrow: "Best next pages",
        heading: "The pages that usually support homeowners best once they understand how the assessment works.",
        layout: "features",
        withImages: true,
        items: [
          {
            url: "/contact/",
            title: "Contact Good Attic",
            kicker: "Book the assessment",
            text: "Use the lead form, call, or text path to start the attic conversation when the homeowner is ready for a documented next step.",
            image: proofAssets.sales,
            alt: "Contact Good Attic to request attic assessment",
            cta: "Start a request"
          },
          {
            url: "/about/",
            title: "About Good Attic",
            kicker: "How the team thinks",
            text: "This page explains the company standard behind documentation, premium execution, and why the brand treats the attic as a system.",
            image: proofAssets.insulation,
            alt: "About Good Attic",
            cta: "View company page"
          },
          {
            url: "/reviews/",
            title: "Reviews & Proof",
            kicker: "Trust path",
            text: "The proof library and review path are where real approved homeowner feedback and documented attic evidence will reinforce the inspection story.",
            image: proofAssets.grossAttic,
            alt: "Good Attic reviews and proof",
            cta: "View proof page"
          }
        ]
      },
      {
        eyebrow: "Choose the right market",
        heading: "When the homeowner is ready to act, move into the nearest real market hub.",
        subcopy:
          "That keeps the post-inspection path clean by connecting the homeowner to the local service pages and phone routing that match the home.",
        layout: "features",
        withImages: true,
        items: buildMarketRouteCards("Assessment path", "Open market hub", (market) =>
          `Use the ${market.shortName} market hub to move from the inspection conversation into the local service pages and ${marketPhones[market.slug].phoneDisplay} contact path for that metro.`
        )
      }
    ],
    cta: {
      title: "Need a documented attic assessment instead of another guess?",
      text: "The strongest next step is to let the attic show what it needs, then build the recommendation around that evidence.",
      primary: { label: "Request an Attic Assessment", url: "/contact/", kicker: "Next step" }
    }
  })
];

function buildAllPages() {
  const coreServicePages = serviceCatalog.map((service) => buildCoreServicePage(service));
  const marketPages = marketCatalog.map((market) => buildMarketPage(market));
  const servicePages = marketCatalog.flatMap((market) => serviceCatalog.map((service) => buildServicePage(market, service)));
  const cityPages = marketCatalog.flatMap((market) => market.supportCities.map((city) => buildCityPage(market, city)));
  return [homeRecord, ...corePages, ...coreServicePages, ...marketPages, ...servicePages, ...cityPages, ...resourcePages];
}

function renderCorePage(page, currentUrl) {
  if (page.slug === "about") {
    return `
      ${renderHero(currentUrl, page, {
        eyebrow: "About Good Attic",
        cardKicker: "Why we exist",
        cardTitle: "Attic work should feel clear, clean, and confidence-building from the first conversation.",
        cardText:
          "Good Attic is built around homeowner trust as much as project quality. The point is to solve the attic problem and make the path there feel measured and honest.",
        cardPoints: page.trust_elements
      })}

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">What the brand is built around</p>
          <h2>Why attic specialization matters.</h2>
        </div>
        ${renderAudiencePanels([
          {
            title: "Whole-attic thinking",
            text: "Comfort, air quality, cleanup, and energy performance are all connected above the ceiling."
          },
          {
            title: "Clear homeowner guidance",
            text: "Photo-based findings and plain-language scopes make it easier to understand what the attic actually needs."
          },
          {
            title: "Done right standards",
            text: "Premium execution means better materials, cleaner work, and a calmer experience for the homeowner."
          }
        ])}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">How we work</p>
          <h2>The Good Attic approach stays simple on purpose.</h2>
        </div>
        ${renderFeatureGrid(
          [
            {
              url: "/services/",
              title: "Assess the attic honestly",
              kicker: "Step 1",
              text: "Find the actual issue instead of selling a one-size-fits-all solution.",
              image: "assets/good-attic-insulation-sales-appointment.png",
              cta: "Explore services"
            },
            {
              url: "/reviews/",
              title: "Communicate clearly",
              kicker: "Step 2",
              text: "Use homeowner-friendly language, visible documentation, and cleaner next steps.",
              image: "assets/gross-attic.png",
              cta: "View trust page"
            },
            {
              url: "/contact/",
              title: "Finish with confidence",
              kicker: "Step 3",
              text: "Deliver work that feels respectful, photo-ready, and done right the first time.",
              image: "assets/attic-insulation.png",
              cta: "Start a request"
            }
          ],
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">What gets documented</p>
          <h2>The brand earns trust by making the attic visible and the next step easier to understand.</h2>
          <p class="section-subcopy">${escapeHtml(
            "Good Attic should keep showing homeowners what was found, why the scope makes sense, and what a better finished attic looks like."
          )}</p>
        </div>
        ${renderEvidenceGrid(
          [
            {
              kicker: "Inspection standard",
              title: "Visible attic findings",
              text: "Documentation should show whether the attic is simply under-insulated, contaminated, open at the boundary, or dealing with multiple issues at once.",
              image: proofAssets.grossDusty,
              alt: "Visible attic findings and documentation standard",
              caption: "Show the problem before asking the homeowner to trust the scope."
            },
            {
              kicker: "Inspection standard",
              title: "Proof of scope logic",
              text: "The team should be able to explain why the attic needs a top-off, a clean reset, or a larger restoration plan without hiding behind vague contractor language.",
              image: proofAssets.hotColdInsulation,
              alt: "Proof of attic scope logic",
              caption: "Make the recommendation feel earned instead of assumed."
            },
            {
              kicker: "Inspection standard",
              title: "A cleaner finish line",
              text: "Premium attic work should leave behind a clearer attic story, cleaner photos, and a result that looks intentional from start to finish.",
              image: proofAssets.insulation,
              alt: "Cleaner finished attic standard",
              caption: "The outcome should look as considered as the diagnosis."
            }
          ],
          currentUrl
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Real market coverage</p>
          <h2>Good Attic is building trust through real service areas, not fake office pages.</h2>
        </div>
        ${renderFeatureGrid(
          buildMarketRouteCards("Market route", "Open market hub", (market) =>
            `Use the ${market.shortName} market hub to see the local service pages, city support pages, and the ${marketPhones[market.slug].phoneDisplay} contact path tied to that real service area.`
          ),
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Standards that keep this credible</p>
          <h2>How the company story stays aligned with real operations.</h2>
        </div>
        ${renderAudiencePanels([
          {
            title: "Real service-area architecture",
            text: "The site routes homeowners into real markets and support cities without pretending there are separate branch offices where none exist."
          },
          {
            title: "Real review and proof policy",
            text: "Approved homeowner excerpts, documented attic findings, and real photos matter more than inflated claims or generic trust badges."
          },
          {
            title: "Real attic-first recommendations",
            text: "The recommendation should follow the attic condition, even when that means the right answer is broader or different than the homeowner expected at first."
          }
        ])}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">FAQ</p>
          <h2>Questions about the company and approach.</h2>
        </div>
        ${renderFaq(page.faq_items)}
      </section>

      ${renderCtaStrip(currentUrl, "Want to start with a cleaner attic plan?", "The next step is simple: send the attic details directly and we will route the request to the right team.", {
        label: "Contact Good Attic",
        url: "/contact/",
        kicker: "Conversion"
      })}
    `;
  }

  if (page.slug === "services") {
    return `
      ${renderHero(currentUrl, page, {
        eyebrow: "Premium attic services",
        heroClass: "page-hero--services",
        cardKicker: "Five core services",
        cardTitle: "One attic system. Five ways to make the home feel better.",
        cardText:
          "Start here when you know the attic needs help but are not sure which service fits. Good Attic keeps the plan connected so insulation, cleanup, sealing, pests, and ventilation do not get treated like separate guesses.",
        cardPoints: ["Insulation", "Removal", "Pest remediation", "Air sealing", "Attic fans"],
        actions: [
          { label: "Book an Attic Inspection", modal: true }
        ]
      })}

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Core service lines</p>
          <h2>Choose the service that matches the attic problem.</h2>
          <p class="section-subcopy">${escapeHtml(
            "Every attic is a little different, but most projects come back to one of these five service paths. If you are not sure which one fits, start with an inspection and we will help sort it out."
          )}</p>
        </div>
        ${renderFeatureGrid(
          serviceCatalog.map((service) => ({
            url: `/services/${service.slug}/`,
            title: service.name,
            text: service.summary,
            image: service.image,
            alt: service.name,
            cta: "Learn More"
          })),
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">How the scope gets chosen</p>
          <h2>Good Attic should keep routing homeowners by attic condition, not by whichever service sounds easiest to sell.</h2>
        </div>
        ${renderTileGrid([
          {
            title: "Start with the attic as it exists today",
            text: "The first question is whether the attic is clean, accessible, and ready for direct improvement or whether it needs a fuller reset first."
          },
          {
            title: "Separate the symptom from the actual fix",
            text: "Hot upstairs rooms, dirty insulation, air leakage, odor, and pest aftermath can all overlap, which is why the scope has to be documented before it is simplified."
          },
          {
            title: "Route into the strongest next page",
            text: "Each service page should move homeowners into the right local market page, related service page, or inspection request instead of leaving them in a dead end."
          }
        ])}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Decision guides</p>
          <h2>Use these attic resources when the question is bigger than one service page.</h2>
          <p class="section-subcopy">${escapeHtml(
            "These guides are built to help homeowners think through cost, cleanup, sealing, insulation, and attic decision-making before they book."
          )}</p>
        </div>
        ${renderFeatureGrid(
          resourcePages.filter((resource) => !resource.market).map((resource) => ({
            url: resource.url,
            title: resource.h1,
            kicker: resource.market ? marketBySlug(resource.market)?.shortName || "Resource" : "Resource guide",
            text: resource.meta_description,
            image: resourceFeatureImage(resource),
            alt: resource.h1,
            cta: "Read guide"
          })),
          currentUrl,
          false
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Markets served</p>
          <h2>Pick the metro hub that matches the home.</h2>
        </div>
        ${renderFeatureGrid(
          marketCatalog.map((market) => ({
            url: `/${market.slug}/`,
            title: market.name,
            kicker: "Market hub",
            text: market.intro,
            image: "assets/good-attic-insulation-sales-appointment.png",
            alt: market.name,
            cta: "Explore market"
          })),
          currentUrl,
          false
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Market routing</p>
          <h2>After the service decision is clearer, move into the closest real metro hub.</h2>
        </div>
        ${renderFeatureGrid(
          buildMarketRouteCards("Local routing", "Open market hub", (market) =>
            `Use ${market.shortName} to move from the core service explanation into local service pages, city support pages, and the ${marketPhones[market.slug].phoneDisplay} contact path for that market.`
          ),
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">FAQ</p>
          <h2>Questions about the service hub.</h2>
        </div>
        ${renderFaq(page.faq_items)}
      </section>

      ${renderCtaStrip(currentUrl, "Need help choosing the right attic service?", "Send the attic details directly and Good Attic will help route the request into the right service path.", {
        label: "Book an Attic Inspection",
        url: "/contact/",
        kicker: "Next step"
      })}
    `;
  }

  if (page.slug === "resources") {
    const costResources = resourcePages.filter((resource) => resource.market);
    const evergreenResources = resourcePages.filter((resource) => !resource.market);

    return `
      ${renderHero(currentUrl, page, {
        eyebrow: "Attic resources",
        cardKicker: "Decision support",
        cardTitle: "Build authority by answering the attic questions homeowners actually search before they book.",
        cardText:
          "These guides are meant to help homeowners understand pricing drivers, cleanup decisions, and what usually belongs in a better attic plan before they request a quote.",
        cardPoints: page.trust_elements,
        actions: [{ label: "Request an Attic Estimate", url: "/contact/" }]
      })}

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Featured guides</p>
          <h2>The first attic decision pages Good Attic is building as an authority layer.</h2>
          <p class="section-subcopy">${escapeHtml(
            "The goal is to support the service pages with real decision-making content, not to create a disconnected blog."
          )}</p>
        </div>
        ${renderFeatureGrid(
          resourcePages.map((resource) => ({
            url: resource.url,
            title: resource.h1,
            kicker: resource.market ? marketBySlug(resource.market)?.shortName || "Resource" : "Resource guide",
            text: resource.intro,
            image: resourceFeatureImage(resource),
            alt: resource.h1,
            cta: "Open guide"
          })),
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">How to use the guides</p>
          <h2>The resource layer should narrow decisions, not keep homeowners reading in circles.</h2>
        </div>
        ${renderAudiencePanels([
          {
            title: "Use cost guides for price-shaping questions",
            text: "The market-specific insulation cost guides are meant to explain why attic pricing changes from one home to the next instead of pretending every quote should look the same."
          },
          {
            title: "Use evergreen guides for scope and fit questions",
            text: "These pages help homeowners decide whether the attic needs insulation, removal, air sealing, cleanup, ventilation support, or a broader inspection before any one service is chosen."
          },
          {
            title: "Use the next-step cards when the home is ready to act",
            text: "Each guide is built to push into the right market page, local service page, or attic assessment instead of trapping the user inside content."
          }
        ])}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Local cost research</p>
          <h2>Market-specific insulation cost guides tied to real service pages.</h2>
        </div>
        ${renderFeatureGrid(
          costResources.map((resource) => ({
            url: resource.url,
            title: resource.h1,
            kicker: "Cost guide",
            text: resource.meta_description,
            image: resourceFeatureImage(resource),
            alt: resource.h1,
            cta: "Compare cost drivers"
          })),
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Evergreen attic decisions</p>
          <h2>Guides for the attic questions that usually shape scope before pricing even starts.</h2>
        </div>
        ${renderFeatureGrid(
          evergreenResources.map((resource) => ({
            url: resource.url,
            title: resource.h1,
            kicker: "Decision guide",
            text: resource.meta_description,
            image: resourceFeatureImage(resource),
            alt: resource.h1,
            cta: "Read guide"
          })),
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Choose the right market</p>
          <h2>When a guide confirms the problem, the next move is the closest real metro hub.</h2>
          <p class="section-subcopy">${escapeHtml(
            "That keeps the site hierarchy clean and makes sure homeowners land on the local service pages and phone path that actually match their market."
          )}</p>
        </div>
        ${renderFeatureGrid(
          buildMarketRouteCards("Market handoff", "Open market hub", (market) =>
            `Use the ${market.shortName} hub to move from attic research into the local service pages, city pages, and ${marketPhones[market.slug].phoneDisplay} contact path that match the home.`
          ),
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">FAQ</p>
          <h2>Questions about the attic resource hub.</h2>
        </div>
        ${renderFaq(page.faq_items)}
      </section>

      ${renderCtaStrip(currentUrl, "Need help turning the research into a real attic plan?", "Use the guides to get oriented, then start a request when the home is ready for a documented next step.", {
        label: "Request an Attic Estimate",
        url: "/contact/",
        kicker: "Next step"
      })}
    `;
  }

  if (page.slug === "locations") {
    return `
      ${renderHero(currentUrl, page, {
        eyebrow: "Locations Hub",
        cardKicker: "Service areas",
        cardTitle: "Three real markets. One Good Attic standard.",
        cardText:
          "Choose the market closest to the home to see the matching service pages and nearby city coverage.",
        cardPoints: page.trust_elements,
        actions: []
      })}

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Markets</p>
          <h2>Choose the market hub closest to the home.</h2>
        </div>
        ${renderFeatureGrid(
          marketCatalog.map((market) => ({
            url: `/${market.slug}/`,
            title: market.name,
            kicker: "Market hub",
            text: market.intro,
            image: "assets/good-attic-insulation-sales-appointment.png",
            alt: market.name,
            cta: "Open market hub"
          })),
          currentUrl,
          false
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Local contact paths</p>
          <h2>Each market should make it obvious where the homeowner goes next and which number belongs to that area.</h2>
        </div>
        ${renderFeatureGrid(
          buildMarketRouteCards("Call or text path", "Open market hub", (market) =>
            `Service pages and city support pages for ${market.shortName} route back through the ${marketPhones[market.slug].phoneDisplay} market contact path so the local buttons stay consistent.`
          ),
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Why the location architecture matters</p>
          <h2>The goal is local clarity without fake-location shortcuts.</h2>
        </div>
        ${renderAudiencePanels([
          {
            title: "Markets first",
            text: "The market hub is the main local authority page for each metro, which keeps internal linking cleaner and gives each area one central destination."
          },
          {
            title: "City pages support the market page",
            text: "Support-city pages should help with local relevance and homeowner orientation, then feed back upward into the correct market and market-service pages."
          },
          {
            title: "No fabricated office signals",
            text: "Good Attic can build strong local SEO without inventing addresses, branches, or office-level markup where those things do not actually exist."
          }
        ])}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">FAQ</p>
          <h2>Questions about markets and service areas.</h2>
        </div>
        ${renderFaq(page.faq_items)}
      </section>

      ${renderCtaStrip(currentUrl, "Need help finding the right local Good Attic page?", "Choose the nearest market hub first, then move into the service page or city page that best matches the home.", {
        label: "Choose your market",
        url: "/locations/",
        kicker: "Local routing"
      })}
    `;
  }

  if (page.slug === "reviews") {
    const reviewLibraryHasEntries = approvedReviewEntries({}).length > 0;
    return `
      ${renderHero(currentUrl, page, {
        eyebrow: "Reviews & Proof",
        cardKicker: "Trust signal",
        cardTitle: "Real homeowner proof belongs here as the review library grows.",
        cardText:
          "Good Attic only wants review content that comes from real homeowner feedback. Until more approved excerpts are added, this page keeps the trust message focused on the standards the brand is building around.",
        cardPoints: page.trust_elements
      })}

      <section class="section review-proof-section">
        <div class="review-widget review-widget--page reveal" aria-label="Google review preview">
          ${renderReviewWidgetHeader("Trusted by homeowners")}
          <div class="review-widget__shell">
            <p>Approved review excerpts or a synced review feed can live here as review sources are connected.</p>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Proof library</p>
          <h2>The kinds of visual proof this page is designed to hold as real approved assets are added.</h2>
          <p class="section-subcopy">${escapeHtml(
            "Good Attic should be able to show what the attic looked like, what changed, and why homeowners felt better about the scope afterward."
          )}</p>
        </div>
        ${renderEvidenceGrid(
          [
            {
              kicker: "Documented findings",
              title: "Dirty or compromised attic conditions",
              text: "This proof slot is designed for real attic photos that show why a top-off was not enough and why cleanup, removal, or a reset belonged in the scope.",
              image: proofAssets.dirtyReset,
              alt: "Dirty attic conditions proof slot",
              caption: "Use real approved photos that explain why the scope changed."
            },
            {
              kicker: "Documented findings",
              title: "Insulation depth and finish quality",
              text: "This slot is for before-and-after images that show coverage, finish quality, and what a cleaner attic floor looked like after the right install.",
              image: proofAssets.hotColdInsulation,
              alt: "Attic insulation finish proof slot",
              caption: "Show the difference between thin coverage and a cleaner finished install."
            },
            {
              kicker: "Documented findings",
              title: "Air sealing, cleanup, and restoration details",
              text: "The strongest proof often lives in the details homeowners never see until they are documented clearly during the project.",
              image: proofAssets.airSealing,
              alt: "Air sealing and attic detail proof slot",
              caption: "Use real detail photos that make the hidden work easier to trust."
            }
          ],
          currentUrl
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Approved excerpt library</p>
          <h2>${escapeHtml(
            reviewLibraryHasEntries
              ? "Real approved homeowner excerpts already reinforcing the Good Attic proof library."
              : "The homeowner review themes this site is prepared to ingest once you approve real excerpts."
          )}</h2>
          <p class="section-subcopy">${escapeHtml(
            reviewLibraryHasEntries
              ? "These are real homeowner excerpts loaded from the shared proof data layer so they can reinforce the right market, service, and city paths without hardcoding them into individual pages."
              : "These are shells for real homeowner feedback, not fabricated quotes. Once approved excerpts exist, they can be dropped into the shared data layer and flow to the correct proof and market pages."
          )}</p>
        </div>
        ${renderProofQueueGrid(buildReviewExcerptCards({ limit: 12 }), currentUrl)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Incoming project evidence</p>
          <h2>The real attic documentation this proof system is designed to absorb next.</h2>
        </div>
        ${renderProofQueueGrid(buildDocumentedProofCards({}), currentUrl)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">What people value</p>
          <h2>The trust themes the brand keeps reinforcing.</h2>
        </div>
        ${renderAudiencePanels([
          {
            title: "Clear communication",
            text: "Homeowners want plain-language findings, visible photos, and a scope they can actually follow."
          },
          {
            title: "Clean work",
            text: "Attic projects feel better when containment, cleanup, and homeowner respect are obvious from the start."
          },
          {
            title: "Results that make sense",
            text: "The strongest proof is still a home that feels better and a project that feels finished the right way."
          }
        ])}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Where proof connects</p>
          <h2>The pages that should receive the strongest approved review excerpts and project evidence first.</h2>
          <p class="section-subcopy">${escapeHtml(
            "As real review excerpts and documented findings become available, these are the highest-value pages to support first."
          )}</p>
        </div>
        ${renderFeatureGrid(
          marketCatalog.map((market) => ({
            url: `/${market.slug}/`,
            title: `${market.name} market proof path`,
            kicker: "Market hub",
            text: `Use ${market.shortName} as the main place to connect approved review excerpts, inspection findings, and before-and-after attic proof for that metro.`,
            image: proofAssets.sales,
            alt: `${market.name} proof path`,
            cta: "Open market page"
          })),
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">What real proof should include</p>
          <h2>How this page stays credible as homeowner reviews and project evidence get added.</h2>
        </div>
        ${renderAudiencePanels([
          {
            title: "Approved homeowner excerpts only",
            text: "No fabricated reviews, no paraphrased testimonials presented as direct quotes, and no review content without clear approval."
          },
          {
            title: "Photos that explain the scope",
            text: "The best images show why the attic needed the work, what was documented during inspection, and what the attic looked like after the correction."
          },
          {
            title: "Clear link back to service and market pages",
            text: "Proof should reinforce the money pages and market pages, not float separately as disconnected brand content."
          }
        ])}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">FAQ</p>
          <h2>Questions about reviews and proof.</h2>
        </div>
        ${renderFaq(page.faq_items)}
      </section>

      ${renderCtaStrip(currentUrl, "Want to see what your own attic project could look like?", "Reach out for a documented scope and a cleaner path into the right attic plan.", {
        label: "Request an Attic Estimate",
        url: "/contact/",
        kicker: "Conversion"
      })}
    `;
  }

  if (page.slug === "financing") {
    return `
      ${renderHero(currentUrl, page, {
        eyebrow: "Financing Support",
        cardKicker: "How this page helps",
        cardTitle: "Financing conversations are easier when the attic scope is already clear.",
        cardText:
          "Because financing options can depend on the project and current program availability, this page keeps the conversation tied to a real attic scope first.",
        cardPoints: page.trust_elements
      })}

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">When financing helps</p>
          <h2>Projects that move from simple upgrade into full attic restoration often benefit most.</h2>
        </div>
        ${renderTileGrid([
          {
            title: "Removal plus rebuild",
            text: "Attics that need cleanup, sanitation, sealing, and new insulation can become a more meaningful scope quickly."
          },
          {
            title: "One coordinated project",
            text: "Financing is most useful when the right attic work belongs in one clean plan instead of being split apart."
          },
          {
            title: "Confidence to move forward",
            text: "Payment flexibility can help homeowners approve the right scope instead of a reduced version that leaves the attic unfinished."
          }
        ])}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">What usually expands the project</p>
          <h2>The attic scopes most likely to make financing worth discussing are usually the ones with documented complications.</h2>
        </div>
        ${renderAudiencePanels([
          {
            title: "Contaminated or pest-affected insulation",
            text: "Once the attic needs removal, sanitation, and reinstall work instead of a simple top-off, the project often becomes more meaningful financially."
          },
          {
            title: "Boundary corrections plus insulation",
            text: "When the attic needs sealing access and a stronger final insulation layer together, the scope can grow into a more complete comfort correction."
          },
          {
            title: "Whole-attic restoration logic",
            text: "The biggest attic jobs usually come from a cleaner diagnosis, not from upselling. Financing should support the honest scope, not create it."
          }
        ])}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Where to keep going</p>
          <h2>Use the market pages and contact page to tie financing questions back to a real attic plan.</h2>
        </div>
        ${renderFeatureGrid(
          [
            {
              url: "/contact/",
              title: "Contact Good Attic",
              kicker: "Best next step",
              text: "The clearest financing conversation starts once the attic conditions and likely scope are already in front of the team.",
              image: proofAssets.sales,
              alt: "Contact Good Attic about financing",
              cta: "Start a request"
            },
            ...buildMarketRouteCards("Market path", "Open market hub", (market) =>
              `Use ${market.shortName} when you want the local service pages and ${marketPhones[market.slug].phoneDisplay} market contact path before talking through financing.`
            )
          ],
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">FAQ</p>
          <h2>Questions about financing availability.</h2>
        </div>
        ${renderFaq(page.faq_items)}
      </section>

      ${renderCtaStrip(currentUrl, "Need to talk through the project and the payment path together?", "Use the contact page and mention financing so the conversation stays tied to the real attic scope.", {
        label: "Ask About Financing",
        url: "/contact/",
        kicker: "Conversion"
      })}
    `;
  }

  if (page.slug === "contact") {
    return `
      ${renderHero(currentUrl, page, {
        eyebrow: "Contact Good Attic",
        cardKicker: "Ways to start",
        cardTitle: "Use the form, call, or text. The goal is the same: make the next step clear.",
        cardText:
          "The contact page doubles as the main crawlable conversion route for the new architecture while preserving the homepage as the visual hub.",
        cardPoints: page.trust_elements,
        actions: [
          { label: "Call Good Attic", url: site.phoneHref },
          { label: "Text Good Attic", url: site.smsHref, secondary: true }
        ]
      })}

      <section class="section contact">
        <div class="contact-info reveal">
          <p class="eyebrow">Request an attic estimate</p>
          <h2>Tell us what is happening in the attic.</h2>
          <p>Choose the project type, share your contact details and project address, then tell us your preferred quote window and any notes for the team.</p>
          <p class="contact-note">Your request goes straight to the team so we can follow up with the right next step.</p>
        </div>

        ${renderLeadForm(currentUrl)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">What happens next</p>
          <h2>The contact experience should feel as clear as the attic recommendations.</h2>
        </div>
        ${renderTileGrid([
          {
            title: "The request gets routed by market and scope",
            text: "Good Attic uses the project type, address, and notes to route the homeowner into the right local contact path without forcing them to know the exact service first."
          },
          {
            title: "The attic symptoms help shape the follow-up",
            text: "Hot upstairs rooms, contamination, odor, air leakage, and comfort complaints all help the team understand what kind of attic conversation should happen next."
          },
          {
            title: "The goal is a documented next step",
            text: "The form is not meant to trap the homeowner in back-and-forth. It is meant to get them to the clearest attic assessment or next conversation quickly."
          }
        ])}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Local market routing</p>
          <h2>Use the closest market hub when you want the right local pages and number before submitting.</h2>
        </div>
        ${renderFeatureGrid(
          buildMarketRouteCards("Market contact path", "Open market hub", (market) =>
            `Use the ${market.shortName} market hub to preview the local service pages, city support pages, and ${marketPhones[market.slug].phoneDisplay} phone path tied to that market.`
          ),
          currentUrl,
          true
        )}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">FAQ</p>
          <h2>Questions about reaching out.</h2>
        </div>
        ${renderFaq(page.faq_items)}
      </section>
    `;
  }

  return "";
}

function renderPage(page) {
  const currentUrl = page.url;
  const stylesHref = assetHref(currentUrl, "styles.css");
  const scriptHref = assetHref(currentUrl, "script.js");
  const mainOpenTag = page.page_type === "market" ? '<main id="top">' : '<main class="page-main">';

  let bodyContent = "";

  if (page.page_type === "core") {
    bodyContent = renderCorePage(page, currentUrl);
  } else if (page.page_type === "market") {
    bodyContent = page.render(currentUrl);
  } else if (page.page_type === "core-service") {
    bodyContent = page.render(currentUrl);
  } else if (page.page_type === "service") {
    bodyContent = page.render(currentUrl);
  } else if (page.page_type === "support") {
    bodyContent = page.render(currentUrl);
  } else if (page.page_type === "resource") {
    bodyContent = renderResourcePage(page, currentUrl);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(page.meta_description)}">
  <link rel="canonical" href="${escapeHtml(page.canonical_url)}">
  <title>${escapeHtml(page.seo_title)}</title>
  ${renderMetaTags(page, currentUrl)}
  <link rel="stylesheet" href="${escapeHtml(stylesHref)}">
  ${renderSiteJsonLd(page)}
  ${renderServiceJsonLd(page)}
  ${renderArticleJsonLd(page)}
  ${renderFaqJsonLd(page)}
  ${page.url === "/" ? "" : renderBreadcrumbJsonLd(page)}
</head>
<body>
  ${renderHeader(currentUrl, page)}
  ${mainOpenTag}
    ${bodyContent}
    ${page.page_type === "resource" ? "" : renderRelatedLinksSection(page, currentUrl)}
  </main>
  ${renderFooter()}
  ${renderModal(currentUrl)}
  <script src="${escapeHtml(scriptHref)}" defer></script>
</body>
</html>`;
}

function renderSitemap(pages) {
  const urls = pages.map((page) => {
    const loc = page.url === "/" ? `${site.baseUrl}/` : `${site.baseUrl}${page.url}`;
    return `  <url>
    <loc>${escapeHtml(loc)}</loc>
  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

function renderRobots() {
  return `User-agent: *
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: GPTBot
Allow: /

Sitemap: ${site.baseUrl}/sitemap.xml
`;
}

async function main() {
  const pages = buildAllPages();
  const pagesToGenerate = pages.filter((page) => page.url !== "/");

  for (const page of pagesToGenerate) {
    const outPath = path.join(__dirname, pageFilePath(page.url));
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, renderPage(page));
  }

  await writeFile(path.join(__dirname, "seo-wave1-page-data.json"), JSON.stringify(pages, null, 2));
  await writeFile(path.join(__dirname, "sitemap.xml"), renderSitemap(pages));
  await writeFile(path.join(__dirname, "robots.txt"), renderRobots());
}

await main();
