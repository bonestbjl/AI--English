const crypto = require("crypto");

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const CODE_TTL_SECONDS = 5 * 60;
const SEND_COOLDOWN_SECONDS = 60;
const DAILY_SEND_LIMIT = 10;
const DAILY_WINDOW_SECONDS = 24 * 60 * 60;
const MOCK_CODE = "123456";
const SMS_MODES = new Set(["mock", "tencent"]);
const SMS_AUDIT_PREFIX = "[rse-sms:";

class SmsProviderError extends Error {
  constructor(providerCode) {
    super("sms_provider_error");
    this.name = "SmsProviderError";
    this.providerCode = normalizeProviderCode(providerCode);
  }
}

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
    detail = value.message || value.error || value.details || value.hint || "";
  }
  return String(detail)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/("?(?:apikey|authorization|token|secret|key)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[redacted]$3")
    .replace(/(service_role[\w.-]*)/gi, "[redacted]")
    .slice(0, 300);
}

function normalizeProviderCode(value) {
  return String(value || "UnknownProviderError")
    .replace(/[^A-Za-z0-9_.:-]/g, "_")
    .slice(0, 100);
}

function maskPhone(phone) {
  const value = String(phone || "");
  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!raw || !/^[\d\s-]+$/.test(raw)) return "";
  const normalized = raw.replace(/[\s-]+/g, "");
  return PHONE_PATTERN.test(normalized) ? normalized : "";
}

async function readSupabaseJson(response) {
  const text = await response.text();
  if (!text) return null;
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
  error.name = "SupabaseError";
  error.status = response.status;
  error.detail = sanitizeDetail(body);
  return error;
}

function getSmsMode(env) {
  return String(env.SMS_MODE || "").trim().toLowerCase();
}

function getRuntimeConfig(env) {
  const mode = getSmsMode(env);
  const missing = [];
  if (!SMS_MODES.has(mode)) missing.push("SMS_MODE");
  if (!String(env.SMS_CODE_SECRET || "").trim()) missing.push("SMS_CODE_SECRET");
  if (!String(env.SUPABASE_URL || "").trim()) missing.push("SUPABASE_URL");
  if (!String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (mode === "tencent") {
    [
      "TENCENTCLOUD_SECRET_ID",
      "TENCENTCLOUD_SECRET_KEY",
      "TENCENT_SMS_SDK_APP_ID",
      "TENCENT_SMS_SIGN_NAME",
      "TENCENT_SMS_TEMPLATE_ID",
    ].forEach((name) => {
      if (!String(env[name] || "").trim()) missing.push(name);
    });
  }

  if (missing.length) {
    const error = new Error("server_config_error");
    error.name = "ServerConfigError";
    error.missing = [...new Set(missing)];
    throw error;
  }

  return {
    mode,
    smsCodeSecret: String(env.SMS_CODE_SECRET).trim(),
    supabaseUrl: String(env.SUPABASE_URL).trim().replace(/\/+$/, ""),
    serviceRoleKey: String(env.SUPABASE_SERVICE_ROLE_KEY).trim(),
    tencent: mode === "tencent"
      ? {
        secretId: String(env.TENCENTCLOUD_SECRET_ID).trim(),
        secretKey: String(env.TENCENTCLOUD_SECRET_KEY).trim(),
        sdkAppId: String(env.TENCENT_SMS_SDK_APP_ID).trim(),
        signName: String(env.TENCENT_SMS_SIGN_NAME).trim(),
        templateId: String(env.TENCENT_SMS_TEMPLATE_ID).trim(),
        region: String(env.TENCENT_SMS_REGION || "ap-guangzhou").trim() || "ap-guangzhou",
      }
      : null,
  };
}

function hashCode(phone, code, secret) {
  return crypto.createHash("sha256").update(`${phone}:${code}:${secret}`, "utf8").digest("hex");
}

function createSixDigitCode(mode, randomInt = crypto.randomInt) {
  if (mode === "mock") return MOCK_CODE;
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

function getClientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim()
    .slice(0, 80);
}

function buildAuditUserAgent(mode, status, userAgent) {
  const marker = `${SMS_AUDIT_PREFIX}${mode}:${status}]`;
  const suffix = String(userAgent || "").replace(/[\r\n]+/g, " ").trim();
  return `${marker}${suffix ? ` ${suffix}` : ""}`.slice(0, 500);
}

function hasAuditStatus(row, mode, statuses) {
  const userAgent = String(row?.user_agent || "");
  if (statuses.some((status) => userAgent.startsWith(`${SMS_AUDIT_PREFIX}${mode}:${status}]`))) {
    return true;
  }
  return mode === "mock" && !userAgent.startsWith(SMS_AUDIT_PREFIX);
}

async function fetchRecentCodes({ fetchImpl, supabaseUrl, serviceRoleKey, phone, since }) {
  const endpoint = `${supabaseUrl}/rest/v1/sms_login_codes?phone=eq.${encodeURIComponent(phone)}&created_at=gte.${encodeURIComponent(since)}&select=created_at,user_agent&order=created_at.desc&limit=2000`;
  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("sms_code_lookup_failed", response, body);
  return Array.isArray(body) ? body : [];
}

async function consumeOpenCodesExcept({ fetchImpl, supabaseUrl, serviceRoleKey, phone, exceptId, consumedAt }) {
  const endpoint = `${supabaseUrl}/rest/v1/sms_login_codes?phone=eq.${encodeURIComponent(phone)}&consumed_at=is.null&id=neq.${encodeURIComponent(exceptId)}`;
  const response = await fetchImpl(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify({ consumed_at: consumedAt }),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("sms_code_invalidate_failed", response, body);
}

async function insertCode({ fetchImpl, supabaseUrl, serviceRoleKey, row }) {
  const endpoint = `${supabaseUrl}/rest/v1/sms_login_codes`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify(row),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("sms_code_create_failed", response, body);
  const inserted = Array.isArray(body) ? body[0] : body;
  if (!inserted?.id) {
    const error = new Error("sms_code_create_missing_id");
    error.name = "SupabaseError";
    throw error;
  }
  return inserted;
}

async function patchCode({ fetchImpl, supabaseUrl, serviceRoleKey, id, patch }) {
  const endpoint = `${supabaseUrl}/rest/v1/sms_login_codes?id=eq.${encodeURIComponent(id)}`;
  const response = await fetchImpl(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(serviceRoleKey),
    body: JSON.stringify(patch),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("sms_code_update_failed", response, body);
}

async function deleteCode({ fetchImpl, supabaseUrl, serviceRoleKey, id }) {
  const endpoint = `${supabaseUrl}/rest/v1/sms_login_codes?id=eq.${encodeURIComponent(id)}`;
  const response = await fetchImpl(endpoint, {
    method: "DELETE",
    headers: supabaseHeaders(serviceRoleKey),
  });
  const body = await readSupabaseJson(response);
  if (!response.ok) throw createSupabaseError("sms_code_delete_failed", response, body);
}

async function invalidateInsertedCode(context, id, mode, userAgent, nowIso, logger) {
  try {
    await patchCode({
      ...context,
      id,
      patch: {
        consumed_at: nowIso,
        user_agent: buildAuditUserAgent(mode, "failed", userAgent),
      },
    });
    return true;
  } catch (patchError) {
    try {
      await deleteCode({ ...context, id });
      return true;
    } catch (deleteError) {
      logger.error("sms code rollback failed", {
        databaseStatus: deleteError.status || patchError.status || 500,
      });
      return false;
    }
  }
}

function createTencentSmsClient(config) {
  const { sms } = require("tencentcloud-sdk-nodejs-sms");
  const SmsClient = sms.v20210111.Client;
  return new SmsClient({
    credential: {
      secretId: config.secretId,
      secretKey: config.secretKey,
    },
    region: config.region,
    profile: {
      httpProfile: {
        endpoint: "sms.tencentcloudapi.com",
      },
    },
  });
}

async function sendTencentCode({ client, config, phone, code }) {
  const response = await client.SendSms({
    SmsSdkAppId: config.sdkAppId,
    SignName: config.signName,
    TemplateId: config.templateId,
    TemplateParamSet: [code, String(CODE_TTL_SECONDS / 60)],
    PhoneNumberSet: [`+86${phone}`],
  });
  const sendStatus = response?.SendStatusSet?.[0];
  if (sendStatus?.Code !== "Ok") {
    throw new SmsProviderError(sendStatus?.Code);
  }
  return {
    providerCode: "Ok",
    requestId: String(response?.RequestId || "").slice(0, 100),
  };
}

function createHandler(overrides = {}) {
  const env = overrides.env || process.env;
  const fetchImpl = overrides.fetchImpl || global.fetch;
  const now = overrides.now || (() => new Date());
  const randomInt = overrides.randomInt || crypto.randomInt;
  const createSmsClient = overrides.createSmsClient || createTencentSmsClient;
  const logger = overrides.logger || console;

  return async function handler(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    const body = readRequestBody(req);
    const phone = normalizePhone(body.phone);
    if (!phone) {
      sendJson(res, 400, { ok: false, error: "invalid_phone" });
      return;
    }

    let config;
    try {
      config = getRuntimeConfig(env);
    } catch (error) {
      logger.error("sms server configuration error", {
        missingVariables: error.missing || ["SMS_MODE"],
      });
      sendJson(res, 500, { ok: false, error: "server_config_error" });
      return;
    }

    const currentTime = now();
    const nowIso = currentTime.toISOString();
    const databaseContext = {
      fetchImpl,
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
      phone,
    };
    const rawUserAgent = String(req.headers["user-agent"] || "");

    try {
      const recentCodes = await fetchRecentCodes({
        ...databaseContext,
        since: new Date(currentTime.getTime() - DAILY_WINDOW_SECONDS * 1000).toISOString(),
      });
      const recentAttempts = recentCodes.filter((row) =>
        hasAuditStatus(row, config.mode, ["pending", "sent"])
      );
      const latestAttemptMs = recentAttempts.reduce((latest, row) => {
        const value = new Date(row.created_at || 0).getTime();
        return Number.isFinite(value) ? Math.max(latest, value) : latest;
      }, 0);
      if (latestAttemptMs && currentTime.getTime() - latestAttemptMs < SEND_COOLDOWN_SECONDS * 1000) {
        const retryAfter = Math.max(
          1,
          SEND_COOLDOWN_SECONDS - Math.floor((currentTime.getTime() - latestAttemptMs) / 1000)
        );
        sendJson(res, 429, { ok: false, error: "cooldown", retryAfter });
        return;
      }

      if (
        config.mode === "tencent" &&
        recentCodes.filter((row) => hasAuditStatus(row, "tencent", ["sent"])).length >= DAILY_SEND_LIMIT
      ) {
        sendJson(res, 429, { ok: false, error: "daily_limit" });
        return;
      }

      const code = createSixDigitCode(config.mode, randomInt);
      const inserted = await insertCode({
        ...databaseContext,
        row: {
          phone,
          code_hash: hashCode(phone, code, config.smsCodeSecret),
          expires_at: new Date(currentTime.getTime() + CODE_TTL_SECONDS * 1000).toISOString(),
          attempts: 0,
          send_ip: getClientIp(req),
          user_agent: buildAuditUserAgent(config.mode, "pending", rawUserAgent),
          created_at: nowIso,
        },
      });

      try {
        await consumeOpenCodesExcept({
          ...databaseContext,
          exceptId: inserted.id,
          consumedAt: nowIso,
        });
      } catch (error) {
        await invalidateInsertedCode(databaseContext, inserted.id, config.mode, rawUserAgent, nowIso, logger);
        throw error;
      }

      if (config.mode === "tencent") {
        try {
          const client = createSmsClient(config.tencent);
          await sendTencentCode({ client, config: config.tencent, phone, code });
        } catch (error) {
          const rolledBack = await invalidateInsertedCode(
            databaseContext,
            inserted.id,
            config.mode,
            rawUserAgent,
            nowIso,
            logger
          );
          const providerCode = error instanceof SmsProviderError
            ? error.providerCode
            : normalizeProviderCode(error?.code || error?.name);
          logger.error("sms provider send failed", {
            phone: maskPhone(phone),
            providerCode,
            codeRecordInvalidated: rolledBack,
          });
          if (!rolledBack) {
            sendJson(res, 500, { ok: false, error: "database_error" });
            return;
          }
          sendJson(res, 502, { ok: false, error: "sms_provider_error" });
          return;
        }
      }

      await patchCode({
        ...databaseContext,
        id: inserted.id,
        patch: {
          user_agent: buildAuditUserAgent(config.mode, "sent", rawUserAgent),
        },
      });

      const responseBody = {
        ok: true,
        mock: config.mode === "mock",
        message: "验证码已发送",
      };
      if (config.mode === "mock") responseBody.devCode = code;
      sendJson(res, 200, responseBody);
    } catch (error) {
      if (error?.name === "SupabaseError") {
        logger.error("sms database operation failed", {
          phone: maskPhone(phone),
          databaseStatus: error.status || 500,
          operation: sanitizeDetail(error.message),
        });
        sendJson(res, 500, { ok: false, error: "database_error" });
        return;
      }
      logger.error("sms send unexpected failure", {
        phone: maskPhone(phone),
        errorType: normalizeProviderCode(error?.name),
      });
      sendJson(res, 500, { ok: false, error: "server_error" });
    }
  };
}

const handler = createHandler();

module.exports = handler;
module.exports.createHandler = createHandler;
module.exports._internals = {
  buildAuditUserAgent,
  createSixDigitCode,
  getRuntimeConfig,
  hashCode,
  maskPhone,
  normalizePhone,
  sendTencentCode,
};
