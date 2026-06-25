const ORDER_NO_PATTERN = /^RSE\d{14}\d{6}$/;

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

async function fetchOrder({ supabaseUrl, serviceRoleKey, orderNo }) {
  const endpoint = `${supabaseUrl}/rest/v1/orders?order_no=eq.${encodeURIComponent(orderNo)}&select=order_no,phone,status,paid_at`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("fetch_order_failed", response, body);
  return Array.isArray(body) ? body[0] || null : null;
}

async function updateOrderPaid({ supabaseUrl, serviceRoleKey, orderNo, paidAt }) {
  const endpoint = `${supabaseUrl}/rest/v1/orders?order_no=eq.${encodeURIComponent(orderNo)}`;
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({
      status: "paid",
      paid_at: paidAt,
      payment_provider: "mock",
      provider_trade_no: `MOCK_${orderNo}`,
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
  if (!response.ok) throw createSupabaseError("update_user_failed", response, body);
  return Array.isArray(body) ? body[0] || null : body;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  if (process.env.ENABLE_MOCK_PAYMENT !== "true") {
    sendJson(res, 403, { ok: false, error: "mock_payment_disabled" });
    return;
  }

  const body = readRequestBody(req);
  const orderNo = String(body.orderNo || "").trim();
  if (!ORDER_NO_PATTERN.test(orderNo)) {
    sendJson(res, 400, { ok: false, error: "invalid_order_no" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    sendJson(res, 500, { ok: false, error: "missing_supabase_env" });
    return;
  }

  const requestContext = { supabaseUrl: supabaseUrl.replace(/\/+$/, ""), serviceRoleKey, orderNo };

  try {
    const existingOrder = await fetchOrder(requestContext);
    if (!existingOrder) {
      sendJson(res, 404, { ok: false, error: "order_not_found" });
      return;
    }
    if (existingOrder.status !== "pending") {
      sendJson(res, 409, { ok: false, error: "order_not_pending", status: existingOrder.status });
      return;
    }

    const paidAt = new Date().toISOString();
    const paidOrder = await updateOrderPaid({ ...requestContext, paidAt });
    const phone = paidOrder?.phone || existingOrder.phone;
    let premiumUser = await updateUserPremium({
      supabaseUrl: requestContext.supabaseUrl,
      serviceRoleKey,
      phone,
      activatedAt: paidAt,
    });
    if (!premiumUser) {
      premiumUser = await createPremiumUser({
        supabaseUrl: requestContext.supabaseUrl,
        serviceRoleKey,
        phone,
        activatedAt: paidAt,
      });
    }

    sendJson(res, 200, {
      ok: true,
      order: {
        orderNo: paidOrder?.order_no || orderNo,
        phone,
        status: paidOrder?.status || "paid",
        paidAt: paidOrder?.paid_at || paidAt,
      },
      user: {
        phone,
        role: premiumUser?.role || "premium",
        plan: premiumUser?.plan || "premium",
      },
    });
  } catch (error) {
    const errorCode = error.message === "update_user_failed" ? "update_user_failed" : "update_order_failed";
    sendJson(res, 500, {
      ok: false,
      error: errorCode,
      status: error.status || 500,
      detail: sanitizeDetail(error.detail || error.body || error.message),
    });
  }
};
