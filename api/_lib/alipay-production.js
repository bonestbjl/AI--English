const crypto = require("node:crypto");
const fs = require("node:fs");
const AlipaySdk = require("alipay-sdk");

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const OUT_TRADE_NO_PATTERN = /^RSE\d{20,40}$/;
const CURRENCY = "CNY";
const PAYMENT_PROVIDER = "alipay";
const SUCCESS_TRADE_STATUSES = new Set(["TRADE_SUCCESS", "TRADE_FINISHED"]);

const PLAN_CATALOG = Object.freeze({
  monthly: Object.freeze({
    planId: "monthly",
    productCode: "real_scene_english_monthly",
    subject: "Real Scene English Monthly Pass",
    body: "Real Scene English 30-day monthly pass",
    amountCents: 1990,
    totalAmount: "19.90",
    durationDays: 30,
  }),
  lifetime: Object.freeze({
    planId: "lifetime",
    productCode: "real_scene_english_lifetime",
    subject: "Real Scene English Lifetime Access",
    body: "Real Scene English lifetime access",
    amountCents: 19900,
    totalAmount: "199.00",
    durationDays: null,
  }),
});

function sendJson(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).json(body);
}

function sendText(res, status, body) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.status(status).send(body);
}

function sanitizeDetail(value) {
  let detail = "";
  if (typeof value === "string") detail = value;
  else if (value && typeof value === "object") {
    detail = value.message || value.error || value.details || value.hint || JSON.stringify(value);
  }
  return String(detail)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/("?(?:apikey|authorization|token|key|sign)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[redacted]$3")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[redacted-key]")
    .replace(/(service_role[\w.-]*)/gi, "[redacted]")
    .slice(0, 500);
}

function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body);
    } catch (error) {
      return {};
    }
  }
  return req.body;
}

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") {
    return new URLSearchParams(Object.entries(req.body).map(([key, value]) => [key, value == null ? "" : String(value)])).toString();
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseFormBody(rawBody) {
  const result = {};
  for (const [key, value] of new URLSearchParams(rawBody).entries()) result[key] = value;
  return result;
}

function getHeader(req, name) {
  const headers = req.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

function getBearerToken(req) {
  const authorization = String(getHeader(req, "authorization") || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function getAuthSecret(env) {
  return String(env.AUTH_TOKEN_SECRET || env.SMS_CODE_SECRET || "").trim();
}

function verifyAuthToken(token, secret, now = new Date()) {
  const [payloadPart, signaturePart] = String(token || "").split(".");
  if (!payloadPart || !signaturePart || !secret) return null;
  const expectedSignature = crypto.createHmac("sha256", secret).update(payloadPart).digest("base64url");
  const left = Buffer.from(signaturePart);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    const phone = String(payload.phone || "").trim();
    const expiresAt = Number(payload.exp || 0);
    if (!PHONE_PATTERN.test(phone) || expiresAt <= Math.floor(now.getTime() / 1000)) return null;
    return { phone, expiresAt, issuedAt: Number(payload.iat || 0) };
  } catch (error) {
    return null;
  }
}

function authenticateRequest(req, env, now = new Date()) {
  return verifyAuthToken(getBearerToken(req), getAuthSecret(env), now);
}

function isAlipayEnabled(env) {
  return String(env.ALIPAY_ENABLED || "").trim().toLowerCase() === "true";
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function validateHttpsUrl(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    const configError = new Error("alipay_config_error");
    configError.field = field;
    throw configError;
  }
  if (url.protocol !== "https:") {
    const configError = new Error("alipay_config_error");
    configError.field = field;
    throw configError;
  }
  return url.toString();
}

function getAlipayConfig(env) {
  const required = [
    "ALIPAY_APP_ID",
    "ALIPAY_GATEWAY",
    "ALIPAY_PRIVATE_KEY_PATH",
    "ALIPAY_PUBLIC_KEY_PATH",
    "ALIPAY_NOTIFY_URL",
    "ALIPAY_RETURN_URL",
    "ALIPAY_QUIT_URL",
  ];
  const missing = required.filter((name) => !String(env[name] || "").trim());
  if (missing.length) {
    const error = new Error("alipay_config_error");
    error.missing = missing;
    throw error;
  }
  const gateway = validateHttpsUrl(normalizeUrl(env.ALIPAY_GATEWAY), "ALIPAY_GATEWAY");
  if (new URL(gateway).hostname !== "openapi.alipay.com") {
    const error = new Error("alipay_config_error");
    error.field = "ALIPAY_GATEWAY";
    throw error;
  }
  return {
    appId: String(env.ALIPAY_APP_ID).trim(),
    gateway,
    privateKeyPath: String(env.ALIPAY_PRIVATE_KEY_PATH).trim(),
    publicKeyPath: String(env.ALIPAY_PUBLIC_KEY_PATH).trim(),
    notifyUrl: validateHttpsUrl(normalizeUrl(env.ALIPAY_NOTIFY_URL), "ALIPAY_NOTIFY_URL"),
    returnUrl: validateHttpsUrl(normalizeUrl(env.ALIPAY_RETURN_URL), "ALIPAY_RETURN_URL"),
    quitUrl: validateHttpsUrl(normalizeUrl(env.ALIPAY_QUIT_URL), "ALIPAY_QUIT_URL"),
    sellerId: String(env.ALIPAY_SELLER_ID || "").trim(),
  };
}

function readKeyFile(path, readFileSync = fs.readFileSync) {
  try {
    const key = String(readFileSync(path, "utf8") || "").trim();
    if (!key) throw new Error("empty_key");
    return key;
  } catch (cause) {
    const error = new Error("alipay_key_unavailable");
    error.cause = cause;
    throw error;
  }
}

function createAlipaySdk(config, options = {}) {
  const readFileSync = options.readFileSync || fs.readFileSync;
  const AlipaySdkClass = options.AlipaySdkClass || AlipaySdk;
  const privateKey = readKeyFile(config.privateKeyPath, readFileSync);
  const alipayPublicKey = readKeyFile(config.publicKeyPath, readFileSync);
  return new AlipaySdkClass({
    appId: config.appId,
    privateKey,
    alipayPublicKey,
    gateway: config.gateway,
    signType: "RSA2",
    charset: "utf-8",
    keyType: "PKCS8",
  });
}

function createOutTradeNo(now = new Date(), randomBytes = crypto.randomBytes) {
  const timestamp = now.toISOString().replace(/\D/g, "").slice(0, 17);
  const random = BigInt(`0x${randomBytes(8).toString("hex")}`).toString(10).padStart(20, "0").slice(-20);
  return `RSE${timestamp}${random}`;
}

function createPaymentUrl(sdk, config, order, plan) {
  return sdk.pageExec("alipay.trade.wap.pay", {
    method: "GET",
    format: "JSON",
    notifyUrl: config.notifyUrl,
    returnUrl: config.returnUrl,
    bizContent: {
      out_trade_no: order.out_trade_no,
      total_amount: plan.totalAmount,
      subject: plan.subject,
      body: plan.body,
      product_code: "QUICK_WAP_WAY",
      quit_url: config.quitUrl,
    },
  });
}

function verifyNotifySignature(sdk, params) {
  try {
    return sdk.checkNotifySign(params, true) === true;
  } catch (error) {
    return false;
  }
}

function parseAmountToCents(value) {
  const match = String(value == null ? "" : value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = `${match[2] || ""}00`.slice(0, 2);
  const amount = Number(match[1]) * 100 + Number(cents);
  return Number.isSafeInteger(amount) ? amount : null;
}

async function readSupabaseJson(response) {
  const text = await response.text();
  if (!text) return null;
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

function getSupabaseConfig(env) {
  const supabaseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRoleKey) throw new Error("missing_supabase_env");
  return { supabaseUrl, serviceRoleKey };
}

function createDatabaseError(message, response, body) {
  const error = new Error(message);
  error.status = response.status;
  error.detail = sanitizeDetail(body);
  return error;
}

async function callSupabaseRpc({ fetchImpl, supabaseUrl, serviceRoleKey, functionName, payload }) {
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify(payload),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createDatabaseError(`${functionName}_failed`, response, body);
  return Array.isArray(body) ? body[0] || null : body;
}

async function fetchOrder({ fetchImpl, supabaseUrl, serviceRoleKey, outTradeNo, phone = "" }) {
  const filters = [
    `out_trade_no=eq.${encodeURIComponent(outTradeNo)}`,
    "select=out_trade_no,order_no,phone,plan_id,subject,amount_cents,currency,status,payment_provider,alipay_trade_no,provider_trade_no,created_at,paid_at,membership_granted_at",
    "limit=1",
  ];
  if (phone) filters.splice(1, 0, `phone=eq.${encodeURIComponent(phone)}`);
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/orders?${filters.join("&")}`, {
    method: "GET",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createDatabaseError("order_lookup_failed", response, body);
  return Array.isArray(body) ? body[0] || null : null;
}

async function markOrderFailed({ fetchImpl, supabaseUrl, serviceRoleKey, outTradeNo, reason }) {
  const response = await fetchImpl(`${supabaseUrl}/rest/v1/orders?out_trade_no=eq.${encodeURIComponent(outTradeNo)}&status=eq.pending`, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({
      status: "failed",
      notify_summary: { source: "create_order", reason: String(reason || "payment_request_failed").slice(0, 80) },
    }),
  });
  if (!response.ok) return false;
  return true;
}

module.exports = {
  CURRENCY,
  OUT_TRADE_NO_PATTERN,
  PAYMENT_PROVIDER,
  PHONE_PATTERN,
  PLAN_CATALOG,
  SUCCESS_TRADE_STATUSES,
  authenticateRequest,
  callSupabaseRpc,
  createAlipaySdk,
  createOutTradeNo,
  createPaymentUrl,
  fetchOrder,
  getAlipayConfig,
  getSupabaseConfig,
  isAlipayEnabled,
  markOrderFailed,
  parseAmountToCents,
  parseFormBody,
  readJsonBody,
  readRawBody,
  sanitizeDetail,
  sendJson,
  sendText,
  verifyNotifySignature,
};
