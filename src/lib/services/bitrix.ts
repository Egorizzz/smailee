/**
 * Битрикс24 адаптер (передача лидов в CRM).
 *
 * Вебхук ИНДИВИДУАЛЕН для каждого клиента — это ссылка вида
 * https://<портал>.bitrix24.ru/rest/<user>/<token>/, по сути пароль от его
 * CRM. Раньше адрес брался из общей env BITRIX24_WEBHOOK_URL: в
 * многопользовательском продукте это означало бы, что лиды ВСЕХ клиентов
 * уезжают в один чужой портал. Поэтому глобальной переменной здесь больше
 * нет — вызывающий код передаёт расшифрованный вебхук конкретного клиента.
 *
 * Заодно ушёл mock-режим: он возвращал УСПЕХ при отсутствии ключа, и код по
 * этому успеху ставил Lead.pushedToCrm = true. То есть интерфейс показывал
 * «передан в CRM», хотя не уходило никуда и ничего — тихая ложь, из-за
 * которой такую передачу нельзя было считать проверенной (это было прямо
 * записано в docs/TESTPLAN.md как ограничение). Нет вебхука — нет передачи,
 * и это видно.
 *
 * Документация REST: https://apidocs.bitrix24.ru/
 *
 * НЕ импортирует "server-only": вызывается из standalone-воркера вне Next.
 */

/** Ответ Битрикса на REST-вызов (нас интересуют только эти поля). */
type BitrixResponse = {
  result?: unknown;
  error?: string;
  error_description?: string;
};

async function callBitrix(
  webhook: string,
  method: string,
  payload: Record<string, unknown>
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const url = `${webhook.replace(/\/$/, "")}/${method}.json`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Вызов идёт внутри обработки входящего письма в воркере — висеть на
      // недоступном портале нельзя, иначе встанет весь приём почты.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "network error";
    return { ok: false, error: `Не удалось связаться с Битрикс24: ${message}` };
  }

  let data: BitrixResponse;
  try {
    data = (await res.json()) as BitrixResponse;
  } catch {
    // Не-JSON — почти всегда HTML-страница про неверный или отозванный вебхук
    return {
      ok: false,
      error: `Битрикс24 ответил не-JSON (код ${res.status}) — проверьте ссылку вебхука`,
    };
  }

  if (data.error) return { ok: false, error: data.error_description || data.error };
  if (data.result === undefined) return { ok: false, error: "Битрикс24 вернул пустой ответ" };
  return { ok: true, result: data.result };
}

/**
 * Проверка вебхука перед сохранением — тот же принцип, что и валидация
 * почтового ящика при подключении (§5.1): не даём сохранить заведомо
 * нерабочий доступ, чтобы клиент узнал о проблеме сразу, а не когда первый
 * тёплый лид молча не уедет в CRM.
 *
 * profile — самый дешёвый метод, доступный любому вебхуку.
 */
export async function verifyBitrixWebhook(
  webhook: string
): Promise<{ ok: true; owner?: string } | { ok: false; error: string }> {
  const normalized = webhook.trim();
  if (!/^https:\/\/[^\s/]+\/rest\/[^\s]+$/.test(normalized.replace(/\/$/, ""))) {
    return {
      ok: false,
      error: "Ссылка не похожа на вебхук: ожидается вид https://ваш-портал.bitrix24.ru/rest/1/токен/",
    };
  }
  const res = await callBitrix(normalized, "profile", {});
  if (!res.ok) return res;
  const profile = res.result as { NAME?: string; LAST_NAME?: string } | null;
  const owner = [profile?.NAME, profile?.LAST_NAME].filter(Boolean).join(" ").trim();
  return { ok: true, owner: owner || undefined };
}

export type PushLeadInput = {
  title: string;
  name?: string | null;
  email?: string | null;
  comment?: string | null;
  /** Полная переписка — чтобы продавец видел контекст, не поднимая почту. */
  thread?: { direction: string; body: string }[];
  /** Наш ящик, с которого шёл диалог: продавцу отвечать нужно именно с него. */
  fromMailbox?: string | null;
};

/** Переписка в человекочитаемый вид для поля COMMENTS. */
function renderThread(thread: { direction: string; body: string }[]): string {
  return thread
    .map((m) => `${m.direction === "inbound" ? "Клиент" : "Мы"}: ${m.body.trim()}`)
    .join("\n\n");
}

/**
 * Создаёт лида в CRM клиента. Возвращает id созданной сущности — он
 * сохраняется в Lead.crmEntityId, иначе связь с CRM теряется и потом не
 * ответить на вопрос «этот лид уже в Битриксе, под каким номером?».
 */
export async function pushLead(
  webhook: string,
  input: PushLeadInput
): Promise<{ ok: true; crmId: string } | { ok: false; error: string }> {
  // Переписку кладём в COMMENTS намеренно, даже если у клиента подключён этот
  // же ящик внутри Битрикса и письма видны сами. Автоматическая привязка
  // зависит от трёх ручных настроек портала, которые мы не контролируем и не
  // можем проверить через API: окна синхронизации («обработать письма за...»),
  // опции «письма известных клиентов назначать ответственным» (без неё все
  // входящие валятся в один лид) и настроек создания лидов из писем. Одна
  // текстовая строка — дешёвая страховка, которая работает всегда.
  const comments = [
    input.comment?.trim() || "",
    input.thread?.length ? `\n\nПереписка:\n${renderThread(input.thread)}` : "",
    input.fromMailbox
      ? `\n\nДиалог вёлся с адреса ${input.fromMailbox} — отвечайте с него, чтобы письмо попало в тот же тред.`
      : "",
  ]
    .join("")
    .trim();

  const res = await callBitrix(webhook, "crm.lead.add", {
    fields: {
      TITLE: input.title,
      NAME: input.name ?? "",
      EMAIL: input.email ? [{ VALUE: input.email, VALUE_TYPE: "WORK" }] : [],
      COMMENTS: comments,
      SOURCE_ID: "WEB",
    },
  });
  if (!res.ok) return res;
  return { ok: true, crmId: String(res.result) };
}
