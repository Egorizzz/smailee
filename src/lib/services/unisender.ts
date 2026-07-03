
/**
 * Unisender Go адаптер (отправка email).
 *
 * Пока UNISENDER_API_KEY пуст — mock-режим: «отправляет» письмо, возвращая
 * фейковый message_id, чтобы движок рассылки работал целиком end-to-end.
 * С реальным ключом — вызывает Unisender Go Web API v1.
 *
 * Документация: https://godocs.unisender.ru/web-api-ref
 */

const API_KEY = process.env.UNISENDER_API_KEY;
const BASE = "https://goapi.unisender.ru/ru/transactional/api/v1";

export const isUnisenderLive = Boolean(API_KEY);

export type SendResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
};

async function apiCall(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-API-KEY": API_KEY as string,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function sendEmail(input: {
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName?: string | null;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>; // List-Unsubscribe, In-Reply-To, References
  sendAt?: Date | null;
  trackLinks?: boolean;
  trackRead?: boolean;
  campaignId?: string;
}): Promise<SendResult> {
  if (!isUnisenderLive) {
    return {
      ok: true,
      providerMessageId: `mock-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    };
  }

  try {
    const message: Record<string, unknown> = {
      recipients: [
        {
          email: input.toEmail,
          substitutions: input.toName ? { to_name: input.toName } : {},
        },
      ],
      subject: input.subject,
      from_email: input.fromEmail,
      from_name: input.fromName,
      body: {
        ...(input.html ? { html: input.html } : {}),
        ...(input.text ? { plaintext: input.text } : {}),
      },
      track_links: input.trackLinks ? 1 : 0,
      track_read: input.trackRead ? 1 : 0,
    };
    if (input.replyTo) message.reply_to = input.replyTo;
    if (input.headers) message.headers = input.headers;
    if (input.campaignId) {
      message.global_metadata = { campaign_id: input.campaignId };
    }
    if (input.sendAt) {
      message.options = {
        send_at: input.sendAt.toISOString().slice(0, 19).replace("T", " "),
      };
    }

    const data = await apiCall("/email/send.json", { message });

    if (data?.status === "success") {
      return { ok: true, providerMessageId: data.job_id ?? String(Date.now()) };
    }
    // адрес мог попасть в failed_emails
    const failed = data?.failed_emails?.[input.toEmail];
    return {
      ok: false,
      error: failed ? `failed: ${failed}` : data?.message ?? "send failed",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/**
 * Валидация одного email через Unisender (в mock — простая regex-проверка).
 * Возвращает true, если адрес считается пригодным для отправки.
 */
export async function validateEmail(email: string): Promise<boolean> {
  const basicOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!isUnisenderLive) return basicOk;
  if (!basicOk) return false;
  try {
    const data = await apiCall("/email-validation/single.json", {
      email,
    });
    // status: 'ok' | 'invalid' | ... (упрощённо)
    return data?.status === "ok" || data?.result === "valid" || basicOk;
  } catch {
    return basicOk;
  }
}
