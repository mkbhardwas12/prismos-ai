import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

const ROUTES = new Map([
  ["/", ["public/index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["public/index.html", "text/html; charset=utf-8"]],
  ["/app.css", ["public/app.css", "text/css; charset=utf-8"]],
  ["/app.js", ["public/app.js", "text/javascript; charset=utf-8"]],
  ["/lib/core.mjs", ["lib/core.mjs", "text/javascript; charset=utf-8"]],
]);

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'self'",
    "connect-src 'none'",
    "font-src 'self'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function send(
  res,
  status,
  body,
  contentType = "text/plain; charset=utf-8",
  method = "GET",
  extraHeaders = {},
) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...extraHeaders, "Content-Type": contentType });
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

export function createServer() {
  return createHttpServer(async (req, res) => {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      send(
        res,
        405,
        "Method not allowed",
        "text/plain; charset=utf-8",
        method,
        { Allow: "GET, HEAD" },
      );
      return;
    }

    let pathname;
    try {
      pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      send(res, 400, "Bad request", "text/plain; charset=utf-8", method);
      return;
    }

    if (pathname === "/health") {
      send(
        res,
        200,
        JSON.stringify({ ok: true, service: "repo-launch-night" }),
        "application/json; charset=utf-8",
        method,
      );
      return;
    }

    const route = ROUTES.get(pathname);
    if (!route) {
      send(res, 404, "Not found", "text/plain; charset=utf-8", method);
      return;
    }

    const [relativePath, contentType] = route;
    const filePath = join(ROOT, relativePath);
    try {
      await access(filePath);
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": contentType });
      if (method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(filePath).pipe(res);
    } catch {
      send(res, 500, "Launch room asset is missing", "text/plain; charset=utf-8", method);
    }
  });
}

function parsePort(value) {
  const port = Number.parseInt(value ?? "4179", 10);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 4179;
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  const host = "127.0.0.1";
  const port = parsePort(process.env.REPO_NIGHT_PORT);
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`Repo Launch Night is ready at http://${host}:${port}`);
    console.log("Nothing is posted or sent automatically. Press Ctrl+C to stop.");
  });
}
