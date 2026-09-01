import { createPublicKey, type JsonWebKey as NodeJsonWebKey } from "node:crypto";
import { request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { rootCertificates } from "node:tls";
import jwt from "jsonwebtoken";
import { config } from "@/lib/config";
import { RUSSIAN_TRUSTED_ROOT_CA } from "@/lib/services/russianTrustedRootCa";

const REQUEST_TIMEOUT_MS = 20_000;
const PUBLIC_KEY_CACHE_MS = 24 * 60 * 60_000;
const tochkaHttpsAgent = new HttpsAgent({
  keepAlive: true,
  ca: [...rootCertificates, RUSSIAN_TRUSTED_ROOT_CA],
});

type NodeRequest = (
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

async function trustedRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
) {
  const target = new URL(url);
  const timeoutMs = init.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const transport = (target.protocol === "https:" ? httpsRequest : httpRequest) as NodeRequest;
  return new Promise<{ ok: boolean; status: number; text: string }>((resolve, reject) => {
    const request = transport(
      target,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        ...(target.protocol === "https:" ? { agent: tochkaHttpsAgent } : {}),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.setTimeout(timeoutMs, () => {
      const error = Object.assign(new Error(`Payment provider request timed out after ${timeoutMs} ms`), {
        code: "ETIMEDOUT",
      });
      request.destroy(error);
    });
    request.on("error", reject);
    if (init.body) request.write(init.body);
    request.end();
  });
}

type ReceiptInput = {
  amountRub: number;
  buyerEmail: string;
  buyerName?: string | null;
  paymentId: string;
  planName: string;
  successUrl: string;
  failUrl: string;
  ttlMinutes?: number;
};

type PaymentLinkResult = {
  operationId: string;
  paymentLink: string;
  consumerId?: string;
};

export type TochkaPaymentWebhook = {
  webhookType: "acquiringInternetPayment";
  status: "APPROVED" | "AUTHORIZED" | string;
  operationId: string;
  paymentLinkId?: string;
  consumerId?: string;
  customerCode?: string;
  merchantId?: string;
  amount?: string;
  paymentType?: string;
  purpose?: string;
};

export class TochkaApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TochkaApiError";
  }
}

function credentials() {
  const { jwtToken, clientId, customerCode, merchantId } = config.tochka;
  if (!jwtToken || !clientId || !customerCode || !merchantId) {
    throw new TochkaApiError("PAY-CONFIG", "Payment provider is not configured");
  }
  return { jwtToken, clientId, customerCode, merchantId };
}

export function isTochkaConfigured() {
  const { jwtToken, clientId, customerCode, merchantId } = config.tochka;
  return Boolean(jwtToken && clientId && customerCode && merchantId);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { jwtToken } = credentials();
  try {
    const body = typeof init.body === "string" ? init.body : undefined;
    const response = await trustedRequest(`${config.tochka.apiBaseUrl}${path}`, {
      method: init.method,
      body,
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const text = response.text;
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      throw new TochkaApiError(
        `PAY-PROVIDER-${response.status}`,
        `Payment provider returned ${response.status}: ${typeof payload === "string" ? payload.slice(0, 300) : JSON.stringify(payload).slice(0, 500)}`,
        response.status,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof TochkaApiError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const networkCode = typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "UNKNOWN";
    throw new TochkaApiError(
      `PAY-NETWORK-${networkCode}`,
      `Payment provider request failed: ${message}`,
      undefined,
      error,
    );
  }
}

function receiptData(input: ReceiptInput) {
  const { customerCode, merchantId } = credentials();
  const amount = input.amountRub;
  return {
    customerCode,
    merchantId,
    amount,
    purpose: `Доступ к Smailee, тариф «${input.planName}»`,
    paymentLinkId: input.paymentId,
    redirectUrl: input.successUrl,
    failRedirectUrl: input.failUrl,
    taxSystemCode: "usn_income",
    Client: {
      email: input.buyerEmail,
      ...(input.buyerName ? { name: input.buyerName } : {}),
    },
    Items: [
      {
        name: `Доступ к Smailee, тариф «${input.planName}»`,
        amount,
        quantity: 1,
        vatType: "none",
        paymentMethod: "full_payment",
        paymentObject: "service",
        measure: "шт.",
      },
    ],
  };
}

function parsePaymentLink(payload: { Data?: Partial<PaymentLinkResult> }): PaymentLinkResult {
  const data = payload.Data;
  if (!data?.operationId || !data.paymentLink) {
    throw new TochkaApiError("PAY-RESPONSE", "Payment provider returned an incomplete payment link");
  }
  return {
    operationId: data.operationId,
    paymentLink: data.paymentLink,
    consumerId: data.consumerId,
  };
}

export async function createOneTimePayment(input: ReceiptInput): Promise<PaymentLinkResult> {
  const payload = await request<{ Data?: Partial<PaymentLinkResult> }>(
    "/acquiring/v1.0/payments_with_receipt",
    {
      method: "POST",
      body: JSON.stringify({
        Data: {
          ...receiptData(input),
          ...(input.ttlMinutes ? { ttl: input.ttlMinutes } : {}),
          paymentMode: ["card", "sbp"],
        },
      }),
    },
  );
  return parsePaymentLink(payload);
}

export async function createSubscription(input: ReceiptInput): Promise<PaymentLinkResult> {
  const payload = await request<{ Data?: Partial<PaymentLinkResult> }>(
    "/acquiring/v1.0/subscriptions_with_receipt",
    {
      method: "POST",
      body: JSON.stringify({ Data: { ...receiptData(input), recurring: true } }),
    },
  );
  return parsePaymentLink(payload);
}

export async function chargeSubscription(operationId: string, amountRub: number) {
  return request<{ Data?: { result?: boolean } }>(
    `/acquiring/v1.0/subscriptions/${encodeURIComponent(operationId)}/charge`,
    { method: "POST", body: JSON.stringify({ Data: { amount: amountRub } }) },
  );
}

export async function cancelProviderSubscription(operationId: string) {
  return request<unknown>(
    `/acquiring/v1.0/subscriptions/${encodeURIComponent(operationId)}/status`,
    { method: "POST", body: JSON.stringify({ Data: { status: "Cancelled" } }) },
  );
}

export async function ensurePaymentWebhook(url: string) {
  const { clientId } = credentials();
  const path = `/webhook/v1.0/${encodeURIComponent(clientId)}`;
  const desired = { webhooksList: ["acquiringInternetPayment"], url };
  try {
    const current = await request<{ Data?: { webhooksList?: string[]; url?: string } }>(path);
    if (
      current.Data?.url === url &&
      current.Data.webhooksList?.includes("acquiringInternetPayment")
    ) {
      return current;
    }
    return request<unknown>(path, { method: "POST", body: JSON.stringify(desired) });
  } catch (error) {
    if (error instanceof TochkaApiError && error.status === 404) {
      return request<unknown>(path, { method: "PUT", body: JSON.stringify(desired) });
    }
    throw error;
  }
}

let cachedPublicKey: { key: ReturnType<typeof createPublicKey>; expiresAt: number } | null = null;

async function webhookPublicKey() {
  if (cachedPublicKey && cachedPublicKey.expiresAt > Date.now()) return cachedPublicKey.key;
  const response = await trustedRequest(config.tochka.publicKeyUrl, { timeoutMs: 10_000 });
  if (!response.ok) {
    throw new TochkaApiError("PAY-WEBHOOK-KEY", `Webhook key request returned ${response.status}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(response.text);
  } catch (error) {
    throw new TochkaApiError("PAY-WEBHOOK-KEY", "Webhook public key is not valid JSON", response.status, error);
  }
  const keySet = body as { keys?: NodeJsonWebKey[] };
  const jwk = Array.isArray(keySet?.keys) ? keySet.keys[0] : (body as NodeJsonWebKey);
  if (!jwk || jwk.kty !== "RSA") {
    throw new TochkaApiError("PAY-WEBHOOK-KEY", "Webhook public key is invalid");
  }
  const key = createPublicKey({ key: jwk, format: "jwk" });
  cachedPublicKey = { key, expiresAt: Date.now() + PUBLIC_KEY_CACHE_MS };
  return key;
}

export async function verifyPaymentWebhook(rawToken: string): Promise<TochkaPaymentWebhook> {
  const key = await webhookPublicKey();
  const payload = jwt.verify(rawToken.trim(), key, { algorithms: ["RS256"] });
  if (!payload || typeof payload === "string") {
    throw new TochkaApiError("PAY-WEBHOOK-PAYLOAD", "Webhook payload is invalid");
  }
  return payload as TochkaPaymentWebhook;
}
