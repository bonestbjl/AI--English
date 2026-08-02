const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const learningData = require("../api/learning-data");

const PHONE = "13062989950";
const AUTH_SECRET = "learning-data-test-secret";

function createAuthToken(phone = PHONE) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    phone,
    iat: now,
    exp: now + 600,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
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

test("learning-data load and phone-keyed upsert remain compatible with authToken", async () => {
  const originalEnv = {
    AUTH_TOKEN_SECRET: process.env.AUTH_TOKEN_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalFetch = global.fetch;
  const calls = [];
  process.env.AUTH_TOKEN_SECRET = AUTH_SECRET;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  global.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init });
    if (String(init.method || "GET").toUpperCase() === "GET") {
      return new Response(JSON.stringify([{
        phone: PHONE,
        data: { wordBook: ["ticket"] },
        updated_at: "2026-08-02T08:00:00.000Z",
      }]), { status: 200 });
    }
    return new Response(JSON.stringify([{
      phone: PHONE,
      data: JSON.parse(init.body).data,
      updated_at: "2026-08-02T08:01:00.000Z",
    }]), { status: 200 });
  };

  try {
    const loadResponse = createResponseRecorder();
    await learningData({
      method: "POST",
      body: { action: "load", phone: PHONE, authToken: createAuthToken() },
    }, loadResponse);
    assert.equal(loadResponse.statusCode, 200);
    assert.deepEqual(loadResponse.body.data.wordBook, ["ticket"]);
    assert.match(calls[0].input, /learning_data\?phone=eq\.13062989950/);

    const saveResponse = createResponseRecorder();
    await learningData({
      method: "POST",
      body: {
        action: "save",
        phone: PHONE,
        authToken: createAuthToken(),
        data: { wordBook: ["ticket", "map"] },
      },
    }, saveResponse);
    assert.equal(saveResponse.statusCode, 200);
    assert.match(calls[1].input, /learning_data\?on_conflict=phone/);
    assert.equal(calls[1].init.headers.Prefer, "resolution=merge-duplicates,return=representation");
    assert.deepEqual(JSON.parse(calls[1].init.body).data.wordBook, ["ticket", "map"]);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
