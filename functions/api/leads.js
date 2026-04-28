const ALLOWED_PROJECTS = new Set([
  "Attic Insulation",
  "Insulation Removal",
  "Attic Pest Issues",
  "Attic Air Sealing",
  "Attic Fans",
  "Other"
]);

const REQUIRED_FIELDS = [
  "first_name",
  "last_name",
  "phone",
  "email",
  "street_address",
  "city",
  "state",
  "zip",
  "contact_consent"
];

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function clean(value, maxLength = 500) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanLongText(value, maxLength = 2000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeProjectTypes(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map((item) => clean(item, 80)).filter((item) => ALLOWED_PROJECTS.has(item));
}

function validatePayload(payload) {
  const missing = REQUIRED_FIELDS.filter((field) => !clean(payload[field], 300));
  const projectTypes = normalizeProjectTypes(payload.project_type);

  if (projectTypes.length === 0) {
    missing.push("project_type");
  }

  return { missing, projectTypes };
}

async function handleLeadRequest({ request, env }) {
  let payload;

  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, message: "Invalid form payload." }, 400);
  }

  const { missing, projectTypes } = validatePayload(payload);
  if (missing.length > 0) {
    return jsonResponse(
      {
        ok: false,
        message: "Please complete all required fields.",
        missing
      },
      400
    );
  }

  if (!env.GHL_WEBHOOK_URL) {
    return jsonResponse(
      {
        ok: false,
        message: "The CRM endpoint is not configured yet."
      },
      503
    );
  }

  const lead = {
    first_name: clean(payload.first_name, 100),
    last_name: clean(payload.last_name, 100),
    name: `${clean(payload.first_name, 100)} ${clean(payload.last_name, 100)}`,
    phone: clean(payload.phone, 60),
    email: clean(payload.email, 180),
    street_address: clean(payload.street_address, 220),
    city: clean(payload.city, 120),
    state: clean(payload.state, 80),
    zip: clean(payload.zip, 40),
    postal_code: clean(payload.zip, 40),
    full_address: `${clean(payload.street_address, 220)}, ${clean(payload.city, 120)}, ${clean(payload.state, 80)} ${clean(payload.zip, 40)}`,
    address: {
      street: clean(payload.street_address, 220),
      city: clean(payload.city, 120),
      state: clean(payload.state, 80),
      postal_code: clean(payload.zip, 40)
    },
    project_type: projectTypes,
    project_type_label: projectTypes.join(", "),
    services_requested: projectTypes.join(", "),
    preferred_day: clean(payload.preferred_day, 60),
    preferred_date: clean(payload.preferred_day, 60),
    preferred_time: clean(payload.preferred_time, 80),
    additional_notes: cleanLongText(payload.additional_notes),
    notes: cleanLongText(payload.additional_notes),
    contact_consent: clean(payload.contact_consent, 20),
    lead_source: clean(payload.lead_source, 120) || "Good Attic website",
    form_name: clean(payload.form_name, 120),
    source_page: clean(payload.source_page, 500),
    submitted_at: new Date().toISOString()
  };

  try {
    const response = await fetch(env.GHL_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(lead)
    });

    if (!response.ok) {
      return jsonResponse(
        {
          ok: false,
          message: "The CRM endpoint did not accept the request."
        },
        502
      );
    }
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        message: "The CRM endpoint could not be reached."
      },
      502
    );
  }

  return jsonResponse({ ok: true });
}

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return jsonResponse({ ok: true });
  }

  if (context.request.method === "POST") {
    return handleLeadRequest(context);
  }

  return jsonResponse({ ok: false, message: "Method not allowed." }, 405);
}
