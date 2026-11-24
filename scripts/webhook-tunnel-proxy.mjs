import { createServer, request as httpRequest } from "node:http";

const HOST = "127.0.0.1";
const PORT = 3146;
const ORIGIN_PORT = 3145;
const PATH = "/api/webhooks/instagram";
const MAX_BODY = 1024 * 1024;
const MAX_URL = 2048;
const TIMEOUT_MS = 10_000;

function fail(response, status) {
  if (!response.headersSent) {
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Length": "0",
    });
  }
  response.end();
}

export function createWebhookTunnelProxy({
  port = PORT,
  originPort = ORIGIN_PORT,
} = {}) {
  const server = createServer(
    { maxHeaderSize: 8 * 1024 },
    async (incoming, outgoing) => {
      const rawUrl = incoming.url ?? "";
      const separator = rawUrl.indexOf("?");
      const rawPath = separator === -1 ? rawUrl : rawUrl.slice(0, separator);
      // Match raw bytes of the path before URL parsing or normalization.
      if (rawPath !== PATH || rawUrl.length > MAX_URL || rawUrl.includes("#")) {
        fail(outgoing, 404);
        return;
      }
      if (incoming.method !== "GET" && incoming.method !== "POST") {
        fail(outgoing, 405);
        return;
      }
      if (
        incoming.method === "GET" &&
        incoming.headers["content-length"] !== undefined
      ) {
        fail(outgoing, 400);
        return;
      }
      if (incoming.method === "POST") {
        const length = incoming.headers["content-length"];
        if (
          length !== undefined &&
          (!/^\d+$/.test(length) || Number(length) > MAX_BODY)
        ) {
          fail(outgoing, 413);
          return;
        }
      }

      let size = 0;
      const chunks = [];
      try {
        for await (const chunk of incoming) {
          size += chunk.length;
          if (size > MAX_BODY) {
            fail(outgoing, 413);
            return;
          }
          chunks.push(chunk);
        }
      } catch {
        fail(outgoing, 400);
        return;
      }
      if (incoming.method === "GET" && size !== 0) {
        fail(outgoing, 400);
        return;
      }
      const body = Buffer.concat(chunks, size);
      const headers = { host: `${HOST}:${originPort}` };
      if (incoming.method === "POST") {
        headers["content-length"] = String(body.length);
        if (incoming.headers["content-type"] !== undefined)
          headers["content-type"] = incoming.headers["content-type"];
        if (incoming.headers["x-hub-signature-256"] !== undefined)
          headers["x-hub-signature-256"] =
            incoming.headers["x-hub-signature-256"];
      }
      const upstream = httpRequest(
        {
          hostname: HOST,
          port: originPort,
          path: rawUrl,
          method: incoming.method,
          headers,
          agent: false,
          timeout: TIMEOUT_MS,
        },
        (result) => {
          const safeHeaders = { "Cache-Control": "no-store" };
          for (const name of ["content-type", "retry-after"])
            if (result.headers[name] !== undefined)
              safeHeaders[name] = result.headers[name];
          outgoing.writeHead(result.statusCode ?? 502, safeHeaders);
          result.pipe(outgoing);
        },
      );
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => fail(outgoing, 502));
      outgoing.on("close", () => upstream.destroy());
      upstream.end(body);
    },
  );
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, HOST, () => {
          server.off("error", reject);
          resolve(server.address());
        });
      }),
  };
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const proxy = createWebhookTunnelProxy();
  proxy
    .listen()
    .then(() => {
      process.stdout.write(`Webhook proxy ready on ${HOST}:${PORT}\n`);
    })
    .catch(() => {
      process.stderr.write("Webhook proxy startup failed\n");
      process.exitCode = 1;
    });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      proxy.server.close(() => {
        process.exitCode = 0;
      }),
    );
}
