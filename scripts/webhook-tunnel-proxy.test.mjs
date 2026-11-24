import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, request } from "node:http";
import { after, before, test } from "node:test";
import { createWebhookTunnelProxy } from "./webhook-tunnel-proxy.mjs";

const secret = "synthetic-app-secret";
const token = "synthetic-verify-token";
const path = "/api/webhooks/instagram";
const seen = [];
const origin = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  seen.push({ url: req.url, method: req.method, body, headers: req.headers });
  if (req.method === "GET") {
    const query = new URL(req.url, "http://localhost").searchParams;
    if (
      query.get("hub.mode") === "subscribe" &&
      query.get("hub.verify_token") === token
    ) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(query.get("hub.challenge"));
      return;
    }
    res.writeHead(403).end();
    return;
  }
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  res
    .writeHead(req.headers["x-hub-signature-256"] === expected ? 200 : 401)
    .end();
});
let originPort;
let proxy;
let proxyPort;
before(async () => {
  await new Promise((resolve) => origin.listen(0, "127.0.0.1", resolve));
  originPort = origin.address().port;
  proxy = createWebhookTunnelProxy({ port: 0, originPort });
  proxyPort = (await proxy.listen()).port;
});
after(async () => {
  await new Promise((resolve) => proxy.server.close(resolve));
  await new Promise((resolve) => origin.close(resolve));
});
function send(method, rawPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: proxyPort,
        method,
        path: rawPath,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
test("GET forwards exact challenge without leaking the token in a response header", async () => {
  const query =
    "?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=123456";
  assert.deepEqual(await send("GET", path + query), {
    status: 200,
    body: "123456",
  });
  assert.equal(seen.at(-1).url, path + query);
});
test("POST preserves signed body bytes and required headers", async () => {
  const body = Buffer.from('{"text":"olá"}\n');
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(
    (
      await send("POST", path, body, {
        "content-type": "application/json",
        "x-hub-signature-256": signature,
        authorization: "should-not-forward",
      })
    ).status,
    200,
  );
  assert.deepEqual(seen.at(-1).body, body);
  assert.equal(seen.at(-1).headers.authorization, undefined);
  assert.equal(seen.at(-1).headers["x-hub-signature-256"], signature);
});
test("unsigned POST is rejected by the webhook origin", async () => {
  assert.equal(
    (await send("POST", path, "{}", { "content-type": "application/json" }))
      .status,
    401,
  );
});
test("all other paths return 404 without reaching the origin", async () => {
  for (const candidate of [
    "/",
    "/api/inngest",
    "/api/health",
    "/api/admin",
    "/dashboard",
    path + "/",
    path + "/../inngest",
    "/api/webhooks/%69nstagram",
    path + "%2f",
    "//api/webhooks/instagram",
  ]) {
    const count = seen.length;
    assert.equal((await send("GET", candidate)).status, 404, candidate);
    assert.equal(seen.length, count, candidate);
  }
});
test("other methods and oversized bodies do not reach the origin", async () => {
  const count = seen.length;
  assert.equal((await send("PUT", path)).status, 405);
  assert.equal(
    (await send("POST", path, Buffer.alloc(1024 * 1024 + 1))).status,
    413,
  );
  assert.equal(seen.length, count);
});
test("binds exclusively to loopback and shuts down", () => {
  assert.equal(proxy.server.address().address, "127.0.0.1");
});
