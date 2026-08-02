import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";

import { createServer } from "../server.mjs";

let server;
let address;

before(async () => {
  server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  address = server.address();
});

after(async () => {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

function request(path, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: "127.0.0.1",
      port: address.port,
      method,
      path,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.once("error", reject);
    req.end();
  });
}

function assertSecurityHeaders(headers) {
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.match(headers["content-security-policy"], /default-src 'self'/);
  assert.match(headers["content-security-policy"], /connect-src 'none'/);
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
}

test("GET serves the health check and applies local-only security headers", async () => {
  const response = await request("/health?probe=1");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /^application\/json/);
  assert.deepEqual(JSON.parse(response.body), { ok: true, service: "repo-launch-night" });
  assertSecurityHeaders(response.headers);
});

test("GET serves only the allowlisted application assets with correct media types", async (t) => {
  const routes = [
    ["/", /^text\/html/, /Repo Launch Night/],
    ["/index.html", /^text\/html/, /repo-form/],
    ["/app.css", /^text\/css/, /night-shell/],
    ["/app.js?cache-bust=1", /^text\/javascript/, /parseRepoReferences/],
    ["/lib/core.mjs", /^text\/javascript/, /export const DIMENSIONS/],
  ];

  for (const [path, type, content] of routes) {
    await t.test(path, async () => {
      const response = await request(path);
      assert.equal(response.status, 200);
      assert.match(response.headers["content-type"], type);
      assert.match(response.body, content);
      assertSecurityHeaders(response.headers);
    });
  }
});

test("HEAD mirrors successful GET status and headers without returning a body", async () => {
  for (const path of ["/", "/app.css", "/app.js", "/lib/core.mjs", "/health"]) {
    const response = await request(path, "HEAD");
    assert.equal(response.status, 200, path);
    assert.equal(response.body, "", path);
    assert.ok(response.headers["content-type"], path);
    assertSecurityHeaders(response.headers);
  }
});

test("unknown GET and HEAD routes return a plain 404 without a body for HEAD", async () => {
  const get = await request("/missing");
  assert.equal(get.status, 404);
  assert.equal(get.body, "Not found");
  assert.match(get.headers["content-type"], /^text\/plain/);
  assertSecurityHeaders(get.headers);

  const head = await request("/missing", "HEAD");
  assert.equal(head.status, 404);
  assert.equal(head.body, "");
  assertSecurityHeaders(head.headers);
});

test("unsupported methods return 405 and advertise the accepted methods", async () => {
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
    const response = await request("/health", method);
    assert.equal(response.status, 405, method);
    assert.equal(response.body, "Method not allowed", method);
    assert.equal(response.headers.allow, "GET, HEAD", method);
    assertSecurityHeaders(response.headers);
  }
});

test("path traversal and encoded traversal attempts cannot escape the route allowlist", async () => {
  const attempts = [
    "/../server.mjs",
    "/%2e%2e/server.mjs",
    "/%2E%2E%2Fserver.mjs",
    "/..%2fserver.mjs",
    "/lib/../../server.mjs",
    "/lib/%2e%2e/server.mjs",
    "/%252e%252e%252fserver.mjs",
    "//etc/passwd",
    "/public/index.html",
  ];

  for (const path of attempts) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body, "Not found", path);
    assert.doesNotMatch(response.body, /createReadStream|createHttpServer|node:fs/);
    assertSecurityHeaders(response.headers);
  }
});
