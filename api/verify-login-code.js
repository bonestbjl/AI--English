const crypto = require("crypto");

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const CODE_PATTERN = /^\d{6}$/;
const MAX_ATTEMPTS = 5;
const AUTH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

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

function getAuthSecret(smsSecret) {
  return String(process.env.AUTH_TOKEN_SECRET || smsSecret || "").trim();
}

function hashCode(phone, code, secret) {
  return crypto.createHash("sha256").update(`${phone}:${code}:${secret}`, "utf8").digest("hex");
}

function createAuthToken(phone, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    phone,
    iat: now,
    exp: now + AUTH_TOKEN_TTL_SECONDS,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
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
    premium_until: premiumUntil,
    lifetimeAccess: hasLifetimeAccess,
    lifetime_access: hasLifetimeAccess,
    source,
  };
}

async function fetchLatestOpenCode({ supabaseUrl, serviceRoleKey, phone }) {
  const endpoint = `${supabaseUrl}/rest/v1/sms_login_codes?phone=eq.${encodeURIComponent(phone)}&consumed_at=is.null&select=id,code_hash,expires_at,attempts,created_at&order=created_at.desc&limit=1`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("sms_code_lookup_failed", response, body);
  return Array.isArray(body) ? body[0] || null : null;
}

async function patchCode({ supabaseUrl, serviceRoleKey, id, patch }) {
  const endpoint = `${supabaseUrl}/rest/v1/sms_login_codes?id=eq.${encodeURIComponent(id)}`;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify(patch),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("sms_code_update_failed", response, body);
  return Array.isArray(body) ? body[0] || null : body;
}

async function fetchExistingUser({ supabaseUrl, serviceRoleKey, phone }) {
  const endpoint = `${supabaseUrl}/rest/v1/users?phone=eq.${encodeURIComponent(phone)}&select=phone,role,plan,premium_until,lifetime_access`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("supabase_query_failed", response, body);
  return Array.isArray(body) ? body[0] || null : null;
}

async function createFreeUser({ supabaseUrl, serviceRoleKey, phone }) {
  const endpoint = `${supabaseUrl}/rest/v1/users`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({ phone, role: "free", plan: "free" }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("supabase_create_failed", response, body);
  return Array.isArray(body) ? body[0] || { phone, role: "free", plan: "free", premium_until: null, lifetime_access: false } : body;
}

async function getOrCreateUser(context) {
  const existingUser = await fetchExistingUser(context);
  if (existingUser) return existingUser;
  try {
    return await createFreeUser(context);
  } catch (error) {
    if (error.status !== 409) throw error;
    const retryUser = await fetchExistingUser(context);
    if (retryUser) return retryUser;
    throw error;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const body = readRequestBody(req);
  const phone = String(body.phone || "").trim();
  const code = String(body.code || "").trim();
  if (!PHONE_PATTERN.test(phone)) {
    sendJson(res, 400, { ok: false, error: "invalid_phone" });
    return;
  }
  if (!CODE_PATTERN.test(code)) {
    sendJson(res, 400, { ok: false, error: "invalid_code" });
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
    const codeRow = await fetchLatestOpenCode(requestContext);
    if (!codeRow) {
      sendJson(res, 404, { ok: false, error: "code_not_found" });
      return;
    }

    const attempts = Number(codeRow.attempts || 0);
    if (attempts >= MAX_ATTEMPTS) {
      sendJson(res, 429, { ok: false, error: "too_many_attempts" });
      return;
    }

    if (!codeRow.expires_at || new Date(codeRow.expires_at).getTime() <= Date.now()) {
      await patchCode({
        ...requestContext,
        id: codeRow.id,
        patch: { consumed_at: new Date().toISOString() },
      });
      sendJson(res, 410, { ok: false, error: "code_expired" });
      return;
    }

    const expectedHash = hashCode(phone, code, secret);
    if (!safeEqualHex(expectedHash, String(codeRow.code_hash || ""))) {
      await patchCode({
        ...requestContext,
        id: codeRow.id,
        patch: { attempts: attempts + 1 },
      });
      sendJson(res, 400, { ok: false, error: attempts + 1 >= MAX_ATTEMPTS ? "too_many_attempts" : "invalid_code" });
      return;
    }

    await patchCode({
      ...requestContext,
      id: codeRow.id,
      patch: { consumed_at: new Date().toISOString() },
    });
    const user = normalizeUser(await getOrCreateUser(requestContext));
    const authToken = createAuthToken(phone, getAuthSecret(secret));
    sendJson(res, 200, {
      ok: true,
      phone: user.phone,
      role: user.role,
      plan: user.plan,
      isPremium: user.isPremium,
      premiumUntil: user.premiumUntil,
      premium_until: user.premium_until,
      lifetimeAccess: user.lifetimeAccess,
      lifetime_access: user.lifetime_access,
      authToken,
      source: user.source,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: "server_error",
      status: error.status || 500,
      detail: sanitizeDetail(error.detail || error.body || error.message),
    });
  }
};
