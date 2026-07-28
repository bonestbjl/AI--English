const assert = require("node:assert/strict");
const test = require("node:test");

const sendLoginCode = require("../api/send-login-code");
const verifyLoginCode = require("../api/verify-login-code");

const FIXED_NOW = new Date("2026-07-28T08:00:00.000Z");
const PHONE = "13062989950";

function createEnv(mode = "mock", overrides = {}) {
  return {
    SMS_MODE: mode,
    SMS_CODE_SECRET: "test-sms-code-secret",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    TENCENTCLOUD_SECRET_ID: "test-secret-id",
    TENCENTCLOUD_SECRET_KEY: "test-secret-key",
    TENCENT_SMS_SDK_APP_ID: "1401161459",
    TENCENT_SMS_SIGN_NAME: "杭州萧山智欧恩科技",
    TENCENT_SMS_TEMPLATE_ID: "2696508",
    TENCENT_SMS_REGION: "ap-guangzhou",
    ...overrides,
  };
}

function createRequest(body, headers = {}) {
  return {
    method: "POST",
    body,
    headers: {
      "user-agent": "unit-test-agent",
      "x-forwarded-for": "203.0.113.10",
      ...headers,
    },
    socket: {},
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
  };
}

function jsonResponse(body, status = 200) {
  return new Response(body === null ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createSupabaseMock(initialRows = [], options = {}) {
  const rows = initialRows.map((row, index) => ({
    id: row.id || `existing-${index + 1}`,
    consumed_at: null,
    attempts: 0,
    ...row,
  }));
  let nextId = rows.length + 1;
  const users = options.users || [];

  async function fetchImpl(input, init = {}) {
    const url = new URL(input);
    const method = String(init.method || "GET").toUpperCase();
    if (options.failAllDatabaseRequests) {
      return jsonResponse({ message: "database unavailable" }, 503);
    }

    if (url.pathname.endsWith("/sms_login_codes")) {
      const phoneFilter = url.searchParams.get("phone");
      const idFilter = url.searchParams.get("id");
      const createdAtFilter = url.searchParams.get("created_at");
      const requiresOpen = url.searchParams.get("consumed_at") === "is.null";
      let matches = rows.filter((row) => {
        if (phoneFilter?.startsWith("eq.") && row.phone !== phoneFilter.slice(3)) return false;
        if (idFilter?.startsWith("eq.") && row.id !== idFilter.slice(3)) return false;
        if (idFilter?.startsWith("neq.") && row.id === idFilter.slice(4)) return false;
        if (requiresOpen && row.consumed_at !== null) return false;
        if (
          createdAtFilter?.startsWith("gte.") &&
          new Date(row.created_at).getTime() < new Date(createdAtFilter.slice(4)).getTime()
        ) {
          return false;
        }
        return true;
      });

      if (method === "GET") {
        matches = matches.sort((left, right) =>
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
        );
        return jsonResponse(matches);
      }
      if (method === "POST") {
        const inserted = {
          id: `generated-${nextId++}`,
          consumed_at: null,
          ...JSON.parse(init.body),
        };
        rows.push(inserted);
        return jsonResponse([inserted], 201);
      }
      if (method === "PATCH") {
        const patch = JSON.parse(init.body);
        matches.forEach((row) => Object.assign(row, patch));
        return jsonResponse(matches);
      }
      if (method === "DELETE") {
        const matchingIds = new Set(matches.map((row) => row.id));
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (matchingIds.has(rows[index].id)) rows.splice(index, 1);
        }
        return jsonResponse(matches);
      }
    }

    if (url.pathname.endsWith("/users") && method === "GET") {
      const phoneFilter = url.searchParams.get("phone");
      const phone = phoneFilter?.startsWith("eq.") ? phoneFilter.slice(3) : "";
      return jsonResponse(users.filter((user) => user.phone === phone));
    }

    throw new Error(`Unexpected Supabase request: ${method} ${url}`);
  }

  return { fetchImpl, rows };
}

function createLogger() {
  const entries = [];
  return {
    entries,
    error(message, details) {
      entries.push({ message, details });
    },
  };
}

async function invokeSend({
  body = { phone: PHONE },
  env = createEnv(),
  database = createSupabaseMock(),
  createSmsClient,
  randomInt,
  logger = createLogger(),
} = {}) {
  const handler = sendLoginCode.createHandler({
    env,
    fetchImpl: database.fetchImpl,
    createSmsClient,
    randomInt,
    logger,
    now: () => new Date(FIXED_NOW),
  });
  const response = createResponseRecorder();
  await handler(createRequest(body), response);
  return { response, database, logger };
}

test("mock mode stores a hash, returns 123456, and never creates a Tencent client", async () => {
  let clientCreated = false;
  const result = await invokeSend({
    createSmsClient() {
      clientCreated = true;
      throw new Error("Tencent client must not be created in mock mode");
    },
  });

  assert.equal(result.response.statusCode, 200);
  assert.deepEqual(result.response.body, {
    ok: true,
    mock: true,
    message: "验证码已发送",
    devCode: "123456",
  });
  assert.equal(clientCreated, false);
  assert.equal(result.database.rows.length, 1);
  assert.notEqual(result.database.rows[0].code_hash, "123456");
  assert.match(result.database.rows[0].code_hash, /^[a-f0-9]{64}$/);
});

test("Tencent mode sends the normalized +86 phone and configured template parameters", async () => {
  let clientConfig;
  let sendParams;
  const result = await invokeSend({
    body: { phone: "130-6298-9950" },
    env: createEnv("tencent"),
    randomInt: () => 246810,
    createSmsClient(config) {
      clientConfig = config;
      return {
        async SendSms(params) {
          sendParams = params;
          return { SendStatusSet: [{ Code: "Ok" }], RequestId: "request-id" };
        },
      };
    },
  });

  assert.equal(result.response.statusCode, 200);
  assert.deepEqual(result.response.body, {
    ok: true,
    mock: false,
    message: "验证码已发送",
  });
  assert.equal("devCode" in result.response.body, false);
  assert.equal(clientConfig.region, "ap-guangzhou");
  assert.deepEqual(sendParams, {
    SmsSdkAppId: "1401161459",
    SignName: "杭州萧山智欧恩科技",
    TemplateId: "2696508",
    TemplateParamSet: ["246810", "5"],
    PhoneNumberSet: ["+8613062989950"],
  });
  assert.match(result.database.rows[0].user_agent, /^\[rse-sms:tencent:sent\]/);
});

test("Tencent non-Ok response returns provider error and invalidates the new code", async () => {
  const result = await invokeSend({
    env: createEnv("tencent"),
    randomInt: () => 135790,
    createSmsClient() {
      return {
        async SendSms() {
          return { SendStatusSet: [{ Code: "FailedOperation.TemplateIncorrectOrUnapproved" }] };
        },
      };
    },
  });

  assert.equal(result.response.statusCode, 502);
  assert.deepEqual(result.response.body, { ok: false, error: "sms_provider_error" });
  assert.ok(result.database.rows[0].consumed_at);
  assert.match(result.database.rows[0].user_agent, /^\[rse-sms:tencent:failed\]/);
});

test("Tencent SDK exception returns provider error and invalidates the new code", async () => {
  const result = await invokeSend({
    env: createEnv("tencent"),
    randomInt: () => 864209,
    createSmsClient() {
      return {
        async SendSms() {
          const error = new Error("network failed");
          error.code = "RequestTimeout";
          throw error;
        },
      };
    },
  });

  assert.equal(result.response.statusCode, 502);
  assert.ok(result.database.rows[0].consumed_at);
  assert.match(result.database.rows[0].user_agent, /^\[rse-sms:tencent:failed\]/);
});

test("Tencent failure logs only a masked phone and provider code, never the verification code", async () => {
  const logger = createLogger();
  const result = await invokeSend({
    env: createEnv("tencent"),
    randomInt: () => 123456,
    logger,
    createSmsClient() {
      return {
        async SendSms() {
          return { SendStatusSet: [{ Code: "LimitExceeded.PhoneNumberDailyLimit" }] };
        },
      };
    },
  });

  assert.equal(result.response.statusCode, 502);
  const serializedLogs = JSON.stringify(logger.entries);
  assert.match(serializedLogs, /\*{7}9950/);
  assert.doesNotMatch(serializedLogs, /123456/);
  assert.doesNotMatch(serializedLogs, /test-secret-id|test-secret-key|test-sms-code-secret/);
});

test("missing required Tencent configuration fails closed before database or SDK access", async (t) => {
  const requiredNames = [
    "SMS_CODE_SECRET",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TENCENTCLOUD_SECRET_ID",
    "TENCENTCLOUD_SECRET_KEY",
    "TENCENT_SMS_SDK_APP_ID",
    "TENCENT_SMS_SIGN_NAME",
    "TENCENT_SMS_TEMPLATE_ID",
  ];

  for (const name of requiredNames) {
    await t.test(name, async () => {
      let sdkCalled = false;
      const result = await invokeSend({
        env: createEnv("tencent", { [name]: "" }),
        database: createSupabaseMock([], { failAllDatabaseRequests: true }),
        createSmsClient() {
          sdkCalled = true;
          return { SendSms: async () => ({ SendStatusSet: [{ Code: "Ok" }] }) };
        },
      });
      assert.equal(result.response.statusCode, 500);
      assert.deepEqual(result.response.body, { ok: false, error: "server_config_error" });
      assert.equal(sdkCalled, false);
    });
  }
});

test("empty and unknown SMS_MODE values are rejected instead of falling back to mock", async (t) => {
  for (const mode of ["", "production", "tencnet"]) {
    await t.test(mode || "(empty)", async () => {
      const result = await invokeSend({ env: createEnv(mode) });
      assert.equal(result.response.statusCode, 500);
      assert.deepEqual(result.response.body, { ok: false, error: "server_config_error" });
    });
  }
});

test("60-second cooldown blocks a second send for the same mode", async () => {
  const database = createSupabaseMock([
    {
      phone: PHONE,
      created_at: new Date(FIXED_NOW.getTime() - 30_000).toISOString(),
      user_agent: "[rse-sms:tencent:sent] browser",
    },
  ]);
  let sdkCalled = false;
  const result = await invokeSend({
    env: createEnv("tencent"),
    database,
    createSmsClient() {
      sdkCalled = true;
      return { SendSms: async () => ({ SendStatusSet: [{ Code: "Ok" }] }) };
    },
  });

  assert.equal(result.response.statusCode, 429);
  assert.equal(result.response.body.error, "cooldown");
  assert.equal(result.response.body.retryAfter, 30);
  assert.equal(sdkCalled, false);
});

test("Tencent mode enforces ten successful sends per phone in 24 hours", async () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    phone: PHONE,
    created_at: new Date(FIXED_NOW.getTime() - (index + 2) * 120_000).toISOString(),
    user_agent: "[rse-sms:tencent:sent] browser",
  }));
  let sdkCalled = false;
  const result = await invokeSend({
    env: createEnv("tencent"),
    database: createSupabaseMock(rows),
    createSmsClient() {
      sdkCalled = true;
      return { SendSms: async () => ({ SendStatusSet: [{ Code: "Ok" }] }) };
    },
  });

  assert.equal(result.response.statusCode, 429);
  assert.deepEqual(result.response.body, { ok: false, error: "daily_limit" });
  assert.equal(sdkCalled, false);
});

test("mock sends do not consume the Tencent daily quota", async () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    phone: PHONE,
    created_at: new Date(FIXED_NOW.getTime() - (index + 2) * 120_000).toISOString(),
    user_agent: "[rse-sms:mock:sent] browser",
  }));
  let sdkCalls = 0;
  const result = await invokeSend({
    env: createEnv("tencent"),
    database: createSupabaseMock(rows),
    randomInt: () => 112233,
    createSmsClient() {
      return {
        async SendSms() {
          sdkCalls += 1;
          return { SendStatusSet: [{ Code: "Ok" }] };
        },
      };
    },
  });

  assert.equal(result.response.statusCode, 200);
  assert.equal(sdkCalls, 1);
});

test("invalid mainland phone numbers are rejected before database and SDK access", async (t) => {
  for (const phone of ["", "12912345678", "13062A89950", "+8613062989950", "1306298995"]) {
    await t.test(phone || "(empty)", async () => {
      const result = await invokeSend({
        body: { phone },
        env: createEnv("tencent"),
        database: createSupabaseMock([], { failAllDatabaseRequests: true }),
        createSmsClient() {
          throw new Error("SDK should not be reached");
        },
      });
      assert.equal(result.response.statusCode, 400);
      assert.deepEqual(result.response.body, { ok: false, error: "invalid_phone" });
    });
  }
});

test("database failures return database_error without calling Tencent", async () => {
  let sdkCalled = false;
  const result = await invokeSend({
    env: createEnv("tencent"),
    database: createSupabaseMock([], { failAllDatabaseRequests: true }),
    createSmsClient() {
      sdkCalled = true;
      return { SendSms: async () => ({ SendStatusSet: [{ Code: "Ok" }] }) };
    },
  });

  assert.equal(result.response.statusCode, 500);
  assert.deepEqual(result.response.body, { ok: false, error: "database_error" });
  assert.equal(sdkCalled, false);
});

test("verify-login-code remains compatible with the unchanged SHA-256 hash", async () => {
  const smsSecret = "verify-compatible-secret";
  const code = "123456";
  const database = createSupabaseMock(
    [
      {
        id: "verification-row",
        phone: PHONE,
        code_hash: sendLoginCode._internals.hashCode(PHONE, code, smsSecret),
        expires_at: new Date(FIXED_NOW.getTime() + 300_000).toISOString(),
        created_at: FIXED_NOW.toISOString(),
        attempts: 0,
      },
    ],
    {
      users: [{
        phone: PHONE,
        role: "free",
        plan: "free",
        premium_until: null,
        lifetime_access: false,
      }],
    }
  );
  const originalFetch = global.fetch;
  const originalEnv = {
    SMS_MODE: process.env.SMS_MODE,
    SMS_CODE_SECRET: process.env.SMS_CODE_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  global.fetch = database.fetchImpl;
  process.env.SMS_MODE = "mock";
  process.env.SMS_CODE_SECRET = smsSecret;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  try {
    const response = createResponseRecorder();
    await verifyLoginCode(createRequest({ phone: PHONE, code }), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.phone, PHONE);
    assert.ok(response.body.authToken);
    assert.ok(database.rows[0].consumed_at);
  } finally {
    global.fetch = originalFetch;
    Object.entries(originalEnv).forEach(([name, value]) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
});
