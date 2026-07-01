const crypto = require("crypto");

const ORDER_NO_PATTERN = /^RSE\d{20,}$/;
const PHONE_PATTERN = /^\d{6,20}$/;
const ALIPAY_METHOD = "alipay.trade.query";
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

function readRequestInput(req) {
  const url = new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`);
  const query = Object.fromEntries(url.searchParams.entries());
  if (req.method === "GET") return query;
  return { ...query, ...readRequestBody(req) };
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
  const extendedSelect = `${baseSelect},paid_at,plan,product_name`;
  try {
    return await fetchOrderWithSelect(context, extendedSelect);
  } catch (error) {
    if (error.status !== 400) throw error;
    return fetchOrderWithSelect(context, `${baseSelect},paid_at`);
  }
}

async function fetchLatestPaidOrdersWithSelect({ supabaseUrl, serviceRoleKey, phone }, select) {
  const endpoint = `${supabaseUrl}/rest/v1/orders?phone=eq.${encodeURIComponent(phone)}&status=eq.paid&select=${select}&order=paid_at.desc.nullslast&limit=10`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("fetch_latest_paid_order_failed", response, body);
  return Array.isArray(body) ? body : [];
}

async function fetchLatestPaidOrders(context) {
  const baseSelect = "order_no,phone,status,amount_cents,currency,product_code,paid_at";
  const extendedSelect = `${baseSelect},plan,product_name`;
  try {
    return await fetchLatestPaidOrdersWithSelect(context, extendedSelect);
  } catch (error) {
    if (error.status !== 400) throw error;
    return fetchLatestPaidOrdersWithSelect(context, baseSelect);
  }
}

async function fetchLatestPaidOrder(context) {
  const orders = await fetchLatestPaidOrders(context);
  return orders.find((order) => getProductByOrder(order)?.plan === "lifetime") || orders[0] || null;
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

function isActivePremium(user) {
  return Boolean(user?.lifetime_access) || Boolean(user?.premium_until && new Date(user.premium_until).getTime() > Date.now());
}

function getEffectivePlan(user) {
  if (user?.lifetime_access) return "lifetime";
  if (user?.premium_until && new Date(user.premium_until).getTime() > Date.now()) return "monthly";
  return "free";
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
  console.log("alipay query lifetime activation", {
    phone,
    activationType: "lifetime",
  });
  const premiumUser = await updateUserLifetime({ supabaseUrl, serviceRoleKey, phone, activatedAt });
  if (premiumUser) return premiumUser;
  return createLifetimeUser({ supabaseUrl, serviceRoleKey, phone, activatedAt });
}

async function activateMonthlyUserIfNeeded({ supabaseUrl, serviceRoleKey, phone, activatedAt, existingUser }) {
  if (isActivePremium(existingUser)) return existingUser;
  const premiumUntil = calculatePremiumUntil(existingUser?.premium_until, new Date(activatedAt));
  console.log("alipay query monthly activation repair", {
    phone,
    activationType: "monthly",
  });
  const premiumUser = await updateUserMonthly({ supabaseUrl, serviceRoleKey, phone, activatedAt, premiumUntil });
  if (premiumUser) return premiumUser;
  return createMonthlyUser({ supabaseUrl, serviceRoleKey, phone, activatedAt, premiumUntil });
}

async function ensurePaidOrderAccess({ supabaseUrl, serviceRoleKey, order, activatedAt }) {
  const product = getProductByOrder(order);
  if (!product || Number(order.amount_cents) !== product.amountCents || order.currency !== CURRENCY) {
    return {
      ok: false,
      error: "order_amount_or_currency_mismatch",
      orderNo: order.order_no,
    };
  }

  const phone = order.phone;
  const existingUser = await fetchUser({ supabaseUrl, serviceRoleKey, phone });
  let premiumUntil = existingUser?.premium_until || null;
  let lifetimeAccess = Boolean(existingUser?.lifetime_access);

  console.log("alipay query paid order access repair", {
    orderNo: order.order_no,
    phone,
    amountCents: Number(order.amount_cents),
    plan: product.plan,
    activationType: product.plan,
  });

  if (product.plan === "lifetime") {
    if (!lifetimeAccess) {
      await activateLifetimeUser({ supabaseUrl, serviceRoleKey, phone, activatedAt });
      lifetimeAccess = true;
    }
    return {
      ok: true,
      paid: true,
      orderNo: order.order_no,
      phone,
      plan: "lifetime",
      isPremium: true,
      premiumUntil,
      premium_until: premiumUntil,
      lifetimeAccess: true,
      lifetime_access: true,
    };
  }

  let effectiveUser = existingUser;
  if (!isActivePremium(existingUser)) {
    effectiveUser = await activateMonthlyUserIfNeeded({ supabaseUrl, serviceRoleKey, phone, activatedAt, existingUser });
  }
  premiumUntil = effectiveUser?.premium_until || premiumUntil;
  return {
    ok: true,
    paid: true,
    orderNo: order.order_no,
    phone,
    plan: "monthly",
    isPremium: true,
    premiumUntil,
    premium_until: premiumUntil,
    lifetimeAccess: false,
    lifetime_access: false,
  };
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

function isExpectedAmount(totalAmount, product) {
  if (totalAmount == null || totalAmount === "") return true;
  return Number(totalAmount).toFixed(2) === product.totalAmount;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "POST, GET");
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const body = readRequestInput(req);
  const orderNo = String(body.orderNo || body.order_no || "").trim();
  const phone = String(body.phone || "").trim();
  const repairLatestPaid = String(body.repairLatestPaid || body.repair_latest_paid || "") === "1" || body.repairLatestPaid === true;

  if (repairLatestPaid && !phone) {
    sendJson(res, 400, { ok: false, error: "missing_phone" });
    return;
  }
  if (repairLatestPaid && !PHONE_PATTERN.test(phone)) {
    sendJson(res, 400, { ok: false, error: "invalid_phone" });
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
    if (repairLatestPaid) {
      const latestPaidOrder = await fetchLatestPaidOrder({
        supabaseUrl: requestContext.supabaseUrl,
        serviceRoleKey,
        phone,
      });
      if (!latestPaidOrder) {
        sendJson(res, 200, {
          ok: false,
          paid: false,
          error: "paid_order_not_found",
          message: "支付还在确认中，请稍后点击重新检查",
        });
        return;
      }
      const result = await ensurePaidOrderAccess({
        supabaseUrl: requestContext.supabaseUrl,
        serviceRoleKey,
        order: latestPaidOrder,
        activatedAt: new Date().toISOString(),
      });
      sendJson(res, 200, result);
      return;
    }

    if (!orderNo) {
      sendJson(res, 400, { ok: false, error: "missing_order_no" });
      return;
    }
    if (!ORDER_NO_PATTERN.test(orderNo)) {
      sendJson(res, 400, { ok: false, error: "invalid_order_no" });
      return;
    }

    const existingOrder = await fetchOrder(requestContext);
    if (!existingOrder) {
      sendJson(res, 404, { ok: false, error: "order_not_found" });
      return;
    }
    if (existingOrder.status === "paid") {
      const result = await ensurePaidOrderAccess({
        supabaseUrl: requestContext.supabaseUrl,
        serviceRoleKey,
        order: existingOrder,
        activatedAt: new Date().toISOString(),
      });
      sendJson(res, 200, { ...result, alreadyPaid: true });
      return;
    }
    if (existingOrder.status !== "pending") {
      sendJson(res, 200, { ok: true, paid: false, orderNo, orderStatus: existingOrder.status });
      return;
    }
    const product = getProductByOrder(existingOrder);
    if (!product || Number(existingOrder.amount_cents) !== product.amountCents || existingOrder.currency !== CURRENCY) {
      sendJson(res, 200, { ok: true, paid: false, orderNo, error: "order_amount_or_currency_mismatch" });
      return;
    }

    const alipayResult = await queryAlipayTrade({ gateway, appId, privateKey, orderNo });
    const tradeStatus = alipayResult.trade_status || "";
    if (!SUCCESS_TRADE_STATUSES.has(tradeStatus) || !isExpectedAmount(alipayResult.total_amount, product)) {
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
    const paidPhone = paidOrder?.phone || existingOrder.phone;
    const existingUser = await fetchUser({
      supabaseUrl: requestContext.supabaseUrl,
      serviceRoleKey,
      phone: paidPhone,
    });
    let premiumUntil = existingUser?.premium_until || null;
    let lifetimeAccess = Boolean(existingUser?.lifetime_access);
    let premiumUser = null;
    if (product.plan === "lifetime") {
      lifetimeAccess = true;
      premiumUser = await activateLifetimeUser({
        supabaseUrl: requestContext.supabaseUrl,
        serviceRoleKey,
        phone: paidPhone,
        activatedAt: paidAt,
      });
    } else {
      premiumUntil = calculatePremiumUntil(existingUser?.premium_until, new Date(paidAt));
      premiumUser = await updateUserMonthly({
        supabaseUrl: requestContext.supabaseUrl,
        serviceRoleKey,
        phone: paidPhone,
        activatedAt: paidAt,
        premiumUntil,
      });
      if (!premiumUser) {
        await createMonthlyUser({
          supabaseUrl: requestContext.supabaseUrl,
          serviceRoleKey,
          phone: paidPhone,
          activatedAt: paidAt,
          premiumUntil,
        });
      }
    }

    sendJson(res, 200, {
      ok: true,
      paid: true,
      orderNo,
      phone: paidPhone,
      plan: product.plan,
      premiumUntil,
      lifetimeAccess,
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
