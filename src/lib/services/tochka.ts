import { createPublicKey, type JsonWebKey as NodeJsonWebKey } from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "@/lib/config";

const REQUEST_TIMEOUT_MS = 20_000;
const PUBLIC_KEY_CACHE_MS = 24 * 60 * 60_000;

type ReceiptInput = {
  amountRub: number;
  buyerEmail: string;
  buyerName?: string | null;
  paymentId: string;
  planName: string;
  successUrl: string;
  failUrl: string;
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.tochka.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
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
    throw new TochkaApiError("PAY-NETWORK", `Payment provider request failed: ${message}`);
  } finally {
    clearTimeout(timer);
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
  const response = await fetch(config.tochka.publicKeyUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new TochkaApiError("PAY-WEBHOOK-KEY", `Webhook key request returned ${response.status}`);
  }
  const body = (await response.json()) as unknown;
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
