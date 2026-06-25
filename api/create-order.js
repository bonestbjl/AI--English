const PHONE_PATTERN = /^\d{6,20}$/;
const PRODUCT_CODE = "real_scene_english_full";
const AMOUNT_CENTS = 1990;
const CURRENCY = "CNY";

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

function createOrderNo() {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const random = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
  return `RSE${timestamp}${random}`;
}

function normalizeOrder(row, fallback) {
  return {
    orderNo: row?.order_no || fallback.orderNo,
    phone: row?.phone || fallback.phone,
    amountCents: row?.amount_cents ?? fallback.amountCents,
    currency: row?.currency || fallback.currency,
    productCode: row?.product_code || fallback.productCode,
    status: row?.status || fallback.status,
  };
}

async function readSupabaseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
}

async function createPendingOrder({ supabaseUrl, serviceRoleKey, order }) {
  const endpoint = `${supabaseUrl}/rest/v1/orders`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      order_no: order.orderNo,
      phone: order.phone,
      amount_cents: order.amountCents,
      currency: order.currency,
      product_code: order.productCode,
      status: order.status,
      payment_provider: "pending",
    }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) {
    const error = new Error("create_order_failed");
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return Array.isArray(body) ? body[0] || null : body;
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

  const order = {
    orderNo: createOrderNo(),
    phone,
    amountCents: AMOUNT_CENTS,
    currency: CURRENCY,
    productCode: PRODUCT_CODE,
    status: "pending",
  };

  try {
    const row = await createPendingOrder({
      supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
      serviceRoleKey,
      order,
    });
    sendJson(res, 200, { ok: true, order: normalizeOrder(row, order) });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: "create_order_failed" });
  }
};
