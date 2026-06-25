const crypto = require("crypto");

const ORDER_NO_PATTERN = /^RSE\d{10,40}$/;
const AMOUNT_CENTS = 1990;
const ALIPAY_METHOD = "alipay.trade.wap.pay";
const ALIPAY_PRODUCT_CODE = "QUICK_WAP_WAY";

function sendJson(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(status).json(body);
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
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[redacted-private-key]")
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
  };
}

async function fetchOrder({ supabaseUrl, serviceRoleKey, orderNo }) {
  const endpoint = `${supabaseUrl}/rest/v1/orders?order_no=eq.${encodeURIComponent(orderNo)}&select=order_no,phone,status,amount_cents,currency,product_code`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) {
    const error = new Error("order_lookup_failed");
    error.status = response.status;
    error.body = body;
    error.detail = sanitizeDetail(body);
    throw error;
  }
  return Array.isArray(body) ? body[0] || null : null;
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

function getPrivateKeyInfo(privateKey) {
  return {
    present: Boolean(privateKey),
    looksPkcs8: /-----BEGIN PRIVATE KEY-----/.test(privateKey),
    hasPemHeader: /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey),
  };
}

function createSignContent(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function signAlipayContent(signContent, privateKey) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signContent, "utf8");
  signer.end();
  return signer.sign(privateKey, "base64");
}

function appendCharsetToGateway(gateway) {
  const separator = gateway.includes("?") ? "&" : "?";
  return `${gateway}${separator}charset=utf-8`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAutoSubmitForm({ gateway, params }) {
  const inputs = Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>正在跳转支付宝沙箱支付</title>
    <style>
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: #111827;
        color: #fff7df;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(92vw, 420px);
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 24px;
        padding: 28px;
        background: rgba(255,255,255,.08);
        box-shadow: 0 24px 80px rgba(0,0,0,.35);
        text-align: center;
      }
      button {
        margin-top: 18px;
        border: 0;
        border-radius: 18px;
        padding: 13px 18px;
        background: #f8c846;
        color: #172033;
        font-weight: 900;
        cursor: pointer;
      }
      p {
        color: rgba(255,247,223,.72);
        line-height: 1.7;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>正在跳转支付宝沙箱支付…</h1>
      <p>如果页面没有自动跳转，请点击下方按钮继续前往支付宝沙箱收银台。</p>
      <form id="alipayForm" accept-charset="utf-8" method="POST" action="${escapeHtml(appendCharsetToGateway(gateway))}">
        ${inputs}
        <button type="submit">继续前往支付宝沙箱支付</button>
      </form>
    </main>
    <script>
      setTimeout(function () {
        document.getElementById("alipayForm").submit();
      }, 80);
    </script>
  </body>
</html>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, error: "method_not_allowed" });
    return;
  }

  const orderNo = String(req.query?.orderNo || "").trim();
  const isDebug = String(req.query?.debug || "") === "1";
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

  const appId = process.env.ALIPAY_APP_ID;
  const gateway = process.env.ALIPAY_GATEWAY;
  const privateKey = normalizePrivateKey(process.env.ALIPAY_APP_PRIVATE_KEY);
  const returnUrl = process.env.ALIPAY_RETURN_URL;
  const notifyUrl = process.env.ALIPAY_NOTIFY_URL;
  if (!appId || !gateway || !privateKey || !returnUrl || !notifyUrl) {
    sendJson(res, 500, { ok: false, error: "missing_alipay_env" });
    return;
  }

  try {
    const order = await fetchOrder({
      supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
      serviceRoleKey,
      orderNo,
    });
    if (!order) {
      sendJson(res, 404, { ok: false, error: "order_not_found" });
      return;
    }
    if (order.status !== "pending") {
      sendJson(res, 409, { ok: false, error: "order_not_pending", status: order.status });
      return;
    }
    if (Number(order.amount_cents) !== AMOUNT_CENTS) {
      sendJson(res, 409, { ok: false, error: "invalid_order_amount" });
      return;
    }

    const bizContent = JSON.stringify({
      out_trade_no: orderNo,
      total_amount: "19.90",
      subject: "Real Scene English Full Access",
      product_code: ALIPAY_PRODUCT_CODE,
      body: "Real Scene English premium unlock",
    });
    const params = {
      app_id: appId,
      method: ALIPAY_METHOD,
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: formatAlipayTimestamp(),
      version: "1.0",
      notify_url: notifyUrl,
      return_url: returnUrl,
      biz_content: bizContent,
    };
    const signContent = createSignContent(params);

    let sign = "";
    try {
      sign = signAlipayContent(signContent, privateKey);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: "alipay_sign_failed" });
      return;
    }

    if (isDebug) {
      const privateKeyInfo = getPrivateKeyInfo(privateKey);
      sendJson(res, 200, {
        ok: true,
        gateway,
        formAction: appendCharsetToGateway(gateway),
        method: ALIPAY_METHOD,
        appIdPresent: Boolean(appId),
        privateKeyPresent: privateKeyInfo.present,
        privateKeyLooksPkcs8: privateKeyInfo.looksPkcs8,
        privateKeyHasPemHeader: privateKeyInfo.hasPemHeader,
        paramKeys: Object.keys(params).sort(),
        signContentLength: signContent.length,
        signPreview: signContent
          .replace(/app_id=[^&]+/, "app_id=[present]")
          .slice(0, 200),
        hasSign: Boolean(sign),
      });
      return;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(renderAutoSubmitForm({ gateway, params: { ...params, sign } }));
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message === "order_lookup_failed" ? "order_lookup_failed" : "alipay_payment_create_failed",
      status: error.status || 500,
      detail: sanitizeDetail(error.detail || error.body || error.message),
    });
  }
};
