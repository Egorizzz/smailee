import "server-only";

/**
 * Битрикс24 адаптер (передача лидов).
 * Пока BITRIX24_WEBHOOK_URL пуст — mock-режим (логирует и возвращает успех).
 * С реальным webhook URL — создаёт лид через crm.lead.add.
 *
 * Webhook URL вида: https://<portal>.bitrix24.ru/rest/<user>/<token>/
 */

const WEBHOOK = process.env.BITRIX24_WEBHOOK_URL;

export const isBitrixLive = Boolean(WEBHOOK);

export async function pushLead(input: {
  title: string;
  name?: string | null;
  email?: string | null;
  comment?: string | null;
}): Promise<{ ok: boolean; crmId?: string; error?: string }> {
  if (!isBitrixLive) {
    console.log("[bitrix mock] pushLead:", input.title);
    return { ok: true, crmId: `mock-${Date.now()}` };
  }

  try {
    const url = `${WEBHOOK!.replace(/\/$/, "")}/crm.lead.add.json`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          TITLE: input.title,
          NAME: input.name ?? "",
          EMAIL: input.email
            ? [{ VALUE: input.email, VALUE_TYPE: "WORK" }]
            : [],
          COMMENTS: input.comment ?? "",
          SOURCE_ID: "WEB",
        },
      }),
    });
    const data = await res.json();
    if (data?.result) return { ok: true, crmId: String(data.result) };
    return { ok: false, error: data?.error_description ?? "Bitrix error" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
