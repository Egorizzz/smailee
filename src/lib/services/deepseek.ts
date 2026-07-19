
/**
 * DeepSeek адаптер (OpenAI-совместимый Chat Completions API).
 * Пока DEEPSEEK_API_KEY пуст — работает в mock-режиме (осмысленные фейковые
 * ответы), не ломая сценарии. Как только ключ появится в .env — включается
 * реальный вызов API без изменений в вызывающем коде.
 *
 * Если реальный вызов падает (нет баланса, сеть, 5xx) — бросаем DeepseekError,
 * чтобы вызывающий код (src/lib/services/llm.ts) мог откатиться в mock и
 * показать пользователю уведомление, вместо падения всего запроса.
 *
 * Документация: https://api-docs.deepseek.com
 */

const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = "deepseek-chat";

export const isDeepseekLive = Boolean(API_KEY);

export class DeepseekError extends Error {}

type GenerateEmailInput = {
  offer: string;
  targetAudience: string;
  websiteUrl?: string | null;
  variants?: number;
  /**
   * Замечания пользователя к предыдущей генерации («короче», «убери canned-фразы»,
   * «добавь про сроки»). Без них перегенерация — это просто новая случайная
   * попытка: текст меняется, но ровно та же претензия остаётся.
   */
  feedback?: string | null;
  /** Что именно правим — чтобы модель улучшала, а не сочиняла с нуля. */
  previous?: { subject: string; body: string } | null;
  /** Сегмент базы, под который пишем (у каждого своя боль и язык). */
  segment?: string | null;
};

async function callDeepseek(system: string, user: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (err) {
    throw new DeepseekError(
      `Не удалось связаться с DeepSeek: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    throw new DeepseekError(`DeepSeek API error: ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export function mockEmailVariants(
  input: GenerateEmailInput,
  reason: string
): { subject: string; body: string }[] {
  const n = input.variants ?? 2;
  return Array.from({ length: n }).map((_, i) => ({
    subject:
      i === 0
        ? "Быстрый вопрос про вашу лидогенерацию"
        : "Идея, как получать больше ответов из холодной базы",
    body: `Здравствуйте!\n\nЗаметил, что вы работаете в сфере «${input.targetAudience}». Мы помогаем таким компаниям получать больше ответов из холодных email-рассылок — без найма отдельного маркетолога.\n\n${input.offer}\n\nБудет уместно показать, как это может сработать у вас? Займёт 10 минут.\n\n— Команда${input.websiteUrl ? ` (${input.websiteUrl})` : ""}\n\n[вариант ${i + 1} · ${reason}]`,
  }));
}

/** Генерация вариантов холодного письма под оффер клиента. */
export async function generateEmailVariants(
  input: GenerateEmailInput
): Promise<{ subject: string; body: string }[]> {
  if (!isDeepseekLive) {
    return mockEmailVariants(
      input,
      "сгенерировано в mock-режиме, добавьте DEEPSEEK_API_KEY для реальной генерации"
    );
  }

  const n = input.variants ?? 2;
  const system =
    "Ты — эксперт по холодным b2b email-рассылкам. Пишешь короткие персональные письма на русском, которые звучат как личное сообщение, а не массовая рассылка. Отвечай строго в формате JSON-массива объектов {subject, body}, без markdown-разметки и пояснений.";
  const user = [
    `Оффер компании: ${input.offer}`,
    `Целевая аудитория: ${input.targetAudience}`,
    `Сайт: ${input.websiteUrl ?? "—"}`,
    input.segment ? `Сегмент базы, под который пишем: ${input.segment}` : null,
    input.previous
      ? `\nПредыдущий вариант, который нужно доработать:\nТема: ${input.previous.subject}\nТекст: ${input.previous.body}`
      : null,
    input.feedback
      ? `\nЗамечания, которые обязательно учесть: ${input.feedback}\nПерепиши с учётом замечаний, сохранив то, что в них не оспаривается.`
      : null,
    `\nСгенерируй ${n} варианта холодного письма. Верни только JSON-массив.`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = await callDeepseek(system, user);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fallback: одно письмо целиком
  }
  return [{ subject: "Письмо", body: text }];
}

export function mockReply(): string {
  return "Спасибо за ответ! Подскажите, какая задача сейчас в приоритете — и я подготовлю конкретное предложение. [mock-режим]";
}

/** Ответ AI на входящее письмо клиента (ведение диалога). */
export async function generateReply(input: {
  offer: string;
  thread: { direction: string; body: string }[];
  /**
   * Инструкция клиента по воронке: тон, что предлагать, куда вести, что НЕ
   * обещать. Без неё ИИ отвечает «вообще правильно», но мимо реального
   * процесса продаж — например, зовёт на созвон там, где сначала нужен бриф.
   */
  funnelPrompt?: string | null;
}): Promise<string> {
  if (!isDeepseekLive) return mockReply();
  const system = [
    "Ты — вежливый менеджер по продажам, ведёшь переписку с потенциальным клиентом по email на русском. Отвечай коротко, по делу, двигай к следующему шагу (созвон/расчёт). Не будь навязчивым.",
    input.funnelPrompt
      ? `\nИнструкция компании — соблюдай её строго, она приоритетнее общих правил выше:\n${input.funnelPrompt}`
      : "",
  ].join("");
  const history = input.thread
    .map((m) => `${m.direction === "inbound" ? "Клиент" : "Мы"}: ${m.body}`)
    .join("\n");
  return callDeepseek(system, `Оффер: ${input.offer}\n\nПереписка:\n${history}\n\nНапиши следующий ответ.`);
}

/**
 * Составляет инструкцию по воронке из выгрузки реальных диалогов клиента.
 * Написать такую инструкцию с нуля тяжело — а примеры переписки у отдела
 * продаж уже есть; ИИ вытаскивает из них закономерности, человек правит.
 */
export async function deriveFunnelPrompt(dialogs: string): Promise<string> {
  if (!isDeepseekLive) {
    return [
      "Отвечай в деловом, но живом тоне — без канцелярита.",
      "Сначала уточни задачу и объём, только потом предлагай созвон.",
      "Не называй точную цену в письме — она зависит от объёма.",
      "Если клиент не готов сейчас — предложи вернуться позже, не дави.",
      "",
      "[черновик составлен в демо-режиме: добавьте DEEPSEEK_API_KEY, чтобы построить инструкцию по вашим диалогам]",
    ].join("\n");
  }
  const system =
    "Ты анализируешь переписку отдела продаж и составляешь инструкцию для ИИ-ассистента, который будет отвечать клиентам вместо менеджера. Выдай короткий список правил на русском: тон, что предлагать, куда вести клиента, что НЕ обещать. Только правила, без вступлений и пояснений.";
  return callDeepseek(
    system,
    `Примеры переписки с клиентами:\n\n${dialogs.slice(0, 12000)}\n\nСоставь инструкцию.`
  );
}

/**
 * Уточняет соответствие колонок таблицы полям контакта. Эвристика
 * (guessMapping) отрабатывает первой и в большинстве случаев достаточна —
 * ИИ зовут только на неопознанные колонки, чтобы не тратить вызов впустую.
 * Возвращает частичное соответствие: индекс колонки → поле.
 */
export async function suggestFieldMapping(input: {
  headers: string[];
  sampleRows: string[][];
}): Promise<Record<number, string>> {
  if (!isDeepseekLive) return {};
  const system =
    'Ты сопоставляешь колонки таблицы с полями карточки контакта. Верни строго JSON-объект вида {"0":"email","1":"name"} — ключ это индекс колонки, значение одно из: email, name, company, segment, skip. Без markdown и пояснений.';
  const preview = [
    `Заголовки: ${JSON.stringify(input.headers)}`,
    "Примеры строк:",
    ...input.sampleRows.slice(0, 5).map((r) => JSON.stringify(r)),
  ].join("\n");
  const text = await callDeepseek(system, preview);
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Предлагает разбиение базы на сегменты по содержимому (ниша, тип бизнеса).
 * Нужно, когда в файле колонки сегмента нет вовсе, а рассылать одинаковый
 * текст всем подряд — заведомо низкий отклик.
 *
 * Возвращает соответствие «компания/домен → сегмент»: ИИ размечает не каждую
 * строку (на базе в тысячи контактов это неподъёмно и дорого), а список
 * уникальных компаний, дальше сегмент проставляется по совпадению.
 */
export async function suggestSegments(input: {
  companies: string[];
}): Promise<Record<string, string>> {
  if (!isDeepseekLive) return {};
  const system =
    'Ты сегментируешь b2b-базу по сфере деятельности. Верни строго JSON-объект {"Название компании":"Сегмент"}, сегменты — короткие русские названия ниш (напр. "Стоматологии", "Юридические услуги", "Логистика"). Используй не больше 8 разных сегментов на всю базу. Без markdown и пояснений.';
  const text = await callDeepseek(
    system,
    `Компании:\n${input.companies.slice(0, 200).join("\n")}`
  );
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export type Qualification = "HOT" | "COLD" | "IRRELEVANT" | "UNKNOWN";

export function mockQualifyLead(thread: {
  direction: string;
  body: string;
}[]): { qualification: Qualification; summary: string } {
  const text = thread.map((m) => m.body).join(" ").toLowerCase();
  const hot = /цена|стоит|сколько|интерес|готов|давайте|созвон|отправьте/.test(text);
  return {
    qualification: hot ? "HOT" : "COLD",
    summary: hot
      ? "Клиент проявил интерес и спрашивает детали. [mock]"
      : "Пока без явного интереса. [mock]",
  };
}

/** Квалификация лида по переписке. */
export async function qualifyLead(input: {
  thread: { direction: string; body: string }[];
}): Promise<{ qualification: Qualification; summary: string }> {
  if (!isDeepseekLive) return mockQualifyLead(input.thread);
  const system =
    'Ты квалифицируешь b2b-лида по переписке. Верни строго JSON {"qualification": "HOT|COLD|IRRELEVANT", "summary": "краткое резюме на русском"}, без markdown-разметки.';
  const history = input.thread
    .map((m) => `${m.direction === "inbound" ? "Клиент" : "Мы"}: ${m.body}`)
    .join("\n");
  const text = await callDeepseek(system, history);
  try {
    const parsed = JSON.parse(text);
    return {
      qualification: parsed.qualification ?? "UNKNOWN",
      summary: parsed.summary ?? "",
    };
  } catch {
    return { qualification: "UNKNOWN", summary: text.slice(0, 200) };
  }
}
