const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const createOrderModule = require("../api/alipay/create-order");
const notifyModule = require("../api/alipay/notify");
const orderStatusModule = require("../api/alipay/order-status");
const {
  PLAN_CATALOG,
  createAlipaySdk,
  createPaymentUrl,
  getAlipayConfig,
} = require("../api/_lib/alipay-production");

const PHONE = "13062989950";
const OTHER_PHONE = "13800138000";
const OUT_TRADE_NO = "RSE20260802123456000001";
const NOW = new Date("2026-08-02T08:00:00.000Z");
const AUTH_SECRET = "unit-test-auth-secret";

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

function createEnv(overrides = {}) {
  return {
    ALIPAY_ENABLED: "true",
    ALIPAY_APP_ID: "2021006178670803",
    ALIPAY_GATEWAY: "https://openapi.alipay.com/gateway.do",
    ALIPAY_PRIVATE_KEY_PATH: "/keys/app-private.pem",
    ALIPAY_PUBLIC_KEY_PATH: "/keys/alipay-public.pem",
    ALIPAY_NOTIFY_URL: "https://english.bonestlab.com/api/alipay/notify",
    ALIPAY_RETURN_URL: "https://english.bonestlab.com/?payment=return",
    ALIPAY_QUIT_URL: "https://english.bonestlab.com/?payment=cancel",
    AUTH_TOKEN_SECRET: AUTH_SECRET,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    ...overrides,
  };
}

function createAuthToken(phone = PHONE, secret = AUTH_SECRET, expiresAt = NOW.getTime() + 60_000) {
  const payload = Buffer.from(JSON.stringify({
    phone,
    iat: Math.floor(NOW.getTime() / 1000),
    exp: Math.floor(expiresAt / 1000),
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function createRequest({ method = "POST", body = {}, query = {}, phone = PHONE, headers = {} } = {}) {
  return {
    method,
    body,
    query,
    headers: {
      authorization: `Bearer ${createAuthToken(phone)}`,
      host: "english.bonestlab.com",
      ...headers,
    },
  };
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function readKey(path) {
  if (path === "/keys/app-private.pem") return appKeys.privateKey;
  if (path === "/keys/alipay-public.pem") return alipayKeys.publicKey;
  const error = new Error("ENOENT");
  error.code = "ENOENT";
  throw error;
}

function createDatabaseMock(options = {}) {
  const state = {
    createCalls: [],
    finalizeCalls: [],
    membershipGrants: 0,
    order: {
      out_trade_no: OUT_TRADE_NO,
      order_no: OUT_TRADE_NO,
      phone: PHONE,
      plan_id: "monthly",
      subject: PLAN_CATALOG.monthly.subject,
      amount_cents: PLAN_CATALOG.monthly.amountCents,
      currency: "CNY",
      status: "pending",
      payment_provider: "alipay",
      reused: false,
      created_at: NOW.toISOString(),
      ...options.order,
    },
  };

  async function fetchImpl(input, init = {}) {
    const url = new URL(input);
    const method = String(init.method || "GET").toUpperCase();
    const payload = init.body ? JSON.parse(init.body) : null;

    if (url.pathname.endsWith("/rpc/create_or_reuse_alipay_order") && method === "POST") {
      state.createCalls.push(payload);
      state.order = {
        ...state.order,
        out_trade_no: payload.p_out_trade_no,
        order_no: payload.p_out_trade_no,
        phone: payload.p_phone,
        plan_id: payload.p_plan_id,
        subject: payload.p_subject,
        amount_cents: payload.p_amount_cents,
        currency: payload.p_currency,
      };
      return jsonResponse([state.order]);
    }

    if (url.pathname.endsWith("/rpc/finalize_alipay_payment") && method === "POST") {
      state.finalizeCalls.push(payload);
      if (state.membershipGrants === 0) {
        state.membershipGrants += 1;
        state.order.status = "paid";
        return jsonResponse([{
          processed: true,
          duplicate: false,
          phone: state.order.phone,
          plan_id: state.order.plan_id,
          premium_until: "2026-09-01T08:00:00.000Z",
          lifetime_access: false,
        }]);
      }
      return jsonResponse([{
        processed: false,
        duplicate: true,
        phone: state.order.phone,
        plan_id: state.order.plan_id,
        premium_until: "2026-09-01T08:00:00.000Z",
        lifetime_access: false,
      }]);
    }

    if (url.pathname.endsWith("/orders") && method === "GET") {
      const outTradeFilter = url.searchParams.get("out_trade_no");
      const phoneFilter = url.searchParams.get("phone");
      const outTradeNo = outTradeFilter?.startsWith("eq.") ? outTradeFilter.slice(3) : "";
      const phone = phoneFilter?.startsWith("eq.") ? phoneFilter.slice(3) : "";
      if (outTradeNo && outTradeNo !== state.order.out_trade_no) return jsonResponse([]);
      if (phone && phone !== state.order.phone) return jsonResponse([]);
      return jsonResponse([state.order]);
    }

    if (url.pathname.endsWith("/orders") && method === "PATCH") {
      Object.assign(state.order, payload);
      return jsonResponse([state.order]);
    }

    throw new Error(`Unexpected database request: ${method} ${url}`);
  }

  return { state, fetchImpl };
}

function signNotifyParams(params) {
  const content = Object.keys(params)
    .filter((key) => key !== "sign" && key !== "sign_type")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto.sign("RSA-SHA256", Buffer.from(content, "utf8"), alipayKeys.privateKey).toString("base64");
}

function createNotifyRequest(overrides = {}) {
  const params = {
    app_id: "2021006178670803",
    out_trade_no: OUT_TRADE_NO,
    trade_no: "2026080222000000000001",
    trade_status: "TRADE_SUCCESS",
    total_amount: "19.90",
    charset: "utf-8",
    ...overrides,
  };
  params.sign_type = "RSA2";
  params.sign = signNotifyParams(params);
  return {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  };
}

function createDependencies(database, env = createEnv(), overrides = {}) {
  return {
    env,
    fetchImpl: database.fetchImpl,
    readFileSync: readKey,
    now: () => new Date(NOW),
    randomBytes: () => Buffer.from("1234567890ab", "hex"),
    logger: { info() {}, error() {} },
    ...overrides,
  };
}

test("server catalog defines the existing monthly and lifetime products", () => {
  assert.deepEqual(Object.keys(PLAN_CATALOG), ["monthly", "lifetime"]);
  assert.equal(PLAN_CATALOG.monthly.amountCents, 1990);
  assert.equal(PLAN_CATALOG.monthly.durationDays, 30);
  assert.equal(PLAN_CATALOG.lifetime.amountCents, 19900);
  assert.equal(PLAN_CATALOG.lifetime.durationDays, null);
});

test("disabled production payments fail closed before authentication, database, or SDK access", async () => {
  let fetchCalled = false;
  const handler = createOrderModule.createHandler({
    env: createEnv({ ALIPAY_ENABLED: "false" }),
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("database should not be reached");
    },
    readFileSync() {
      throw new Error("keys should not be read");
    },
  });
  const response = createResponseRecorder();
  await handler(createRequest({ headers: { authorization: "" }, body: { planId: "monthly" } }), response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error, "alipay_not_enabled");
  assert.equal(fetchCalled, false);
});

test("creating an order requires a valid existing auth token", async () => {
  const database = createDatabaseMock();
  const handler = createOrderModule.createHandler(createDependencies(database));
  const response = createResponseRecorder();
  await handler(createRequest({ body: { planId: "monthly" }, headers: { authorization: "" } }), response);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, "unauthorized");
  assert.equal(database.state.createCalls.length, 0);
});

test("invalid planId is rejected", async () => {
  const database = createDatabaseMock();
  const handler = createOrderModule.createHandler(createDependencies(database));
  const response = createResponseRecorder();
  await handler(createRequest({ body: { planId: "weekly" } }), response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, "invalid_plan_id");
  assert.equal(database.state.createCalls.length, 0);
});

test("client supplied price is ignored and the server catalog amount is persisted", async () => {
  const database = createDatabaseMock();
  const handler = createOrderModule.createHandler(createDependencies(database));
  const response = createResponseRecorder();
  await handler(createRequest({ body: { planId: "monthly", amountCents: 1, subject: "tampered" } }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(database.state.createCalls[0].p_amount_cents, 1990);
  assert.equal(database.state.createCalls[0].p_subject, PLAN_CATALOG.monthly.subject);
  assert.equal(response.body.order.amountCents, 1990);
  assert.match(response.body.paymentUrl, /^https:\/\/openapi\.alipay\.com\/gateway\.do\?/);
});

test("missing private key returns a controlled error after marking the order failed", async () => {
  const database = createDatabaseMock();
  const handler = createOrderModule.createHandler(createDependencies(database, createEnv(), {
    readFileSync() {
      const error = new Error("ENOENT");
      error.code = "ENOENT";
      throw error;
    },
  }));
  const response = createResponseRecorder();
  await handler(createRequest({ body: { planId: "monthly" } }), response);
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, "alipay_key_unavailable");
  assert.equal(database.state.order.status, "failed");
});

test("a reused pending order is not failed when payment URL generation has a transient error", async () => {
  const database = createDatabaseMock({ order: { reused: true } });
  const handler = createOrderModule.createHandler(createDependencies(database, createEnv(), {
    readFileSync() {
      throw new Error("temporary key read failure");
    },
  }));
  const response = createResponseRecorder();
  await handler(createRequest({ body: { planId: "monthly" } }), response);
  assert.equal(response.statusCode, 500);
  assert.equal(database.state.order.status, "pending");
});

test("official SDK payment URL carries an RSA2 signature that verifies locally", async () => {
  const database = createDatabaseMock();
  const handler = createOrderModule.createHandler(createDependencies(database));
  const response = createResponseRecorder();
  await handler(createRequest({ body: { planId: "lifetime" } }), response);
  assert.equal(response.statusCode, 200);
  const url = new URL(response.body.paymentUrl);
  const sign = url.searchParams.get("sign");
  const signType = url.searchParams.get("sign_type");
  const signContent = [...url.searchParams.entries()]
    .filter(([key]) => key !== "sign")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  assert.equal(signType, "RSA2");
  assert.equal(url.searchParams.get("format"), "JSON");
  assert.equal(url.searchParams.get("notify_url"), "https://english.bonestlab.com/api/alipay/notify");
  assert.equal(url.searchParams.get("return_url"), "https://english.bonestlab.com/?payment=return");
  const bizContent = JSON.parse(url.searchParams.get("biz_content"));
  assert.equal(bizContent.product_code, "QUICK_WAP_WAY");
  assert.equal(bizContent.quit_url, "https://english.bonestlab.com/?payment=cancel");
  assert.equal(bizContent.out_trade_no, response.body.order.outTradeNo);
  assert.equal(bizContent.total_amount, "199.00");
  assert.equal(bizContent.subject, PLAN_CATALOG.lifetime.subject);
  assert.equal(crypto.verify("RSA-SHA256", Buffer.from(signContent, "utf8"), appKeys.publicKey, Buffer.from(sign, "base64")), true);
});

test("official SDK explicitly initializes a PKCS8 key and completes local signing and notification verification", () => {
  assert.match(appKeys.privateKey, /-----BEGIN PRIVATE KEY-----/);
  const config = getAlipayConfig(createEnv());
  const sdk = createAlipaySdk(config, { readFileSync: readKey });
  assert.equal(sdk.config.keyType, "PKCS8");
  assert.equal(sdk.config.privateKey.includes("BEGIN PRIVATE KEY"), true);

  const paymentUrl = createPaymentUrl(sdk, config, {
    out_trade_no: OUT_TRADE_NO,
  }, PLAN_CATALOG.monthly);
  const url = new URL(paymentUrl);
  const sign = Buffer.from(url.searchParams.get("sign"), "base64");
  const signContent = [...url.searchParams.entries()]
    .filter(([key]) => key !== "sign")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  assert.equal(crypto.verify("RSA-SHA256", Buffer.from(signContent, "utf8"), appKeys.publicKey, sign), true);

  const notifyParams = {
    app_id: config.appId,
    out_trade_no: OUT_TRADE_NO,
    trade_no: "2026080222000000000001",
    trade_status: "TRADE_SUCCESS",
    total_amount: "19.90",
    sign_type: "RSA2",
  };
  notifyParams.sign = signNotifyParams(notifyParams);
  assert.equal(sdk.checkNotifySign(notifyParams, true), true);
});

test("a valid signed notification finalizes the local order and returns plain success", async () => {
  const database = createDatabaseMock();
  const handler = notifyModule.createHandler(createDependencies(database));
  const response = createResponseRecorder();
  await handler(createNotifyRequest(), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "success");
  assert.equal(response.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(database.state.membershipGrants, 1);
  assert.equal(database.state.finalizeCalls.length, 1);
});

test("an invalid notification signature never reaches the database finalization RPC", async () => {
  const database = createDatabaseMock();
  const handler = notifyModule.createHandler(createDependencies(database));
  const request = createNotifyRequest();
  request.body = request.body.replace(/sign=[^&]+/, "sign=invalid");
  const response = createResponseRecorder();
  await handler(request, response);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body, "failure");
  assert.equal(database.state.finalizeCalls.length, 0);
});

test("non-success trade status is acknowledged without granting membership", async () => {
  const database = createDatabaseMock();
  const handler = notifyModule.createHandler(createDependencies(database));
  const response = createResponseRecorder();
  await handler(createNotifyRequest({ trade_status: "WAIT_BUYER_PAY" }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "success");
  assert.equal(database.state.finalizeCalls.length, 0);
});

test("tampered amount, wrong app id, and unknown order are rejected before membership grant", async (t) => {
  await t.test("tampered amount", async () => {
    const database = createDatabaseMock();
    const handler = notifyModule.createHandler(createDependencies(database));
    const response = createResponseRecorder();
    await handler(createNotifyRequest({ total_amount: "0.01" }), response);
    assert.equal(response.body, "failure");
    assert.equal(database.state.membershipGrants, 0);
  });
  await t.test("wrong app id", async () => {
    const database = createDatabaseMock();
    const handler = notifyModule.createHandler(createDependencies(database));
    const response = createResponseRecorder();
    await handler(createNotifyRequest({ app_id: "wrong-app" }), response);
    assert.equal(response.body, "failure");
    assert.equal(database.state.membershipGrants, 0);
  });
  await t.test("unknown order", async () => {
    const database = createDatabaseMock();
    const handler = notifyModule.createHandler(createDependencies(database));
    const response = createResponseRecorder();
    await handler(createNotifyRequest({ out_trade_no: "RSE20260802123456999999" }), response);
    assert.equal(response.body, "failure");
    assert.equal(database.state.membershipGrants, 0);
  });
});

test("duplicate valid notifications call the atomic RPC but grant membership only once", async () => {
  const database = createDatabaseMock();
  const handler = notifyModule.createHandler(createDependencies(database));
  const first = createResponseRecorder();
  const second = createResponseRecorder();
  await handler(createNotifyRequest(), first);
  await handler(createNotifyRequest(), second);
  assert.equal(first.body, "success");
  assert.equal(second.body, "success");
  assert.equal(database.state.finalizeCalls.length, 2);
  assert.equal(database.state.membershipGrants, 1);
});

test("order status is owner-only and never calls the membership finalization RPC", async () => {
  const database = createDatabaseMock({ order: { status: "paid" } });
  const handler = orderStatusModule.createHandler(createDependencies(database));
  const ownResponse = createResponseRecorder();
  await handler(createRequest({ method: "GET", query: { outTradeNo: OUT_TRADE_NO } }), ownResponse);
  assert.equal(ownResponse.statusCode, 200);
  assert.equal(ownResponse.body.status, "paid");
  assert.equal(database.state.finalizeCalls.length, 0);

  const otherResponse = createResponseRecorder();
  await handler(createRequest({ method: "GET", query: { outTradeNo: OUT_TRADE_NO }, phone: OTHER_PHONE }), otherResponse);
  assert.equal(otherResponse.statusCode, 404);
  assert.equal(otherResponse.body.error, "order_not_found");
  assert.equal(database.state.finalizeCalls.length, 0);
});

test("both frontends use authenticated production payment APIs and remain byte-identical", () => {
  const root = path.resolve(__dirname, "..");
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const deployIndex = fs.readFileSync(path.join(root, "deploy-cn/index.html"), "utf8");
  assert.equal(index, deployIndex);
  assert.match(index, /fetch\("\/api\/alipay\/create-order"/);
  assert.match(index, /\/api\/alipay\/order-status\?outTradeNo=/);
  assert.match(index, /Authorization: `Bearer \$\{authToken\}`/);
  assert.match(index, /支付宝支付正在审核，暂未开放/);
  assert.doesNotMatch(index, /handleAlipaySandboxPayment|支付宝沙箱支付|测试环境，不会真实扣款/);
  assert.doesNotMatch(index, /fetch\("\/api\/alipay-query-order"/);
});

test("the migration keeps order and membership updates inside one atomic database function", () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, "../supabase/migrations/20260802_alipay_production_payments.sql"),
    "utf8"
  );
  assert.match(migration, /create or replace function public\.finalize_alipay_payment/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /membership_granted_at = p_paid_at/i);
  assert.match(migration, /greatest\(coalesce\(u\.premium_until, p_paid_at\), p_paid_at\) \+ interval '30 days'/i);
  assert.match(migration, /lifetime_access = true/i);
  assert.match(migration, /revoke all on function public\.finalize_alipay_payment/i);
  assert.match(migration, /grant execute on function public\.finalize_alipay_payment[\s\S]*to service_role/i);
  assert.match(migration, /add column if not exists/i);
  assert.match(migration, /create unique index if not exists/i);
  assert.match(migration, /p_amount_cents integer/i);
  assert.match(migration, /v_order\.amount_cents = 1990/i);
  assert.match(migration, /v_order\.amount_cents = 19900/i);
  assert.match(migration, /v_order\.status = 'paid' and v_order\.membership_granted_at is not null/i);
  assert.match(migration, /coalesce\(v_user\.lifetime_access, false\) = false/i);
  assert.match(migration, /coalesce\(v_user\.role, ''\) <> 'developer'/i);
  assert.doesNotMatch(migration, /\b(?:drop|truncate|delete\s+from)\b/i);
});
