const {
  CURRENCY,
  OUT_TRADE_NO_PATTERN,
  PAYMENT_PROVIDER,
  PLAN_CATALOG,
  SUCCESS_TRADE_STATUSES,
  callSupabaseRpc,
  createAlipaySdk,
  fetchOrder,
  getAlipayConfig,
  getSupabaseConfig,
  isAlipayEnabled,
  parseAmountToCents,
  parseFormBody,
  readRawBody,
  sanitizeDetail,
  sendText,
  verifyNotifySignature,
} = require("../_lib/alipay-production");

function createHandler(dependencies = {}) {
  const env = dependencies.env || process.env;
  const fetchImpl = dependencies.fetchImpl || global.fetch;
  const now = dependencies.now || (() => new Date());
  const logger = dependencies.logger || console;

  return async function handler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      sendText(res, 405, "failure");
      return;
    }
    if (!isAlipayEnabled(env)) {
      sendText(res, 503, "failure");
      return;
    }

    try {
      const config = getAlipayConfig(env);
      const supabase = getSupabaseConfig(env);
      const params = parseFormBody(await readRawBody(req));
      const sdk = createAlipaySdk(config, dependencies);
      if (!verifyNotifySignature(sdk, params)) {
        logger.error?.("alipay notify rejected", { reason: "invalid_signature" });
        sendText(res, 400, "failure");
        return;
      }
      if (params.app_id !== config.appId) {
        logger.error?.("alipay notify rejected", { reason: "invalid_app_id" });
        sendText(res, 400, "failure");
        return;
      }
      if (config.sellerId && params.seller_id !== config.sellerId) {
        logger.error?.("alipay notify rejected", { reason: "invalid_seller_id" });
        sendText(res, 400, "failure");
        return;
      }
      if (!SUCCESS_TRADE_STATUSES.has(String(params.trade_status || ""))) {
        sendText(res, 200, "success");
        return;
      }

      const outTradeNo = String(params.out_trade_no || "").trim();
      if (!OUT_TRADE_NO_PATTERN.test(outTradeNo)) {
        sendText(res, 400, "failure");
        return;
      }
      const order = await fetchOrder({ fetchImpl, ...supabase, outTradeNo });
      if (!order || order.payment_provider !== PAYMENT_PROVIDER) {
        logger.error?.("alipay notify rejected", { reason: "order_not_found", outTradeNo });
        sendText(res, 404, "failure");
        return;
      }
      const plan = PLAN_CATALOG[order.plan_id];
      const notifiedAmountCents = parseAmountToCents(params.total_amount);
      if (
        !plan ||
        order.currency !== CURRENCY ||
        Number(order.amount_cents) !== plan.amountCents ||
        notifiedAmountCents !== Number(order.amount_cents)
      ) {
        logger.error?.("alipay notify rejected", { reason: "amount_or_plan_mismatch", outTradeNo });
        sendText(res, 400, "failure");
        return;
      }

      await callSupabaseRpc({
        fetchImpl,
        ...supabase,
        functionName: "finalize_alipay_payment",
        payload: {
          p_out_trade_no: outTradeNo,
          p_alipay_trade_no: String(params.trade_no || "").trim(),
          p_paid_at: now().toISOString(),
          p_notify_summary: {
            app_id: params.app_id,
            trade_status: params.trade_status,
            total_amount: params.total_amount,
            notify_id: String(params.notify_id || "").slice(0, 128),
          },
        },
      });
      sendText(res, 200, "success");
    } catch (error) {
      logger.error?.("alipay notify failed", {
        error: error.message,
        detail: sanitizeDetail(error.detail || error.message),
      });
      sendText(res, 500, "failure");
    }
  };
}

const handler = createHandler();
handler.createHandler = createHandler;
module.exports = handler;
