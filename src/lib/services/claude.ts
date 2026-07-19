
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
  /** Замечания к предыдущей генерации (см. deepseek.ts — контракт общий). */
  feedback?: string | null;
  previous?: { subject: string; body: string } | null;
  segment?: string | null;
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

