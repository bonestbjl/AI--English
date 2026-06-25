const crypto = require("crypto");

const ORDER_NO_PATTERN = /^RSE\d{10,40}$/;
const SUCCESS_TRADE_STATUSES = new Set(["TRADE_SUCCESS", "TRADE_FINISHED"]);
const AMOUNT_CENTS = 1990;
const TOTAL_AMOUNT = "19.90";
const CURRENCY = "CNY";

function sendText(res, status, text) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.status(status).send(text);
}

function sendJson(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).json(body);
}

function safeLog(message, detail) {
  if (detail) {
    console.error(message, sanitizeDetail(detail));
  } else {
    console.error(message);
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
    .replace(/("?(?:apikey|authorization|token|key|sign)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[redacted]$3")
    .replace(/(service_role[\\w.-]*)/gi, "[redacted]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[redacted-key]")
    .slice(0, 500);
}

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") {
    return new URLSearchParams(
      Object.entries(req.body).map(([key, value]) => [key, value == null ? "" : String(value)])
    ).toString();
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseFormBody(rawBody) {
  const params = new URLSearchParams(rawBody);
  const result = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

function normalizePublicKey(rawKey) {
  const key = String(rawKey || "").trim().replace(/\\n/g, "\n");
  if (!key) return "";
  if (/-----BEGIN [A-Z ]*PUBLIC KEY-----/.test(key)) return key;
  const compact = key.replace(/\s+/g, "");
  const lines = compact.match(/.{1,64}/g) || [];
  return ["-----BEGIN PUBLIC KEY-----", ...lines, "-----END PUBLIC KEY-----"].join("\n");
}

function createSignContent(params, options = {}) {
  const excluded = new Set(["sign"]);
  if (options.excludeSignType) excluded.add("sign_type");
  return Object.keys(params)
    .filter((key) => !excluded.has(key) && params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function verifyAlipaySignature(params, publicKey) {
  const sign = params.sign;
  if (!sign) return false;
  const candidates = [
    createSignContent(params, { excludeSignType: false }),
    createSignContent(params, { excludeSignType: true }),
  ];
  return candidates.some((content) => {
    try {
      const verifier = crypto.createVerify("RSA-SHA256");
      verifier.update(content, "utf8");
      verifier.end();
      return verifier.verify(publicKey, sign, "base64");
    } catch (error) {
      return false;
    }
  });
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

async function updateUserPremium({ supabaseUrl, serviceRoleKey, phone, activatedAt }) {
  const endpoint = `${supabaseUrl}/rest/v1/users?phone=eq.${encodeURIComponent(phone)}`;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({
      role: "premium",
      plan: "premium",
      premium_activated_at: activatedAt,
    }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("update_user_failed", response, body);
  return Array.isArray(body) ? body[0] || null : body;
}

async function createPremiumUser({ supabaseUrl, serviceRoleKey, phone, activatedAt }) {
  const endpoint = `${supabaseUrl}/rest/v1/users`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({
      phone,
      role: "premium",
      plan: "premium",
      premium_activated_at: activatedAt,
    }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("create_user_failed", response, body);
  return Array.isArray(body) ? body[0] || null : body;
}

function isExpectedAmount(totalAmount) {
  return Number(totalAmount).toFixed(2) === TOTAL_AMOUNT;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appId = process.env.ALIPAY_APP_ID;
  const publicKey = normalizePublicKey(process.env.ALIPAY_PUBLIC_KEY);
  if (!supabaseUrl || !serviceRoleKey || !appId || !publicKey) {
    safeLog("alipay notify missing env");
    sendText(res, 500, "failure");
    return;
  }

  let params = {};
  try {
    params = parseFormBody(await readRawBody(req));
  } catch (error) {
    safeLog("alipay notify body parse failed", error);
    sendText(res, 400, "failure");
    return;
  }

  if (!verifyAlipaySignature(params, publicKey)) {
    safeLog("alipay notify invalid sign");
    sendText(res, 400, "failure");
    return;
  }

  if (params.app_id !== appId) {
    safeLog("alipay notify invalid app_id");
    sendText(res, 400, "failure");
    return;
  }

  const outTradeNo = String(params.out_trade_no || "").trim();
  if (!ORDER_NO_PATTERN.test(outTradeNo)) {
    safeLog("alipay notify invalid out_trade_no");
    sendText(res, 400, "failure");
    return;
  }

  if (!isExpectedAmount(params.total_amount)) {
    safeLog("alipay notify invalid amount");
    sendText(res, 200, "success");
    return;
  }

  if (!SUCCESS_TRADE_STATUSES.has(params.trade_status)) {
    sendText(res, 200, "success");
    return;
  }

  const requestContext = {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
    serviceRoleKey,
    orderNo: outTradeNo,
  };

  try {
    const existingOrder = await fetchOrder(requestContext);
    if (!existingOrder) {
      safeLog("alipay notify order not found");
      sendText(res, 200, "success");
      return;
    }
    if (existingOrder.status === "paid") {
      sendText(res, 200, "success");
      return;
    }
    if (existingOrder.status !== "pending") {
      safeLog("alipay notify order not pending");
      sendText(res, 200, "success");
      return;
    }
    if (Number(existingOrder.amount_cents) !== AMOUNT_CENTS || existingOrder.currency !== CURRENCY) {
      safeLog("alipay notify order amount or currency mismatch");
      sendText(res, 200, "success");
      return;
    }

    const paidAt = new Date().toISOString();
    const paidOrder = await updateOrderPaid({
      ...requestContext,
      paidAt,
      tradeNo: String(params.trade_no || ""),
    });
    const phone = paidOrder?.phone || existingOrder.phone;
    const premiumUser = await updateUserPremium({
      supabaseUrl: requestContext.supabaseUrl,
      serviceRoleKey,
      phone,
      activatedAt: paidAt,
    });
    if (!premiumUser) {
      await createPremiumUser({
        supabaseUrl: requestContext.supabaseUrl,
        serviceRoleKey,
        phone,
        activatedAt: paidAt,
      });
    }

    sendText(res, 200, "success");
  } catch (error) {
    safeLog("alipay notify update failed", error);
    sendText(res, 500, "failure");
  }
};
