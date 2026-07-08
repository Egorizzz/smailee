
/**
 * Unisender Go адаптер (отправка email + проверка домена отправки).
 *
 * Пока UNISENDER_API_KEY пуст — mock-режим: «отправляет» письмо, возвращая
 * фейковый message_id, чтобы движок рассылки работал целиком end-to-end.
 * С реальным ключом — вызывает Unisender Go Web API v1.
 *
 * Изоляция клиентов через Project: у Unisender Go есть суб-аккаунты
 * (Project) — у каждого свой API-ключ, свои домены и свой suppression-лист,
 * что не даёт проблеме одного клиента (жалобы/спам) задеть остальных. Project
 * создаётся вручную в ЛК Unisender (см. docs/unisender-project-setup.md),
 * т.к. API создания Project'ов по умолчанию отключён у Unisender. Поэтому
 * каждая функция здесь принимает необязательный `apiKey` — если он передан
 * (ключ Project'а конкретного клиента, User.unisenderApiKey), вызов уходит в
 * контекст этого Project'а; если нет — используется общий ключ аккаунта.
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

async function apiCall(path: string, body: Record<string, unknown>, apiKey?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-API-KEY": (apiKey || API_KEY) as string,
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
  apiKey?: string | null; // ключ Project'а клиента (User.unisenderApiKey), см. шапку файла
}): Promise<SendResult> {
  if (!isUnisenderLive && !input.apiKey) {
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

    const data = await apiCall("/email/send.json", { message }, input.apiKey ?? undefined);

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

export type DomainDnsRecord = {
  type: string;
  name: string;
  value: string;
};

export class DomainCheckError extends Error {}

/**
 * DNS-записи, которые Unisender ожидает для домена (verification-TXT, DKIM,
 * рекомендованный SPF) — чтобы показать клиенту, что прописать. Домен должен
 * быть заранее добавлен в ЛК Unisender (см. docs/unisender-project-setup.md,
 * API создания домена у Unisender не предусмотрен).
 *
 * ВАЖНО: точный формат ответа не подтверждён по документации (страница с
 * методом domain-get-dns-records не отдала полное описание) — при первом
 * реальном вызове проверить форму ответа и при необходимости поправить разбор.
 */
export async function getDomainDnsRecords(
  domain: string,
  apiKey: string
): Promise<DomainDnsRecord[]> {
  const data = await apiCall("/domain-get-dns-records.json", { domain }, apiKey);
  const records = data?.records ?? data?.result?.records ?? data?.dns_records;
  if (!Array.isArray(records)) {
    throw new DomainCheckError(
      data?.message ?? "Unisender не вернул DNS-записи для домена"
    );
  }
  return records.map((r: Record<string, unknown>) => ({
    type: String(r.type ?? r.record_type ?? ""),
    name: String(r.name ?? r.host ?? domain),
    value: String(r.value ?? r.content ?? ""),
  }));
}

/**
 * Показательные DNS-записи для домена (для карточки отправителя).
 * В live-режиме (есть ключ Project'а) — реальные записи от Unisender.
 * Без ключа — иллюстративные примеры с плейсхолдерами, чтобы клиент видел, что
 * именно предстоит прописать; реальные значения придут при подключённом Project.
 */
export async function expectedDnsRecords(
  domain: string,
  apiKey?: string | null
): Promise<{ records: DomainDnsRecord[]; live: boolean }> {
  if (apiKey || isUnisenderLive) {
    try {
      const records = await getDomainDnsRecords(domain, (apiKey || API_KEY) as string);
      return { records, live: true };
    } catch {
      // падаем в примеры ниже, чтобы UI не оставался пустым
    }
  }
  return {
    live: false,
    records: [
      {
        type: "TXT",
        name: domain,
        value: "v=spf1 include:_spf.unisender.ru ~all",
      },
      {
        type: "CNAME",
        name: `un1._domainkey.${domain}`,
        value: "un1.dkim.unisender.ru",
      },
      {
        type: "TXT",
        name: `_unisender.${domain}`,
        value: "unisender-verification=<код придёт при подключении Project>",
      },
      {
        type: "TXT",
        name: `_dmarc.${domain}`,
        value: "v=DMARC1; p=none; rua=mailto:dmarc@" + domain,
      },
    ],
  };
}

/**
 * Реальная проверка домена через Unisender (verification-record подтверждает
 * владение доменом, dkim — подпись писем). Отдельных методов проверки SPF/DMARC
 * у Unisender Web API нет — эти записи фиксированы/опциональны (см.
 * docs/unisender-project-setup.md), поэтому статус по ним не запрашивается.
 */
export async function checkDomainVerification(
  domain: string,
  apiKey: string
): Promise<{ ownershipOk: boolean; dkimOk: boolean }> {
  const isTruthy = (v: unknown) =>
    v === true || v === "ok" || v === "valid" || v === "verified" || v === "success";

  let ownership: Record<string, unknown>;
  let dkim: Record<string, unknown>;
  try {
    [ownership, dkim] = await Promise.all([
      apiCall("/domain-validate-verification-record.json", { domain }, apiKey),
      apiCall("/domain-validate-dkim.json", { domain }, apiKey),
    ]);
  } catch (e) {
    throw new DomainCheckError(
      e instanceof Error ? e.message : "Не удалось связаться с Unisender"
    );
  }

  return {
    ownershipOk: isTruthy(ownership?.status) || isTruthy(ownership?.result) || isTruthy(ownership?.verified),
    dkimOk: isTruthy(dkim?.status) || isTruthy(dkim?.result) || isTruthy(dkim?.verified),
  };
}
