import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const site = {
  name: "Good Attic",
  baseUrl: "https://goodattic.energy",
  phoneDisplay: "385-336-0062",
  phoneHref: "tel:+13853360062",
  smsHref: "sms:+13853360062",
  footerSummary: "Premium attic restoration, insulation, and home comfort solutions.",
  footerDisclaimer: "Service availability, recommendations, and pricing depend on inspection findings and local conditions."
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
      }
    ]
  }
];

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
  return {
    pathname: pathname || "/",
    hash: hash ? `#${hash}` : ""
  };
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

function renderSiteJsonLd() {
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${site.baseUrl}/#organization`,
        name: site.name,
        url: `${site.baseUrl}/`,
        logo: `${site.baseUrl}/assets/good-attic-logo.png`,
        telephone: site.phoneDisplay
      },
      {
        "@type": "WebSite",
        "@id": `${site.baseUrl}/#website`,
        name: site.name,
        url: `${site.baseUrl}/`,
        publisher: { "@id": `${site.baseUrl}/#organization` }
      }
    ]
  })}</script>`;
}

function navLink(currentUrl, target, label) {
  const pathname = splitTarget(target).pathname;
  const isActive =
    pathname !== "/" &&
    (currentUrl === pathname || (pathname.endsWith("/") && currentUrl.startsWith(pathname) && pathname !== "/"));

  return `<a href="${hrefFrom(currentUrl, target)}"${isActive ? ' class="is-active"' : ""}>${escapeHtml(label)}</a>`;
}

function renderHeader(currentUrl) {
  return `
    <header class="site-header" data-header>
      <a class="brand" href="${hrefFrom(currentUrl, "/")}" aria-label="Good Attic home">
        <span class="brand-mark" aria-hidden="true"></span>
        <span>Good Attic</span>
      </a>

      <div class="mobile-header-actions">
        <div class="phone-dropdown mobile-header-phone" data-phone-dropdown>
          <button class="nav-cta nav-cta--phone mobile-phone-button" type="button" aria-expanded="false" data-phone-dropdown-toggle>
            ${escapeHtml(site.phoneDisplay)}
          </button>
          <div class="phone-dropdown__menu">
            <a href="${site.phoneHref}">Call</a>
            <a href="${site.smsHref}">Text</a>
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
            ${escapeHtml(site.phoneDisplay)}
          </button>
          <div class="phone-dropdown__menu">
            <a href="${site.phoneHref}">Call</a>
            <a href="${site.smsHref}">Text</a>
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
              <span class="project-option__image"><img src="${escapeHtml(assetHref(currentUrl, option.image))}" alt=""></span>
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
            <label class="form-consent">
              <input type="checkbox" name="contact_consent" value="yes" required>
              <span>I agree that Good Attic may contact me about my request by phone, text, or email.</span>
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

      <label class="form-consent">
        <input type="checkbox" name="contact_consent" value="yes" required>
        <span>I agree that Good Attic may contact me about my request by phone, text, or email.</span>
      </label>

      <button class="button primary" type="submit">Request My Free Quote</button>
      <p class="form-status" data-form-status aria-live="polite"></p>
    </form>
  `;
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
                  ? `<span class="page-card-link__media"><img src="${assetHref(currentUrl, card.image)}" alt="${escapeHtml(
                      card.alt || card.title
                    )}"></span>`
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
  return {
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
    trust_elements: market.trustElements,
    render: (currentUrl) => `
      ${renderHero(currentUrl, buildMarketPage(market), {
        eyebrow: `${market.shortName} Market`,
        cardKicker: "Local attic help",
        cardTitle: `Start with the full Good Attic service path in ${market.shortName}.`,
        cardText:
          "Use this hub to understand the common attic problems in this metro, then move into the service or city page that matches the home.",
        cardPoints: market.trustElements
      })}

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Common attic problems</p>
          <h2>What homeowners in ${escapeHtml(market.shortName)} usually notice first.</h2>
          <p class="section-subcopy">${escapeHtml(
            "These are the attic symptoms that tend to start the conversation before homeowners know exactly which service they need."
          )}</p>
        </div>
        ${renderTileGrid(market.commonProblems)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Local services</p>
          <h2>The five core attic services available in ${escapeHtml(market.shortName)}.</h2>
          <p class="section-subcopy">${escapeHtml(
            "Each service page explains one specific attic solution for homeowners in this market."
          )}</p>
        </div>
        ${renderFeatureGrid(buildMarketLinks(currentUrl, market), currentUrl, true)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Service areas</p>
          <h2>Nearby cities served through the ${escapeHtml(market.shortName)} market.</h2>
          <p class="section-subcopy">${escapeHtml(
            "These nearby city pages help homeowners confirm coverage and find the right Good Attic service path."
          )}</p>
        </div>
        ${renderFeatureGrid(buildSupportCityLinks(currentUrl, market), currentUrl, false)}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Why this market</p>
          <h2>${escapeHtml(market.whyHeading)}</h2>
          <p class="section-subcopy">${escapeHtml(market.whyText)}</p>
        </div>
        ${renderAudiencePanels([
          {
            title: "Whole-attic thinking",
            text: "The best answer is often not one isolated product. It is the right combination of cleanup, sealing, insulation, and support upgrades."
          },
          {
            title: "Documented homeowner clarity",
            text: "Homeowners should be able to move from a broad attic problem into the right service page without losing context."
          },
          {
            title: "Premium execution",
            text: "Good Attic keeps the homeowner experience clear, polished, and consistent from the first click through the finished project."
          }
        ])}
      </section>

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">FAQ</p>
          <h2>Questions homeowners ask in ${escapeHtml(market.shortName)}.</h2>
        </div>
        ${renderFaq(market.faq)}
      </section>

      ${renderCtaStrip(currentUrl, `Ready to talk about your attic in ${market.shortName}?`, "Start with a documented attic assessment and a route into the right next step.", {
        label: "Request an Attic Estimate",
        url: "/contact/",
        kicker: "Conversion"
      })}
    `
  };
}

function buildServicePage(market, service) {
  const marketShort = market.shortName.toLowerCase();
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

  return {
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
    faq_items: service.faq,
    trust_elements: [
      `Focused ${service.name.toLowerCase()} scope`,
      `Connected back to the ${market.shortName} hub`,
      "Built to work with the rest of the attic system"
    ],
    render: (currentUrl) => `
      ${renderHero(currentUrl, buildServicePage(market, service), {
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
          <p class="eyebrow">When it fits</p>
          <h2>When ${escapeHtml(service.name.toLowerCase())} is the right next step in ${escapeHtml(market.shortName)}.</h2>
        </div>
        ${renderAudiencePanels(service.rightFit)}
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
          <p class="eyebrow">FAQ</p>
          <h2>Questions about ${escapeHtml(service.name.toLowerCase())} in ${escapeHtml(market.shortName)}.</h2>
        </div>
        ${renderFaq(service.faq)}
      </section>

      ${renderCtaStrip(
        currentUrl,
        `Need ${service.name.toLowerCase()} in ${market.shortName}?`,
        "Use the contact page for a full request or open the quote modal for a quick start. Financing stays linked here because larger attic scopes often need it.",
        { label: "Request an Attic Estimate", url: "/contact/", kicker: "Conversion" }
      )}
    `
  };
}

function buildCityPage(market, city) {
  return {
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
      ${renderHero(currentUrl, buildCityPage(market, city), {
        eyebrow: `Service Area • ${city.name}`,
        cardKicker: "Local service coverage",
        cardTitle: `${city.shortName} homeowners can start with the ${market.shortName} Good Attic team.`,
        cardText:
          "Good Attic uses this local page to confirm coverage, explain common attic issues nearby, and point homeowners toward the right service pages.",
        cardPoints: city.whyCall
      })}

      <section class="section">
        <div class="section-heading reveal">
          <p class="eyebrow">Common local issues</p>
          <h2>What homeowners in ${escapeHtml(city.shortName)} usually notice first.</h2>
        </div>
        ${renderTileGrid(city.commonProblems)}
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
}

function buildAllPages() {
  const coreServicePages = serviceCatalog.map((service) => buildCoreServicePage(service));
  const marketPages = marketCatalog.map((market) => buildMarketPage(market));
  const servicePages = marketCatalog.flatMap((market) => serviceCatalog.map((service) => buildServicePage(market, service)));
  const cityPages = marketCatalog.flatMap((market) => market.supportCities.map((city) => buildCityPage(market, city)));
  return [homeRecord, ...corePages, ...coreServicePages, ...marketPages, ...servicePages, ...cityPages];
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
    `;
  }

  if (page.slug === "reviews") {
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
          <div class="review-widget__header">
            <div class="google-mark" aria-hidden="true"><span>G</span></div>
            <div>
              <p class="panel-kicker">Google Reviews</p>
              <h2>Trusted by homeowners</h2>
            </div>
          </div>
          <div class="review-score">
            <strong>5.0</strong>
            <div>
              <div class="stars" aria-label="Five star rating">★★★★★</div>
              <p>Approved review excerpts or a synced review feed can live here as review sources are connected.</p>
            </div>
          </div>
        </div>
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
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(page.meta_description)}">
  <link rel="canonical" href="${escapeHtml(page.canonical_url)}">
  <title>${escapeHtml(page.seo_title)}</title>
  <link rel="stylesheet" href="${escapeHtml(stylesHref)}">
  ${renderSiteJsonLd()}
  ${page.url === "/" ? "" : renderBreadcrumbJsonLd(page)}
</head>
<body>
  ${renderHeader(currentUrl)}
  <main class="page-main">
    ${bodyContent}
  </main>
  ${renderFooter()}
  ${renderModal(currentUrl)}
  <script src="${escapeHtml(scriptHref)}"></script>
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
