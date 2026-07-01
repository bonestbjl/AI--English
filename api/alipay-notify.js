const crypto = require("crypto");

const ORDER_NO_PATTERN = /^RSE\d{10,40}$/;
const SUCCESS_TRADE_STATUSES = new Set(["TRADE_SUCCESS", "TRADE_FINISHED"]);
const CURRENCY = "CNY";
const MEMBERSHIP_DAYS = 30;
const PRODUCTS = {
  real_scene_english_monthly: {
    plan: "monthly",
    productCode: "real_scene_english_monthly",
    productName: "Real Scene English Monthly Pass",
    amountCents: 1990,
    totalAmount: "19.90",
  },
  real_scene_english_lifetime: {
    plan: "lifetime",
    productCode: "real_scene_english_lifetime",
    productName: "Real Scene English Lifetime Access",
    amountCents: 19900,
    totalAmount: "199.00",
  },
};
const MONTHLY_PRODUCT = PRODUCTS.real_scene_english_monthly;
const LIFETIME_PRODUCT = PRODUCTS.real_scene_english_lifetime;

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

async function fetchOrderWithSelect({ supabaseUrl, serviceRoleKey, orderNo }, select) {
  const endpoint = `${supabaseUrl}/rest/v1/orders?order_no=eq.${encodeURIComponent(orderNo)}&select=${select}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("fetch_order_failed", response, body);
  return Array.isArray(body) ? body[0] || null : null;
}

async function fetchOrder(context) {
  const baseSelect = "order_no,phone,status,amount_cents,currency,product_code";
  const extendedSelect = `${baseSelect},plan,product_name`;
  try {
    return await fetchOrderWithSelect(context, extendedSelect);
  } catch (error) {
    if (error.status !== 400) throw error;
    return fetchOrderWithSelect(context, baseSelect);
  }
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
  const endpoint = `${supabaseUrl}/rest/v1/users?phone=eq.${encodeURIComponent(phone)}&select=phone,role,plan,premium_until,lifetime_access`;
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

function getProductByOrder(order) {
  const plan = String(order?.plan || "").trim().toLowerCase();
  if (plan === "lifetime") return LIFETIME_PRODUCT;
  if (plan === "monthly") return MONTHLY_PRODUCT;

  const productCode = String(order?.product_code || "").trim();
  if (productCode === LIFETIME_PRODUCT.productCode) return LIFETIME_PRODUCT;
  if (productCode === MONTHLY_PRODUCT.productCode) return MONTHLY_PRODUCT;

  const productName = String(order?.product_name || "").trim().toLowerCase();
  if (productName.includes("lifetime")) return LIFETIME_PRODUCT;
  if (productName.includes("monthly")) return MONTHLY_PRODUCT;

  const amountCents = Number(order?.amount_cents);
  if (amountCents === LIFETIME_PRODUCT.amountCents) return LIFETIME_PRODUCT;
  if (amountCents === MONTHLY_PRODUCT.amountCents) return MONTHLY_PRODUCT;

  return null;
}

async function updateUserMonthly({ supabaseUrl, serviceRoleKey, phone, activatedAt, premiumUntil }) {
  const endpoint = `${supabaseUrl}/rest/v1/users?phone=eq.${encodeURIComponent(phone)}`;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({
      role: "premium",
      plan: "monthly",
      premium_activated_at: activatedAt,
      premium_until: premiumUntil,
    }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("update_user_failed", response, body);
  return Array.isArray(body) ? body[0] || null : body;
}

async function createMonthlyUser({ supabaseUrl, serviceRoleKey, phone, activatedAt, premiumUntil }) {
  const endpoint = `${supabaseUrl}/rest/v1/users`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({
      phone,
      role: "premium",
      plan: "monthly",
      premium_activated_at: activatedAt,
      premium_until: premiumUntil,
      lifetime_access: false,
    }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("create_user_failed", response, body);
  return Array.isArray(body) ? body[0] || null : body;
}

async function updateUserLifetime({ supabaseUrl, serviceRoleKey, phone, activatedAt }) {
  const endpoint = `${supabaseUrl}/rest/v1/users?phone=eq.${encodeURIComponent(phone)}`;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({
      role: "premium",
      plan: "lifetime",
      premium_activated_at: activatedAt,
      lifetime_access: true,
    }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("update_user_failed", response, body);
  return Array.isArray(body) ? body[0] || null : body;
}

async function createLifetimeUser({ supabaseUrl, serviceRoleKey, phone, activatedAt }) {
  const endpoint = `${supabaseUrl}/rest/v1/users`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({
      phone,
      role: "premium",
      plan: "lifetime",
      premium_activated_at: activatedAt,
      premium_until: null,
      lifetime_access: true,
    }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("create_user_failed", response, body);
  return Array.isArray(body) ? body[0] || null : body;
}

async function activateLifetimeUser({ supabaseUrl, serviceRoleKey, phone, activatedAt }) {
  safeLog("alipay notify lifetime activation", {
    phone,
    activationType: "lifetime",
  });
  const premiumUser = await updateUserLifetime({ supabaseUrl, serviceRoleKey, phone, activatedAt });
  if (premiumUser) return premiumUser;
  return createLifetimeUser({ supabaseUrl, serviceRoleKey, phone, activatedAt });
}

function isExpectedAmount(totalAmount, product) {
  return Number(totalAmount).toFixed(2) === product.totalAmount;
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
      const product = getProductByOrder(existingOrder);
      if (product?.plan === "lifetime" && Number(existingOrder.amount_cents) === product.amountCents && existingOrder.currency === CURRENCY) {
        const existingUser = await fetchUser({
          supabaseUrl: requestContext.supabaseUrl,
          serviceRoleKey,
          phone: existingOrder.phone,
        });
        if (!existingUser?.lifetime_access) {
          await activateLifetimeUser({
            supabaseUrl: requestContext.supabaseUrl,
            serviceRoleKey,
            phone: existingOrder.phone,
            activatedAt: new Date().toISOString(),
          });
        }
      }
      sendText(res, 200, "success");
      return;
    }
    if (existingOrder.status !== "pending") {
      safeLog("alipay notify order not pending");
      sendText(res, 200, "success");
      return;
    }
    const product = getProductByOrder(existingOrder);
    if (!product || Number(existingOrder.amount_cents) !== product.amountCents || existingOrder.currency !== CURRENCY) {
      safeLog("alipay notify order amount or currency mismatch");
      sendText(res, 200, "success");
      return;
    }
    if (!isExpectedAmount(params.total_amount, product)) {
      safeLog("alipay notify invalid amount");
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
    const existingUser = await fetchUser({
      supabaseUrl: requestContext.supabaseUrl,
      serviceRoleKey,
      phone,
    });
    let premiumUser = null;
    if (product.plan === "lifetime") {
      premiumUser = await activateLifetimeUser({
        supabaseUrl: requestContext.supabaseUrl,
        serviceRoleKey,
        phone,
        activatedAt: paidAt,
      });
    } else {
      const premiumUntil = calculatePremiumUntil(existingUser?.premium_until, new Date(paidAt));
      premiumUser = await updateUserMonthly({
        supabaseUrl: requestContext.supabaseUrl,
        serviceRoleKey,
        phone,
        activatedAt: paidAt,
        premiumUntil,
      });
      if (!premiumUser) {
        await createMonthlyUser({
          supabaseUrl: requestContext.supabaseUrl,
          serviceRoleKey,
          phone,
          activatedAt: paidAt,
          premiumUntil,
        });
      }
    }

    sendText(res, 200, "success");
  } catch (error) {
    safeLog("alipay notify update failed", error);
    sendText(res, 500, "failure");
  }
};
