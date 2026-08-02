const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3001);
const API_DIR = path.join(__dirname, "api");
const ALIPAY_API_ROUTES = Object.freeze({
  "/api/alipay/create-order": path.join(API_DIR, "alipay", "create-order.js"),
  "/api/alipay/notify": path.join(API_DIR, "alipay", "notify.js"),
  "/api/alipay/order-status": path.join(API_DIR, "alipay", "order-status.js"),
});

function enhanceResponse(res) {
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };

  res.json = function (data) {
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify(data));
    return res;
  };

  res.send = function (data) {
    if (Buffer.isBuffer(data) || typeof data === "string") {
      res.end(data);
    } else {
      res.json(data);
    }
    return res;
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === "GET" || req.method === "HEAD") {
      resolve({});
      return;
    }

    let raw = "";
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;

      if (size > 1024 * 1024) {
        reject(new Error("request_body_too_large"));
        req.destroy();
        return;
      }

      raw += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      const contentType = String(req.headers["content-type"] || "")
        .split(";")[0]
        .trim()
        .toLowerCase();

      try {
        if (contentType === "application/json") {
          resolve(JSON.parse(raw));
          return;
        }

        if (contentType === "application/x-www-form-urlencoded") {
          resolve(Object.fromEntries(new URLSearchParams(raw)));
          return;
        }

        resolve(raw);
      } catch (error) {
        resolve({});
      }
    });

    req.on("error", reject);
  });
}

function resolveApiRoute(pathname) {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  const alipayApiFile = ALIPAY_API_ROUTES[normalizedPath];
  if (alipayApiFile) {
    return {
      apiFile: alipayApiFile,
      preserveRawBody: normalizedPath === "/api/alipay/notify",
    };
  }

  const match = pathname.match(/^\/api\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) return null;
  const endpoint = match[1];
  return {
    apiFile: path.join(API_DIR, `${endpoint}.js`),
    preserveRawBody: endpoint === "alipay-notify",
  };
}

function createApiServer() {
  return http.createServer(async (req, res) => {
    enhanceResponse(res);

    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      req.query = Object.fromEntries(requestUrl.searchParams.entries());

      const route = resolveApiRoute(requestUrl.pathname);

      if (!route) {
        res.status(404).json({ ok: false, error: "not_found" });
        return;
      }

      // Alipay notify must read the original raw POST stream itself
      // so signature verification receives the exact callback body.
      if (!route.preserveRawBody) {
        req.body = await readBody(req);
      }
      const { apiFile } = route;

      if (!fs.existsSync(apiFile)) {
        res.status(404).json({ ok: false, error: "api_not_found" });
        return;
      }

      const loaded = require(apiFile);
      const handler =
        typeof loaded === "function"
          ? loaded
          : typeof loaded.default === "function"
            ? loaded.default
            : null;

      if (!handler) {
        res.status(500).json({ ok: false, error: "invalid_api_handler" });
        return;
      }

      await handler(req, res);
    } catch (error) {
      console.error("API server error:", error);

      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: "server_error" });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });
}

const server = createApiServer();

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Real Scene English API listening on http://${HOST}:${PORT}`);
  });
}

module.exports = {
  ALIPAY_API_ROUTES,
  createApiServer,
  enhanceResponse,
  readBody,
  resolveApiRoute,
};
