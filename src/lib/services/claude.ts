
/**
 * Claude (Anthropic) адаптер.
 * Пока ANTHROPIC_API_KEY пуст — работает в mock-режиме (осмысленные фейковые
 * ответы), не ломая сценарии. Как только ключ появится в .env — включается
 * реальный вызов API без изменений в вызывающем коде.
 */

import { sanitizeEmailVariants } from "./emailVariants";
import { reportSharedApiSuccess } from "./serviceAlerts";

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
  await reportSharedApiSuccess("Claude");
  return data.content?.[0]?.text ?? "";
}

/** Генерация вариантов холодного письма под оффер клиента. */
export async function generateEmailVariants(
  input: GenerateEmailInput
): Promise<{ subject: string; body: string }[]> {
  const n = input.variants ?? 2;

  if (!isClaudeLive) throw new ClaudeError("ANTHROPIC_API_KEY is not configured");

  const system =
    "Ты — эксперт по холодным b2b email-рассылкам. Пишешь короткие персональные письма на русском, которые звучат как личное сообщение, а не массовая рассылка. Отвечай строго в формате JSON-массива объектов {subject, body}. Ровно два поля в каждом объекте — subject и body, никаких дополнительных (напр. body_alt, alternative): если хочешь предложить другую формулировку, оформи её отдельным элементом массива, увеличив число вариантов.";
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
    const variants = sanitizeEmailVariants(JSON.parse(text));
    if (variants.length > 0) return variants;
  } catch {
    // fallback: одно письмо целиком
  }
  throw new ClaudeError("Anthropic returned an invalid email-variants response");
}

/** Ответ AI на входящее письмо клиента (ведение диалога). */
export async function generateReply(input: {
  offer: string;
  thread: { direction: string; body: string }[];
  /** Инструкция клиента по воронке (см. deepseek.ts — контракт общий). */
  funnelPrompt?: string | null;
}): Promise<string> {
  if (!isClaudeLive) throw new ClaudeError("ANTHROPIC_API_KEY is not configured");
  const system = [
    "Ты — вежливый менеджер по продажам, ведёшь переписку с потенциальным клиентом по email на русском. Отвечай коротко, по делу, двигай к следующему шагу (созвон/расчёт). Не будь навязчивым.",
    input.funnelPrompt
      ? `\nИнструкция компании — соблюдай её строго, она приоритетнее общих правил выше:\n${input.funnelPrompt}`
      : "",
  ].join("");
  const history = input.thread
    .map((m) => `${m.direction === "inbound" ? "Клиент" : "Мы"}: ${m.body}`)
    .join("\n");
  return callClaude(system, `Оффер: ${input.offer}\n\nПереписка:\n${history}\n\nНапиши следующий ответ.`);
}

export type Qualification = "HOT" | "COLD" | "IRRELEVANT" | "UNKNOWN";

/** Квалификация лида по переписке (контракт общий — см. deepseek.ts). */
export async function qualifyLead(input: {
  thread: { direction: string; body: string }[];
  triggersPrompt?: string;
  triggerKeys?: string[];
}): Promise<{ qualification: Qualification; summary: string; trigger: string | null; optOut: boolean }> {
  const triggerKeys = input.triggerKeys ?? [];
  if (!isClaudeLive) {
    // простая эвристика для mock (контракт общий — см. deepseek.ts)
    const text = input.thread.map((m) => m.body).join(" ").toLowerCase();
    const hot = /цена|стоит|сколько|интерес|готов|давайте|созвон|отправьте/.test(
      text
    );
    const optOut = /не пиш|отпиш|уберите из рассылк|больше не отправ|прекратите/.test(text);
    return {
      qualification: hot ? "HOT" : "COLD",
      summary: hot
        ? "Клиент проявил интерес и спрашивает детали. [mock]"
        : "Пока без явного интереса. [mock]",
      trigger: null,
      optOut,
    };
  }
  const system = [
    "Ты квалифицируешь b2b-лида по переписке.",
    input.triggersPrompt
      ? `Отдельно определи, произошло ли одно из перечисленных действий клиента:\n${input.triggersPrompt}\nЕсли произошло — верни ключ (то, что до двоеточия) в поле trigger. Если ни одно не произошло — trigger должен быть null. Не придумывай ключей, которых нет в списке.`
      : "Поле trigger всегда null.",
    // optOut — строгий критерий, отдельно от общей квалификации (контракт
    // общий с deepseek.ts): "не сейчас"/"неинтересно" — это COLD/IRRELEVANT,
    // а не optOut. Цена ложноположительного здесь выше, поэтому нужна
    // однозначная формулировка отказа, а не общее впечатление "не хочет".
    'optOut = true, ТОЛЬКО если клиент прямо попросил прекратить писать ("не пишите мне", "уберите из рассылки", "отпишите меня", "прекратите присылать письма"). Обычный отказ по существу ("неинтересно", "не сейчас", "не подходит") — это НЕ optOut, а просто низкая квалификация.',
    'Верни строго JSON {"qualification": "HOT|COLD|IRRELEVANT", "summary": "краткое резюме на русском", "trigger": "ключ или null", "optOut": true|false}.',
  ].join("\n");
  const history = input.thread
    .map((m) => `${m.direction === "inbound" ? "Клиент" : "Мы"}: ${m.body}`)
    .join("\n");
  const text = await callClaude(system, history);
  try {
    const parsed = JSON.parse(text);
    const raw = typeof parsed.trigger === "string" ? parsed.trigger : null;
    return {
      qualification: parsed.qualification ?? "UNKNOWN",
      summary: parsed.summary ?? "",
      trigger: raw && triggerKeys.includes(raw) ? raw : null,
      optOut: parsed.optOut === true,
    };
  } catch {
    return { qualification: "UNKNOWN", summary: text.slice(0, 200), trigger: null, optOut: false };
  }
}

