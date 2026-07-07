
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
  const user = `Оффер компании: ${input.offer}\nЦелевая аудитория: ${input.targetAudience}\nСайт: ${input.websiteUrl ?? "—"}\n\nСгенерируй ${n} варианта холодного письма. Верни только JSON-массив.`;

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
}): Promise<string> {
  if (!isDeepseekLive) return mockReply();
  const system =
    "Ты — вежливый менеджер по продажам, ведёшь переписку с потенциальным клиентом по email на русском. Отвечай коротко, по делу, двигай к следующему шагу (созвон/расчёт). Не будь навязчивым.";
  const history = input.thread
    .map((m) => `${m.direction === "inbound" ? "Клиент" : "Мы"}: ${m.body}`)
    .join("\n");
  return callDeepseek(system, `Оффер: ${input.offer}\n\nПереписка:\n${history}\n\nНапиши следующий ответ.`);
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

// ── Контент-маркетинг: серия писем ──

export type PlannedStep = {
  stepIndex: number;
  topic: string;
  angle: string;
  dayOffset: number;
  includeCta: boolean;
  ctaLabel?: string;
};

type PlanSeriesInput = {
  topic: string;
  targetAudience: string;
  offer: string;
  totalSteps: number;
  frequencyDays: number;
};

export function mockPlanSeries(input: PlanSeriesInput): PlannedStep[] {
  return Array.from({ length: input.totalSteps }).map((_, i) => {
    const isLastTwo = i >= input.totalSteps - 2;
    return {
      stepIndex: i,
      topic:
        i === 0
          ? `Что делать при «${input.topic}»: первые шаги`
          : `«${input.topic}»: часть ${i + 1}`,
      angle: isLastTwo
        ? "Экспертный разбор + мягкое предложение обсудить ситуацию"
        : "Экспертный разбор, чистая польза без продажи",
      dayOffset: i * input.frequencyDays,
      includeCta: isLastTwo,
      ctaLabel: isLastTwo ? "Оставить заявку" : undefined,
    };
  });
}

/** Планирует последовательность писем для серии контент-маркетинга. */
export async function planContentSeries(input: PlanSeriesInput): Promise<PlannedStep[]> {
  if (!isDeepseekLive) return mockPlanSeries(input);

  const system =
    'Ты — эксперт по контент-маркетингу и email-стратегии для b2b. Планируешь серию образовательных писем: каждое — самостоятельная польза для читателя (экспертный разбор, чек-лист, кейс), НЕ реклама. Серия должна постепенно вести читателя к доверию и естественно подвести к обращению в компанию. Обычно мягкий CTA "оставить заявку" уместен только в последних 1-2 письмах серии, когда читатель уже получил ценность — но реши сам по контексту. Отвечай строго JSON-массивом объектов {stepIndex, topic, angle, dayOffset, includeCta, ctaLabel}, без markdown и пояснений.';
  const user = `Тема серии: ${input.topic}\nЦелевая аудитория: ${input.targetAudience}\nОффер компании (для контекста, не для рекламы в каждом письме): ${input.offer}\nВсего писем: ${input.totalSteps}\nЧастота: раз в ${input.frequencyDays} дней (dayOffset считать от 0 с этим шагом)\n\nСпланируй ${input.totalSteps} писем серии. Верни только JSON-массив.`;

  const text = await callDeepseek(system, user);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // падаем в общий catch ниже через явную ошибку, чтобы facade откатился в mock
  }
  throw new DeepseekError("DeepSeek вернул не-JSON план серии");
}

export type DraftedEmail = { subject: string; bodyText: string; imagePrompt: string };

type DraftEmailInput = {
  topic: string;
  angle: string;
  offer: string;
  includeCta: boolean;
  ctaLabel?: string;
};

export function mockDraftEmail(input: DraftEmailInput): DraftedEmail {
  return {
    subject: input.topic,
    bodyText: `${input.topic}\n\nЭто пример текста статьи для серии контент-маркетинга (mock-режим, добавьте DEEPSEEK_API_KEY для реальной генерации). Здесь был бы содержательный экспертный разбор темы «${input.topic}» — ${input.angle}.${input.includeCta ? `\n\nЕсли тема откликается — оставьте заявку, обсудим вашу ситуацию.` : ""}`,
    imagePrompt: `flat digital illustration about "${input.topic}", business context, mint and indigo palette, clean modern style`,
  };
}

/** Пишет полный текст письма серии + промпт для иллюстрации (картинку рисует fal.ai, не LLM). */
export async function draftContentEmail(input: DraftEmailInput): Promise<DraftedEmail> {
  if (!isDeepseekLive) return mockDraftEmail(input);

  const system =
    'Ты — эксперт-копирайтер контент-маркетинга. Пишешь образовательные email-статьи на русском: конкретная польза, примеры, без "воды" и без рекламного тона. 300-500 слов, абзацы разделяй двойным переносом строки (\\n\\n). Если includeCta=true — в конце мягко, одной фразой, предложи обсудить ситуацию/оставить заявку (без давления и капслока). Также предложи imagePrompt — короткое (1-2 предложения) описание ИЛЛЮСТРАЦИИ на английском для AI-художника, в стиле flat digital illustration, деловая тематика, без текста на картинке. Отвечай строго JSON {subject, bodyText, imagePrompt}, без markdown и пояснений.';
  const user = `Тема письма: ${input.topic}\nРакурс: ${input.angle}\nОффер компании (контекст): ${input.offer}\nВключить CTA: ${input.includeCta ? `да, текст кнопки "${input.ctaLabel}"` : "нет"}\n\nНапиши письмо. Верни только JSON.`;

  const text = await callDeepseek(system, user);
  try {
    const parsed = JSON.parse(text);
    if (parsed.subject && parsed.bodyText) return parsed;
  } catch {
    // см. ниже
  }
  throw new DeepseekError("DeepSeek вернул не-JSON текст письма");
}

export function mockPersonalNudge(input: { topic: string; contactName?: string | null }): string {
  const name = input.contactName ? `${input.contactName}, ` : "";
  return `Здравствуйте, ${name}заметил, что вам интересна серия про «${input.topic}» — готов обсудить вашу ситуацию лично, если удобно. [mock-режим]`;
}

/** Персональное касание для контакта с высоким open rate по ходу серии. */
export async function generatePersonalNudge(input: {
  topic: string;
  offer: string;
  contactName?: string | null;
}): Promise<string> {
  if (!isDeepseekLive) return mockPersonalNudge(input);
  const system =
    "Ты — менеджер по продажам. Контакт активно читает (открывает) серию образовательных писем на заданную тему — значит, тема ему актуальна. Напиши короткое (3-5 предложений) тёплое ЛИЧНОЕ письмо на русском от первого лица, без шаблонных фраз массовой рассылки: сошлись на то, что тема явно откликается, предложи короткий созвон или разбор именно его ситуации. Без давления, без канцелярита.";
  const user = `Тема серии: ${input.topic}\nОффер компании: ${input.offer}\nИмя контакта: ${input.contactName ?? "неизвестно, обращайся без имени"}\n\nНапиши письмо (только текст, без темы).`;
  return callDeepseek(system, user);
}
