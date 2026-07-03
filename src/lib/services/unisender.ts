import "server-only";

/**
 * Unisender Go адаптер (отправка email).
 * Пока UNISENDER_API_KEY пуст — mock-режим: «отправляет» письмо, возвращая
 * фейковый message_id, чтобы движок рассылки работал целиком end-to-end.
 * С реальным ключом — вызывает Unisender Go API.
 *
 * Документация: https://godocs.unisender.ru/
 */

const API_KEY = process.env.UNISENDER_API_KEY;
const ENDPOINT = "https://go1.unisender.ru/ru/transactional/api/v1/email/send.json";

export const isUnisenderLive = Boolean(API_KEY);

export type SendResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
};

export async function sendEmail(input: {
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName?: string | null;
  subject: string;
  body: string; // plain-text / простой html
}): Promise<SendResult> {
  if (!isUnisenderLive) {
    // mock: имитируем успешную отправку
    return {
      ok: true,
      providerMessageId: `mock-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: API_KEY,
        message: {
          recipients: [{ email: input.toEmail, substitutions: {} }],
          body: { html: input.body.replace(/\n/g, "<br>") },
          subject: input.subject,
          from_email: input.fromEmail,
          from_name: input.fromName,
          // List-Unsubscribe добавляется провайдером/заголовками
        },
      }),
    });
    const data = await res.json();
    if (data?.status === "success" || data?.job_id || data?.emails) {
      return {
        ok: true,
        providerMessageId:
          data.job_id ?? data.emails?.[0]?.["email_id"] ?? String(Date.now()),
      };
    }
    return { ok: false, error: data?.message ?? "Unisender send failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
