import http from "node:http";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";

export type FakeTochkaRequest = { method: string; path: string; body: unknown };

export type FakeTochka = {
  baseUrl: string;
  publicKeyUrl: string;
  requests: FakeTochkaRequest[];
  sign(payload: Record<string, unknown>): string;
  reset(): void;
  close(): Promise<void>;
};

export async function startFakeTochka(): Promise<FakeTochka> {
  const requests: FakeTochkaRequest[] = [];
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" });
  let webhook: { webhooksList: string[]; url: string } | null = null;
  let operation = 0;

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const path = req.url ?? "/";
      const method = req.method ?? "GET";
      let body: unknown = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (path === "/public-key") return send(200, publicJwk);
      if (req.headers.authorization !== "Bearer test-tochka-token") return send(401, { error: "unauthorized" });
      requests.push({ method, path, body });

      if (path === "/acquiring/v1.0/payments_with_receipt" && method === "POST") {
        operation++;
        return send(200, { Data: { operationId: `payment-${operation}`, paymentLink: `https://pay.test/${operation}` } });
      }
      if (path === "/acquiring/v1.0/subscriptions_with_receipt" && method === "POST") {
        operation++;
        return send(200, { Data: { operationId: `subscription-${operation}`, paymentLink: `https://pay.test/${operation}`, consumerId: "buyer-1" } });
      }
      if (/^\/acquiring\/v1\.0\/subscriptions\/[^/]+\/charge$/.test(path) && method === "POST") {
        return send(200, { Data: { result: true } });
      }
      if (/^\/webhook\/v1\.0\/[^/]+$/.test(path)) {
        if (method === "GET") return webhook ? send(200, { Data: webhook }) : send(404, { error: "not found" });
        if (method === "PUT" || method === "POST") {
          webhook = body as typeof webhook;
          return send(200, { Data: webhook });
        }
      }
      return send(404, { error: "not found" });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake Tochka: port unavailable");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    publicKeyUrl: `${baseUrl}/public-key`,
    requests,
    sign(payload) {
      return jwt.sign(payload, privateKey, { algorithm: "RS256" });
    },
    reset() {
      requests.length = 0;
      webhook = null;
      operation = 0;
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
