import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const root = resolve("/app/public");
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    return response.end();
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  } catch {
    response.writeHead(400);
    return response.end();
  }
  if (pathname.includes("\0") || pathname.includes("\\")) {
    response.writeHead(400);
    return response.end();
  }

  const requested = resolve(root, "." + pathname);
  if (requested !== root && !requested.startsWith(root + sep)) {
    response.writeHead(403);
    return response.end();
  }

  let file = requested;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = resolve(file, "index.html");
    if (!(await stat(file)).isFile()) throw new Error("not-file");
  } catch {
    file = resolve(root, "index.html");
  }

  const extension = extname(file).toLowerCase();
  const indexResponse = file === resolve(root, "index.html");
  response.setHeader("Content-Type", mime.get(extension) || "application/octet-stream");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cache-Control", indexResponse ? "no-store" : "public, max-age=31536000, immutable");
  if (request.method === "HEAD") {
    response.writeHead(200);
    return response.end();
  }
  createReadStream(file)
    .on("error", () => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    })
    .pipe(response);
}).listen(port, "0.0.0.0");
