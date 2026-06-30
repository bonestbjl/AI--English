const PHONE_PATTERN = /^\d{6,20}$/;

function sendJson(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).json(body);
}

function normalizeUser(row, source = "supabase") {
  const premiumUntil = row?.premium_until || null;
  const hasActivePremium = premiumUntil && new Date(premiumUntil).getTime() > Date.now();
  const isDeveloper = row?.role === "developer" || row?.plan === "developer";
  const role = isDeveloper ? "developer" : hasActivePremium ? "premium" : "free";
  const plan = isDeveloper ? "developer" : hasActivePremium ? "premium" : "free";
  return {
    phone: String(row?.phone || ""),
    role,
    plan,
    premiumUntil,
    source,
  };
}

function readRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }
  return req.body;
}

function sanitizeDetail(value) {
  let detail = "";
  if (typeof value === "string") {
    detail = value;
  } else if (value && typeof value === "object") {
    detail = value.message || value.error || value.details || value.hint || JSON.stringify(value);
  }
  return String(detail)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/("?(?:apikey|authorization|token|key)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[redacted]$3")
    .replace(/(service_role[\\w.-]*)/gi, "[redacted]")
    .slice(0, 500);
}

async function readSupabaseJson(response) {
  const text = await response.text();
  if (!text) return { rawText: "" };
  try {
    return JSON.parse(text);
  } catch (error) {
    return { rawText: text };
  }
}

async function fetchExistingUser({ supabaseUrl, serviceRoleKey, phone }) {
  const endpoint = `${supabaseUrl}/rest/v1/users?phone=eq.${encodeURIComponent(phone)}&select=phone,role,plan,premium_until`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) {
    const error = new Error("supabase_query_failed");
    error.status = response.status;
    error.body = body;
    error.detail = sanitizeDetail(body);
    throw error;
  }
  return Array.isArray(body) ? body[0] || null : null;
}

async function createFreeUser({ supabaseUrl, serviceRoleKey, phone }) {
  const endpoint = `${supabaseUrl}/rest/v1/users`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ phone, role: "free", plan: "free" }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) {
    const error = new Error("supabase_create_failed");
    error.status = response.status;
    error.body = body;
    error.detail = sanitizeDetail(body);
    throw error;
  }
  return Array.isArray(body) ? body[0] || { phone, role: "free", plan: "free", premium_until: null } : body;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    sendJson(res, 500, { ok: false, error: "missing_supabase_env" });
    return;
  }

  const body = readRequestBody(req);
  const phone = String(body.phone || "").trim();
  if (!PHONE_PATTERN.test(phone)) {
    sendJson(res, 400, { ok: false, error: "invalid_phone" });
    return;
  }

  try {
    const requestContext = { supabaseUrl: supabaseUrl.replace(/\/+$/, ""), serviceRoleKey, phone };
    const existingUser = await fetchExistingUser(requestContext);
    if (existingUser) {
      sendJson(res, 200, { ok: true, user: normalizeUser(existingUser) });
      return;
    }

    const createdUser = await createFreeUser(requestContext);
    sendJson(res, 200, { ok: true, user: normalizeUser(createdUser) });
  } catch (error) {
    if (error.status === 409) {
      try {
        const existingUser = await fetchExistingUser({
          supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
          serviceRoleKey,
          phone,
        });
        if (existingUser) {
          sendJson(res, 200, { ok: true, user: normalizeUser(existingUser) });
          return;
        }
      } catch (retryError) {
        sendJson(res, 500, {
          ok: false,
          error: retryError.message || "supabase_retry_failed",
          status: retryError.status || 500,
          detail: sanitizeDetail(retryError.detail || retryError.body || retryError.message),
        });
        return;
      }
    }

    sendJson(res, 500, {
      ok: false,
      error: error.message || "supabase_request_failed",
      status: error.status || 500,
      detail: sanitizeDetail(error.detail || error.body || error.message),
    });
  }
};
