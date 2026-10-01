const crypto = require("node:crypto");
const PHONE_PATTERN = /^1[3-9]\d{9}$/;

function sendJson(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

function normalizeUser(row, source = "supabase") {
  const premiumUntil = row?.premium_until || null;
  const hasActivePremium = premiumUntil && new Date(premiumUntil).getTime() > Date.now();
  const hasLifetimeAccess = row?.lifetime_access === true;
  const isDeveloper = row?.role === "developer" || row?.plan === "developer";
  const role = isDeveloper ? "developer" : hasLifetimeAccess || hasActivePremium ? "premium" : "free";
  const plan = isDeveloper ? "developer" : hasLifetimeAccess ? "lifetime" : hasActivePremium ? "monthly" : "free";
  return {
    phone: String(row?.phone || ""),
    role,
    plan,
    isPremium: role === "premium" || role === "developer",
    premiumUntil,
    lifetimeAccess: hasLifetimeAccess,
    source,
  };
}

function authenticateUser(req) {
  const authorization = String(req.headers?.authorization || req.headers?.Authorization || "");
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const parts = token.split(".");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  let secret = String(process.env.AUTH_TOKEN_SECRET || process.env.SMS_CODE_SECRET || "").trim();
  // Match the existing login issuer's development-only mock secret.
  if (!secret && String(process.env.SMS_MODE || "mock").trim().toLowerCase() === "mock"
      && process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production") {
    secret = "development_sms_code_secret";
  }
  if (!secret) return null;
  const [payloadPart, signaturePart] = parts;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(payloadPart).digest("base64url"));
  const actual = Buffer.from(signaturePart);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    const phone = String(payload.phone || "").trim();
    const expiresAt = Number(payload.exp);
    if (!PHONE_PATTERN.test(phone) || !Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return { phone, expiresAt };
  } catch (error) {
    return null;
  }
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
  const endpoint = `${supabaseUrl}/rest/v1/users?phone=eq.${encodeURIComponent(phone)}&select=phone,role,plan,premium_until,lifetime_access`;
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const auth = authenticateUser(req);
  if (!auth) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    sendJson(res, 500, { ok: false, error: "missing_supabase_env" });
    return;
  }

  try {
    const requestContext = { supabaseUrl: supabaseUrl.replace(/\/+$/, ""), serviceRoleKey, phone: auth.phone };
    const existingUser = await fetchExistingUser(requestContext);
    if (existingUser) {
      sendJson(res, 200, { ok: true, user: normalizeUser(existingUser), authExpiresAt: auth.expiresAt });
      return;
    }

    sendJson(res, 404, { ok: false, error: "user_not_found" });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message || "supabase_request_failed",
      status: error.status || 500,
      detail: sanitizeDetail(error.detail || error.body || error.message),
    });
  }
};
