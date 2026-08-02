const {
  CURRENCY,
  PAYMENT_PROVIDER,
  PLAN_CATALOG,
  authenticateRequest,
  callSupabaseRpc,
  createAlipaySdk,
  createOutTradeNo,
  createPaymentUrl,
  getAlipayConfig,
  getSupabaseConfig,
  isAlipayEnabled,
  markOrderFailed,
  readJsonBody,
  sanitizeDetail,
  sendJson,
} = require("../_lib/alipay-production");

function createHandler(dependencies = {}) {
  const env = dependencies.env || process.env;
  const fetchImpl = dependencies.fetchImpl || global.fetch;
  const now = dependencies.now || (() => new Date());
  const randomBytes = dependencies.randomBytes;
  const logger = dependencies.logger || console;

  return async function handler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
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

    const planId = String(readJsonBody(req).planId || "").trim();
    const plan = PLAN_CATALOG[planId];
    if (!plan) {
      sendJson(res, 400, { ok: false, error: "invalid_plan_id" });
      return;
    }

    let order = null;
    let supabase = null;
    try {
      supabase = getSupabaseConfig(env);
      const config = getAlipayConfig(env);
      const outTradeNo = createOutTradeNo(now(), randomBytes);
      order = await callSupabaseRpc({
        fetchImpl,
        ...supabase,
        functionName: "create_or_reuse_alipay_order",
        payload: {
          p_out_trade_no: outTradeNo,
          p_phone: auth.phone,
          p_plan_id: plan.planId,
          p_product_code: plan.productCode,
          p_subject: plan.subject,
          p_amount_cents: plan.amountCents,
          p_currency: CURRENCY,
          p_payment_provider: PAYMENT_PROVIDER,
        },
      });
      if (!order?.out_trade_no) throw new Error("order_create_failed");

      const sdk = createAlipaySdk(config, dependencies);
      const paymentUrl = createPaymentUrl(sdk, config, order, plan);
      if (!/^https:\/\/openapi\.alipay\.com\/gateway\.do\?/.test(paymentUrl)) {
        throw new Error("alipay_payment_url_invalid");
      }

      sendJson(res, 200, {
        ok: true,
        order: {
          outTradeNo: order.out_trade_no,
          orderNo: order.out_trade_no,
          planId: plan.planId,
          plan: plan.planId,
          subject: plan.subject,
          amountCents: plan.amountCents,
          currency: CURRENCY,
          status: order.status || "pending",
        },
        paymentUrl,
      });
    } catch (error) {
      if (order?.out_trade_no && order.reused !== true && supabase) {
        await markOrderFailed({
          fetchImpl,
          ...supabase,
          outTradeNo: order.out_trade_no,
          reason: error.message,
        }).catch(() => false);
      }
      logger.error?.("alipay create order failed", {
        error: error.message,
        detail: sanitizeDetail(error.detail || error.message),
      });
      const errorCode = error.message === "alipay_key_unavailable"
        ? "alipay_key_unavailable"
        : error.message === "missing_supabase_env"
        ? "missing_supabase_env"
        : error.message === "alipay_config_error"
        ? "alipay_config_error"
        : "alipay_create_order_failed";
      sendJson(res, 500, { ok: false, error: errorCode });
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
module.exports = handler;
