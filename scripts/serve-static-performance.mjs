#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createGzip } from "node:zlib";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PERF_PORT || 4188);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = resolve(root, relativePath);
  if (!filePath.startsWith(`${root}${sep}`) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }
  const extension = extname(filePath).toLowerCase();
  const compressible = [".html", ".js", ".json", ".css", ".svg"].includes(extension);
  const immutable = /(?:app-[a-f0-9]{12}\.js|cover-[a-f0-9]{12}\.webp)$/.test(relativePath);
  response.setHeader("Content-Type", mimeTypes[extension] || "application/octet-stream");
  response.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : relativePath === "index.html" ? "no-cache" : "public, max-age=86400");
  response.setHeader("Vary", "Accept-Encoding");
  if (compressible && String(request.headers["accept-encoding"] || "").includes("gzip")) {
    response.setHeader("Content-Encoding", "gzip");
    createReadStream(filePath).pipe(createGzip({ level: 9 })).pipe(response);
    return;
  }
  response.setHeader("Content-Length", statSync(filePath).size);
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Performance static server listening on http://127.0.0.1:${port}`);
});
