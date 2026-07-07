
/**
 * Claude (Anthropic) адаптер.
 * Пока ANTHROPIC_API_KEY пуст — работает в mock-режиме (осмысленные фейковые
 * ответы), не ломая сценарии. Как только ключ появится в .env — включается
 * реальный вызов API без изменений в вызывающем коде.
 */

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-3-5-sonnet-latest";

export const isClaudeLive = Boolean(API_KEY);

export class ClaudeError extends Error {}

type GenerateEmailInput = {
  offer: string;
  targetAudience: string;
  websiteUrl?: string | null;
  variants?: number;
};

async function callClaude(system: string, user: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY as string,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
  } catch (err) {
    throw new ClaudeError(
      `Не удалось связаться с Anthropic: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    throw new ClaudeError(`Anthropic API error: ${res.status}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

/** Генерация вариантов холодного письма под оффер клиента. */
export async function generateEmailVariants(
  input: GenerateEmailInput
): Promise<{ subject: string; body: string }[]> {
  const n = input.variants ?? 2;

  if (!isClaudeLive) {
    // mock
    return Array.from({ length: n }).map((_, i) => ({
      subject:
        i === 0
          ? "Быстрый вопрос про вашу лидогенерацию"
          : "Идея, как получать больше ответов из холодной базы",
      body: `Здравствуйте!\n\nЗаметил, что вы работаете в сфере «${input.targetAudience}». Мы помогаем таким компаниям получать больше ответов из холодных email-рассылок — без найма отдельного маркетолога.\n\n${input.offer}\n\nБудет уместно показать, как это может сработать у вас? Займёт 10 минут.\n\n— Команда${input.websiteUrl ? ` (${input.websiteUrl})` : ""}\n\n[вариант ${i + 1} · сгенерировано в mock-режиме, добавьте ANTHROPIC_API_KEY для реальной генерации]`,
    }));
  }

  const system =
    "Ты — эксперт по холодным b2b email-рассылкам. Пишешь короткие персональные письма на русском, которые звучат как личное сообщение, а не массовая рассылка. Отвечай строго в формате JSON-массива объектов {subject, body}.";
  const user = `Оффер компании: ${input.offer}\nЦелевая аудитория: ${input.targetAudience}\nСайт: ${input.websiteUrl ?? "—"}\n\nСгенерируй ${n} варианта холодного письма. Верни только JSON-массив.`;

  const text = await callClaude(system, user);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fallback: одно письмо целиком
  }
  return [{ subject: "Письмо", body: text }];
}

/** Ответ AI на входящее письмо клиента (ведение диалога). */
export async function generateReply(input: {
  offer: string;
  thread: { direction: string; body: string }[];
}): Promise<string> {
  if (!isClaudeLive) {
    return "Спасибо за ответ! Подскажите, какая задача сейчас в приоритете — и я подготовлю конкретное предложение. [mock-режим]";
  }
  const system =
    "Ты — вежливый менеджер по продажам, ведёшь переписку с потенциальным клиентом по email на русском. Отвечай коротко, по делу, двигай к следующему шагу (созвон/расчёт). Не будь навязчивым.";
  const history = input.thread
    .map((m) => `${m.direction === "inbound" ? "Клиент" : "Мы"}: ${m.body}`)
    .join("\n");
  return callClaude(system, `Оффер: ${input.offer}\n\nПереписка:\n${history}\n\nНапиши следующий ответ.`);
}

export type Qualification = "HOT" | "COLD" | "IRRELEVANT" | "UNKNOWN";

/** Квалификация лида по переписке. */
export async function qualifyLead(input: {
  thread: { direction: string; body: string }[];
}): Promise<{ qualification: Qualification; summary: string }> {
  if (!isClaudeLive) {
    // простая эвристика для mock
    const text = input.thread.map((m) => m.body).join(" ").toLowerCase();
    const hot = /цена|стоит|сколько|интерес|готов|давайте|созвон|отправьте/.test(
      text
    );
    return {
      qualification: hot ? "HOT" : "COLD",
      summary: hot
        ? "Клиент проявил интерес и спрашивает детали. [mock]"
        : "Пока без явного интереса. [mock]",
    };
  }
  const system =
    'Ты квалифицируешь b2b-лида по переписке. Верни строго JSON {"qualification": "HOT|COLD|IRRELEVANT", "summary": "краткое резюме на русском"}.';
  const history = input.thread
    .map((m) => `${m.direction === "inbound" ? "Клиент" : "Мы"}: ${m.body}`)
    .join("\n");
  const text = await callClaude(system, history);
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

// ── Контент-маркетинг: серия писем (см. deepseek.ts — идентичная логика) ──

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

export async function planContentSeries(input: PlanSeriesInput): Promise<PlannedStep[]> {
  if (!isClaudeLive) return mockPlanSeries(input);
  const system =
    'Ты — эксперт по контент-маркетингу и email-стратегии для b2b. Планируешь серию образовательных писем: каждое — самостоятельная польза для читателя, НЕ реклама. Мягкий CTA "оставить заявку" уместен обычно только в последних 1-2 письмах. Отвечай строго JSON-массивом объектов {stepIndex, topic, angle, dayOffset, includeCta, ctaLabel}, без markdown.';
  const user = `Тема серии: ${input.topic}\nЦелевая аудитория: ${input.targetAudience}\nОффер компании: ${input.offer}\nВсего писем: ${input.totalSteps}\nЧастота: раз в ${input.frequencyDays} дней\n\nСпланируй ${input.totalSteps} писем серии. Верни только JSON-массив.`;
  const text = await callClaude(system, user);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // см. ниже
  }
  throw new ClaudeError("Claude вернул не-JSON план серии");
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
    bodyText: `${input.topic}\n\nЭто пример текста статьи для серии контент-маркетинга (mock-режим, добавьте ANTHROPIC_API_KEY для реальной генерации). Здесь был бы содержательный экспертный разбор темы «${input.topic}» — ${input.angle}.${input.includeCta ? `\n\nЕсли тема откликается — оставьте заявку, обсудим вашу ситуацию.` : ""}`,
    imagePrompt: `flat digital illustration about "${input.topic}", business context, mint and indigo palette, clean modern style`,
  };
}

export async function draftContentEmail(input: DraftEmailInput): Promise<DraftedEmail> {
  if (!isClaudeLive) return mockDraftEmail(input);
  const system =
    'Ты — эксперт-копирайтер контент-маркетинга. Пишешь образовательные email-статьи на русском: конкретная польза, без "воды". 300-500 слов, абзацы разделяй двойным переносом (\\n\\n). Если includeCta=true — в конце мягко предложи оставить заявку. Также предложи imagePrompt — короткое описание иллюстрации на английском, flat digital illustration, без текста на картинке. Отвечай строго JSON {subject, bodyText, imagePrompt}.';
  const user = `Тема письма: ${input.topic}\nРакурс: ${input.angle}\nОффер компании: ${input.offer}\nВключить CTA: ${input.includeCta ? `да, текст кнопки "${input.ctaLabel}"` : "нет"}\n\nНапиши письмо. Верни только JSON.`;
  const text = await callClaude(system, user);
  try {
    const parsed = JSON.parse(text);
    if (parsed.subject && parsed.bodyText) return parsed;
  } catch {
    // см. ниже
  }
  throw new ClaudeError("Claude вернул не-JSON текст письма");
}

export function mockPersonalNudge(input: { topic: string; contactName?: string | null }): string {
  const name = input.contactName ? `${input.contactName}, ` : "";
  return `Здравствуйте, ${name}заметил, что вам интересна серия про «${input.topic}» — готов обсудить вашу ситуацию лично, если удобно. [mock-режим]`;
}

export async function generatePersonalNudge(input: {
  topic: string;
  offer: string;
  contactName?: string | null;
}): Promise<string> {
  if (!isClaudeLive) return mockPersonalNudge(input);
  const system =
    "Ты — менеджер по продажам. Контакт активно читает серию образовательных писем — тема ему актуальна. Напиши короткое тёплое ЛИЧНОЕ письмо на русском от первого лица, предложи короткий созвон. Без давления и канцелярита.";
  const user = `Тема серии: ${input.topic}\nОффер компании: ${input.offer}\nИмя контакта: ${input.contactName ?? "неизвестно"}\n\nНапиши письмо (только текст, без темы).`;
  return callClaude(system, user);
}
