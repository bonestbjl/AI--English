const crypto = require("crypto");

const ORDER_NO_PATTERN = /^RSE\d{20,}$/;
const ALIPAY_METHOD = "alipay.trade.query";
const SUCCESS_TRADE_STATUSES = new Set(["TRADE_SUCCESS", "TRADE_FINISHED"]);
const AMOUNT_CENTS = 1990;
const TOTAL_AMOUNT = "19.90";
const CURRENCY = "CNY";
const MEMBERSHIP_DAYS = 30;

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
    .replace(/("?(?:apikey|authorization|token|key|sign)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[redacted]$3")
    .replace(/(service_role[\\w.-]*)/gi, "[redacted]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[redacted-key]")
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

async function fetchOrder({ supabaseUrl, serviceRoleKey, orderNo }) {
  const endpoint = `${supabaseUrl}/rest/v1/orders?order_no=eq.${encodeURIComponent(orderNo)}&select=order_no,phone,status,amount_cents,currency,product_code`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("fetch_order_failed", response, body);
  return Array.isArray(body) ? body[0] || null : null;
}

async function updateOrderPaid({ supabaseUrl, serviceRoleKey, orderNo, paidAt, tradeNo }) {
  const endpoint = `${supabaseUrl}/rest/v1/orders?order_no=eq.${encodeURIComponent(orderNo)}`;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({
      status: "paid",
      paid_at: paidAt,
      payment_provider: "alipay_sandbox",
      provider_trade_no: tradeNo || "",
    }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("update_order_failed", response, body);
  return Array.isArray(body) ? body[0] || null : body;
}

async function fetchUser({ supabaseUrl, serviceRoleKey, phone }) {
  const endpoint = `${supabaseUrl}/rest/v1/users?phone=eq.${encodeURIComponent(phone)}&select=phone,role,plan,premium_until`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("fetch_user_failed", response, body);
  return Array.isArray(body) ? body[0] || null : null;
}

function calculatePremiumUntil(currentPremiumUntil, now = new Date()) {
  const currentMs = currentPremiumUntil ? new Date(currentPremiumUntil).getTime() : 0;
  const baseMs = Number.isFinite(currentMs) && currentMs > now.getTime() ? currentMs : now.getTime();
  return new Date(baseMs + MEMBERSHIP_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function updateUserPremium({ supabaseUrl, serviceRoleKey, phone, activatedAt, premiumUntil }) {
  const endpoint = `${supabaseUrl}/rest/v1/users?phone=eq.${encodeURIComponent(phone)}`;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({
      role: "premium",
      plan: "premium",
      premium_activated_at: activatedAt,
      premium_until: premiumUntil,
    }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("update_user_failed", response, body);
  return Array.isArray(body) ? body[0] || null : body;
}

async function createPremiumUser({ supabaseUrl, serviceRoleKey, phone, activatedAt, premiumUntil }) {
  const endpoint = `${supabaseUrl}/rest/v1/users`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({
      phone,
      role: "premium",
      plan: "premium",
      premium_activated_at: activatedAt,
      premium_until: premiumUntil,
    }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("create_user_failed", response, body);
  return Array.isArray(body) ? body[0] || null : body;
}

function formatAlipayTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function normalizePrivateKey(rawKey) {
  const key = String(rawKey || "").trim().replace(/\\n/g, "\n");
  if (!key) return "";
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key)) return key;
  const compact = key.replace(/\s+/g, "");
  const lines = compact.match(/.{1,64}/g) || [];
  return ["-----BEGIN PRIVATE KEY-----", ...lines, "-----END PRIVATE KEY-----"].join("\n");
}

function createSignContent(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function signAlipayParams(params, privateKey) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(createSignContent(params), "utf8");
  signer.end();
  return signer.sign(privateKey, "base64");
}

async function queryAlipayTrade({ gateway, appId, privateKey, orderNo }) {
  const params = {
    app_id: appId,
    method: ALIPAY_METHOD,
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(),
    version: "1.0",
    biz_content: JSON.stringify({ out_trade_no: orderNo }),
  };
  const sign = signAlipayParams(params, privateKey);
  const response = await fetch(gateway, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: new URLSearchParams({ ...params, sign }).toString(),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (error) {
    const queryError = new Error("alipay_query_parse_failed");
    queryError.status = response.status;
    queryError.detail = sanitizeDetail(text);
    throw queryError;
  }
  if (!response.ok) {
    const queryError = new Error("alipay_query_failed");
    queryError.status = response.status;
    queryError.detail = sanitizeDetail(body);
    throw queryError;
  }
  return body?.alipay_trade_query_response || {};
}

function isExpectedAmount(totalAmount) {
  if (totalAmount == null || totalAmount === "") return true;
  return Number(totalAmount).toFixed(2) === TOTAL_AMOUNT;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const body = readRequestBody(req);
  const orderNo = String(body.orderNo || "").trim();
  if (!orderNo) {
    sendJson(res, 400, { ok: false, error: "missing_order_no" });
    return;
  }
  if (!ORDER_NO_PATTERN.test(orderNo)) {
    sendJson(res, 400, { ok: false, error: "invalid_order_no" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appId = process.env.ALIPAY_APP_ID;
  const gateway = process.env.ALIPAY_GATEWAY;
  const privateKey = normalizePrivateKey(process.env.ALIPAY_APP_PRIVATE_KEY);
  if (!supabaseUrl || !serviceRoleKey) {
    sendJson(res, 500, { ok: false, error: "missing_supabase_env" });
    return;
  }
  if (!appId || !gateway || !privateKey) {
    sendJson(res, 500, { ok: false, error: "missing_alipay_env" });
    return;
  }

  const requestContext = { supabaseUrl: supabaseUrl.replace(/\/+$/, ""), serviceRoleKey, orderNo };

  try {
    const existingOrder = await fetchOrder(requestContext);
    if (!existingOrder) {
      sendJson(res, 404, { ok: false, error: "order_not_found" });
      return;
    }
    if (existingOrder.status === "paid") {
      const existingUser = await fetchUser({
        supabaseUrl: requestContext.supabaseUrl,
        serviceRoleKey,
        phone: existingOrder.phone,
      });
      const premiumUntil = existingUser?.premium_until || null;
      sendJson(res, 200, {
        ok: true,
        paid: Boolean(premiumUntil && new Date(premiumUntil).getTime() > Date.now()),
        alreadyPaid: true,
        orderNo,
        phone: existingOrder.phone,
        plan: premiumUntil && new Date(premiumUntil).getTime() > Date.now() ? "premium" : "free",
        premiumUntil,
      });
      return;
    }
    if (existingOrder.status !== "pending") {
      sendJson(res, 200, { ok: true, paid: false, orderNo, orderStatus: existingOrder.status });
      return;
    }
    if (Number(existingOrder.amount_cents) !== AMOUNT_CENTS || existingOrder.currency !== CURRENCY) {
      sendJson(res, 200, { ok: true, paid: false, orderNo, error: "order_amount_or_currency_mismatch" });
      return;
    }

    const alipayResult = await queryAlipayTrade({ gateway, appId, privateKey, orderNo });
    const tradeStatus = alipayResult.trade_status || "";
    if (!SUCCESS_TRADE_STATUSES.has(tradeStatus) || !isExpectedAmount(alipayResult.total_amount)) {
      sendJson(res, 200, {
        ok: true,
        paid: false,
        orderNo,
        tradeStatus: tradeStatus || alipayResult.sub_code || alipayResult.code || "UNKNOWN",
      });
      return;
    }

    const paidAt = new Date().toISOString();
    const paidOrder = await updateOrderPaid({
      ...requestContext,
      paidAt,
      tradeNo: String(alipayResult.trade_no || ""),
    });
    const phone = paidOrder?.phone || existingOrder.phone;
    const existingUser = await fetchUser({
      supabaseUrl: requestContext.supabaseUrl,
      serviceRoleKey,
      phone,
    });
    const premiumUntil = calculatePremiumUntil(existingUser?.premium_until, new Date(paidAt));
    const premiumUser = await updateUserPremium({
      supabaseUrl: requestContext.supabaseUrl,
      serviceRoleKey,
      phone,
      activatedAt: paidAt,
      premiumUntil,
    });
    if (!premiumUser) {
      await createPremiumUser({
        supabaseUrl: requestContext.supabaseUrl,
        serviceRoleKey,
        phone,
        activatedAt: paidAt,
        premiumUntil,
      });
    }

    sendJson(res, 200, {
      ok: true,
      paid: true,
      orderNo,
      phone,
      plan: "premium",
      premiumUntil,
      tradeStatus,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message || "alipay_query_order_failed",
      status: error.status || 500,
      detail: sanitizeDetail(error.detail || error.body || error.message),
    });
  }
};
