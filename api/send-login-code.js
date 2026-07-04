const crypto = require("crypto");

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const CODE_TTL_SECONDS = 5 * 60;
const SEND_COOLDOWN_SECONDS = 60;
const MOCK_CODE = "123456";

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

function supabaseHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

function createSupabaseError(message, response, body) {
  const error = new Error(message);
  error.status = response.status;
  error.body = body;
  error.detail = sanitizeDetail(body);
  return error;
}

function getSmsMode() {
  return String(process.env.SMS_MODE || "mock").trim().toLowerCase();
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function getSmsSecret() {
  const secret = String(process.env.SMS_CODE_SECRET || "").trim();
  if (secret) return secret;
  if (getSmsMode() === "mock" && !isProductionRuntime()) {
    return "development_sms_code_secret";
  }
  return "";
}

function hashCode(phone, code, secret) {
  return crypto.createHash("sha256").update(`${phone}:${code}:${secret}`, "utf8").digest("hex");
}

function createSixDigitCode() {
  if (getSmsMode() === "mock") return MOCK_CODE;
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function getClientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim()
    .slice(0, 80);
}

async function fetchLatestCode({ supabaseUrl, serviceRoleKey, phone }) {
  const endpoint = `${supabaseUrl}/rest/v1/sms_login_codes?phone=eq.${encodeURIComponent(phone)}&select=created_at&order=created_at.desc&limit=1`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("sms_code_lookup_failed", response, body);
  return Array.isArray(body) ? body[0] || null : null;
}

async function consumeOpenCodes({ supabaseUrl, serviceRoleKey, phone, consumedAt }) {
  const endpoint = `${supabaseUrl}/rest/v1/sms_login_codes?phone=eq.${encodeURIComponent(phone)}&consumed_at=is.null`;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({ consumed_at: consumedAt }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("sms_code_invalidate_failed", response, body);
  return body;
}

async function insertCode({ supabaseUrl, serviceRoleKey, row }) {
  const endpoint = `${supabaseUrl}/rest/v1/sms_login_codes`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify(row),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("sms_code_create_failed", response, body);
  return body;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const body = readRequestBody(req);
  const phone = String(body.phone || "").trim();
  if (!PHONE_PATTERN.test(phone)) {
    sendJson(res, 400, { ok: false, error: "invalid_phone" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    sendJson(res, 500, { ok: false, error: "missing_supabase_env" });
    return;
  }
  const secret = getSmsSecret();
  if (!secret) {
    sendJson(res, 500, { ok: false, error: "missing_sms_code_secret" });
    return;
  }

  const requestContext = { supabaseUrl: supabaseUrl.replace(/\/+$/, ""), serviceRoleKey, phone };
  try {
    const latest = await fetchLatestCode(requestContext);
    const latestMs = latest?.created_at ? new Date(latest.created_at).getTime() : 0;
    const now = new Date();
    if (Number.isFinite(latestMs) && now.getTime() - latestMs < SEND_COOLDOWN_SECONDS * 1000) {
      const retryAfter = Math.max(1, SEND_COOLDOWN_SECONDS - Math.floor((now.getTime() - latestMs) / 1000));
      sendJson(res, 429, { ok: false, error: "cooldown", retryAfter });
      return;
    }

    const code = createSixDigitCode();
    const createdAt = now.toISOString();
    await consumeOpenCodes({ ...requestContext, consumedAt: createdAt });
    await insertCode({
      ...requestContext,
      row: {
        phone,
        code_hash: hashCode(phone, code, secret),
        expires_at: new Date(now.getTime() + CODE_TTL_SECONDS * 1000).toISOString(),
        attempts: 0,
        send_ip: getClientIp(req),
        user_agent: String(req.headers["user-agent"] || "").slice(0, 500),
        created_at: createdAt,
      },
    });

    const responseBody = { ok: true, mock: getSmsMode() === "mock", message: "验证码已发送" };
    if (getSmsMode() === "mock") responseBody.devCode = code;
    sendJson(res, 200, responseBody);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: "server_error",
      status: error.status || 500,
      detail: sanitizeDetail(error.detail || error.body || error.message),
    });
  }
};
