const {
  OUT_TRADE_NO_PATTERN,
  authenticateRequest,
  fetchOrder,
  getSupabaseConfig,
  isAlipayEnabled,
  sanitizeDetail,
  sendJson,
} = require("../_lib/alipay-production");

const SAFE_STATUSES = new Set(["pending", "paid", "failed", "closed", "cancelled"]);

function createHandler(dependencies = {}) {
  const env = dependencies.env || process.env;
  const fetchImpl = dependencies.fetchImpl || global.fetch;
  const now = dependencies.now || (() => new Date());
  const logger = dependencies.logger || console;

  return async function handler(req, res) {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    if (!isAlipayEnabled(env)) {
      sendJson(res, 503, {
        ok: false,
        error: "alipay_not_enabled",
        message: "支付宝支付正在审核，暂未开放",
      });
      return;
    }
    const auth = authenticateRequest(req, env, now());
    if (!auth) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const outTradeNo = String(req.query?.outTradeNo || req.query?.out_trade_no || "").trim();
    if (!OUT_TRADE_NO_PATTERN.test(outTradeNo)) {
      sendJson(res, 400, { ok: false, error: "invalid_out_trade_no" });
      return;
    }

    try {
      const order = await fetchOrder({
        fetchImpl,
        ...getSupabaseConfig(env),
        outTradeNo,
        phone: auth.phone,
      });
      if (!order) {
        sendJson(res, 404, { ok: false, error: "order_not_found" });
        return;
      }
      const status = SAFE_STATUSES.has(order.status) ? order.status : "pending";
      sendJson(res, 200, {
        ok: true,
        outTradeNo: order.out_trade_no,
        orderNo: order.out_trade_no,
        planId: order.plan_id,
        status,
        paid: status === "paid",
        paidAt: status === "paid" ? order.paid_at || null : null,
        membershipGranted: Boolean(order.membership_granted_at),
      });
    } catch (error) {
      logger.error?.("alipay order status failed", {
        error: error.message,
        detail: sanitizeDetail(error.detail || error.message),
      });
      sendJson(res, 500, { ok: false, error: "order_status_failed" });
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
module.exports = handler;
