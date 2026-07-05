const crypto = require("crypto");

const PHONE_PATTERN = /^1[3-9]\d{9}$/;

function sendJson(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).json(body);
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
    .replace(/(service_role[\w.-]*)/gi, "[redacted]")
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

function supabaseHeaders(serviceRoleKey, prefer = "") {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

function getSmsMode() {
  return String(process.env.SMS_MODE || "mock").trim().toLowerCase();
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function getAuthSecret(serviceRoleKey) {
  const secret = String(process.env.AUTH_TOKEN_SECRET || process.env.SMS_CODE_SECRET || "").trim();
  if (secret) return secret;
  if (getSmsMode() === "mock" && !isProductionRuntime()) return "development_sms_code_secret";
  return String(serviceRoleKey || "").trim();
}

function verifyAuthToken(token, expectedPhone, secret) {
  const [payloadPart, signaturePart] = String(token || "").split(".");
  if (!payloadPart || !signaturePart || !secret) return false;
  const expectedSignature = crypto.createHmac("sha256", secret).update(payloadPart).digest("base64url");
  const left = Buffer.from(signaturePart);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    const phone = String(payload.phone || "").trim();
    const exp = Number(payload.exp || 0);
    return phone === expectedPhone && exp > Math.floor(Date.now() / 1000);
  } catch (error) {
    return false;
  }
}

function normalizeLearningData(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function fetchLearningRow({ supabaseUrl, serviceRoleKey, phone }) {
  const endpoint = `${supabaseUrl}/rest/v1/learning_data?phone=eq.${encodeURIComponent(phone)}&select=phone,data,updated_at&limit=1`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) {
    const error = new Error("learning_data_lookup_failed");
    error.status = response.status;
    error.detail = sanitizeDetail(body);
    throw error;
  }
  return Array.isArray(body) ? body[0] || null : null;
}

async function upsertLearningRow({ supabaseUrl, serviceRoleKey, phone, data }) {
  const now = new Date().toISOString();
  const endpoint = `${supabaseUrl}/rest/v1/learning_data?on_conflict=phone`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify({
      phone,
      data: normalizeLearningData(data),
      updated_at: now,
    }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) {
    const error = new Error("learning_data_save_failed");
    error.status = response.status;
    error.detail = sanitizeDetail(body);
    throw error;
  }
  const row = Array.isArray(body) ? body[0] || null : body;
  return row || { phone, data, updated_at: now };
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
  const action = String(body.action || "").trim();
  const phone = String(body.phone || "").trim();
  const authToken = String(body.authToken || "").trim();
  if (!PHONE_PATTERN.test(phone)) {
    sendJson(res, 400, { ok: false, error: "invalid_phone" });
    return;
  }

  const authSecret = getAuthSecret(serviceRoleKey);
  if (!verifyAuthToken(authToken, phone, authSecret)) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  const requestContext = {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
    serviceRoleKey,
    phone,
  };

  try {
    if (action === "load") {
      const row = await fetchLearningRow(requestContext);
      sendJson(res, 200, {
        ok: true,
        data: normalizeLearningData(row?.data),
        updatedAt: row?.updated_at || null,
        hasCloudData: Boolean(row),
      });
      return;
    }

    if (action === "save") {
      const saved = await upsertLearningRow({
        ...requestContext,
        data: normalizeLearningData(body.data),
      });
      sendJson(res, 200, {
        ok: true,
        data: normalizeLearningData(saved?.data),
        updatedAt: saved?.updated_at || null,
      });
      return;
    }

    sendJson(res, 400, { ok: false, error: "invalid_action" });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message || "learning_data_request_failed",
      status: error.status || 500,
      detail: sanitizeDetail(error.detail || error.message),
    });
  }
};
