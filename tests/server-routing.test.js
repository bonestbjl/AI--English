const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  ALIPAY_API_ROUTES,
  createApiServer,
  resolveApiRoute,
} = require("../server");

const OUT_TRADE_NO = "RSE20260802123456000001";
const LEGACY_API_PATHS = [
  "/api/send-login-code",
  "/api/verify-login-code",
  "/api/get-user-plan",
  "/api/learning-data",
  "/api/create-order",
  "/api/alipay-create-payment",
  "/api/alipay-query-order",
  "/api/alipay-notify",
  "/api/mock-pay-success",
];

function invokeServer(server, options = {}) {
  const req = new PassThrough();
  req.method = options.method || "GET";
  req.url = options.path || "/";
  req.headers = {
    host: "127.0.0.1:3001",
    ...(options.headers || {}),
  };

  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      hasHeader(name) {
        return Object.prototype.hasOwnProperty.call(headers, name.toLowerCase());
      },
      end(value = "") {
        this.headersSent = true;
        this.writableEnded = true;
        resolve({
          status: this.statusCode,
          headers,
          text: Buffer.isBuffer(value) ? value.toString("utf8") : String(value),
        });
      },
    };
    server.emit("request", req, res);
    req.once("error", reject);
    req.end(options.body || "");
  });
}

function signNotifyParams(params, privateKey) {
  const content = Object.keys(params)
    .filter((key) => key !== "sign" && key !== "sign_type")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto.sign("RSA-SHA256", Buffer.from(content, "utf8"), privateKey).toString("base64");
}

function restoreEnvironment(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("production server baseline keeps every legacy API route and response shape", async () => {
  for (const apiPath of LEGACY_API_PATHS) {
    const route = resolveApiRoute(apiPath);
    assert.ok(route, `${apiPath} should resolve`);
    assert.equal(fs.existsSync(route.apiFile), true, `${apiPath} handler should exist`);
  }

  const server = createApiServer();
  for (const apiPath of LEGACY_API_PATHS) {
    const response = await invokeServer(server, { method: "OPTIONS", path: apiPath });
    assert.notEqual(response.status, 404, `${apiPath} must not return 404`);
    assert.equal(response.status, 405, `${apiPath} keeps its handler method response`);
    assert.equal(JSON.parse(response.text).error, "method_not_allowed");
  }

  const optionsResponse = await invokeServer(server, {
    method: "OPTIONS",
    path: "/api/send-login-code",
  });
  assert.equal(optionsResponse.headers.allow, "POST");
});

test("production JSON parsing behavior remains unchanged", async () => {
  const server = createApiServer();
  const validJsonResponse = await invokeServer(server, {
    method: "POST",
    path: "/api/verify-login-code",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ phone: "invalid", code: "123456" }),
  });
  assert.equal(validJsonResponse.status, 400);
  assert.equal(JSON.parse(validJsonResponse.text).error, "invalid_phone");

  const malformedJsonResponse = await invokeServer(server, {
    method: "POST",
    path: "/api/verify-login-code",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  });
  assert.equal(malformedJsonResponse.status, 400);
  assert.equal(JSON.parse(malformedJsonResponse.text).error, "invalid_phone");
});

test("Tencent Cloud Node server registers the three nested production Alipay routes", () => {
  const expected = {
    "/api/alipay/create-order": "api/alipay/create-order.js",
    "/api/alipay/notify": "api/alipay/notify.js",
    "/api/alipay/order-status": "api/alipay/order-status.js",
  };
  for (const [route, suffix] of Object.entries(expected)) {
    assert.equal(ALIPAY_API_ROUTES[route].endsWith(suffix), true);
    assert.equal(fs.existsSync(ALIPAY_API_ROUTES[route]), true);
    assert.ok(resolveApiRoute(route));
  }
  assert.equal(resolveApiRoute("/api/alipay/notify").preserveRawBody, true);
  assert.equal(resolveApiRoute("/api/alipay/create-order").preserveRawBody, false);
});

test("form-urlencoded notification survives the production server and verifies before finalization", async () => {
  const environmentNames = [
    "ALIPAY_ENABLED",
    "ALIPAY_APP_ID",
    "ALIPAY_GATEWAY",
    "ALIPAY_PRIVATE_KEY_PATH",
    "ALIPAY_PUBLIC_KEY_PATH",
    "ALIPAY_NOTIFY_URL",
    "ALIPAY_RETURN_URL",
    "ALIPAY_QUIT_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const envSnapshot = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rse-alipay-route-"));
  const appKeys = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const alipayKeys = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const privateKeyPath = path.join(tempDirectory, "app-private.pem");
  const publicKeyPath = path.join(tempDirectory, "alipay-public.pem");
  fs.writeFileSync(privateKeyPath, appKeys.privateKey, { mode: 0o600 });
  fs.writeFileSync(publicKeyPath, alipayKeys.publicKey, { mode: 0o600 });
  let finalizeCalls = 0;

  Object.assign(process.env, {
    ALIPAY_ENABLED: "true",
    ALIPAY_APP_ID: "2021006178670803",
    ALIPAY_GATEWAY: "https://openapi.alipay.com/gateway.do",
    ALIPAY_PRIVATE_KEY_PATH: privateKeyPath,
    ALIPAY_PUBLIC_KEY_PATH: publicKeyPath,
    ALIPAY_NOTIFY_URL: "https://english.bonestlab.com/api/alipay/notify",
    ALIPAY_RETURN_URL: "https://english.bonestlab.com/?payment=return",
    ALIPAY_QUIT_URL: "https://english.bonestlab.com/?payment=cancel",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  });
  global.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/orders")) {
      return new Response(JSON.stringify([{
        out_trade_no: OUT_TRADE_NO,
        order_no: OUT_TRADE_NO,
        phone: "13062989950",
        plan_id: "monthly",
        subject: "Real Scene English Monthly Pass",
        amount_cents: 1990,
        currency: "CNY",
        status: "pending",
        payment_provider: "alipay",
      }]), { status: 200 });
    }
    if (url.pathname.endsWith("/rpc/finalize_alipay_payment")) {
      finalizeCalls += 1;
      return new Response(JSON.stringify([{
        processed: true,
        duplicate: false,
        phone: "13062989950",
        plan_id: "monthly",
        premium_until: "2026-09-01T08:00:00.000Z",
        lifetime_access: false,
      }]), { status: 200 });
    }
    throw new Error(`unexpected test request: ${url.pathname}`);
  };

  try {
    const params = {
      app_id: process.env.ALIPAY_APP_ID,
      out_trade_no: OUT_TRADE_NO,
      trade_no: "2026080222000000000001",
      trade_status: "TRADE_SUCCESS",
      total_amount: "19.90",
      charset: "utf-8",
      sign_type: "RSA2",
    };
    params.sign = signNotifyParams(params, alipayKeys.privateKey);
    const response = await invokeServer(createApiServer(), {
      method: "POST",
      path: "/api/alipay/notify",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      body: new URLSearchParams(params).toString(),
    });
    assert.equal(response.status, 200);
    assert.equal(response.text, "success");
    assert.equal(response.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(finalizeCalls, 1);
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment(envSnapshot);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("ALIPAY_ENABLED=false keeps the server healthy and all three payment routes fail closed", async () => {
  const previousValue = process.env.ALIPAY_ENABLED;
  process.env.ALIPAY_ENABLED = "false";
  try {
    const server = createApiServer();
    const createResponse = await invokeServer(server, {
      method: "POST",
      path: "/api/alipay/create-order",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planId: "monthly" }),
    });
    assert.equal(createResponse.status, 503);
    assert.equal(JSON.parse(createResponse.text).error, "alipay_not_enabled");

    const notifyResponse = await invokeServer(server, {
      method: "POST",
      path: "/api/alipay/notify",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "trade_status=TRADE_SUCCESS",
    });
    assert.equal(notifyResponse.status, 503);
    assert.equal(notifyResponse.text, "failure");

    const statusResponse = await invokeServer(server, {
      path: `/api/alipay/order-status?outTradeNo=${OUT_TRADE_NO}`,
    });
    assert.equal(statusResponse.status, 503);
    assert.equal(JSON.parse(statusResponse.text).error, "alipay_not_enabled");
  } finally {
    if (previousValue === undefined) delete process.env.ALIPAY_ENABLED;
    else process.env.ALIPAY_ENABLED = previousValue;
  }
});
