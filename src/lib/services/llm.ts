
/**
 * Фасад над LLM-адаптерами. DeepSeek — основной провайдер (дешевле для теста,
 * без платного порога входа). Claude/Anthropic пока доступен в интерфейсе как
 * «Скоро» — адаптер уже готов (src/lib/services/claude.ts), переключить можно
 * в любой момент без изменения вызывающего кода.
 *
 * Если реальный вызов провайдера падает (нет баланса, сеть, 5xx) — откатываемся
 * на mock-ответ и прикладываем notice, чтобы вызывающая сторона могла показать
 * пользователю уведомление вместо падения запроса.
 */

import * as deepseek from "./deepseek";
import * as claude from "./claude";
import { normalizePlaceholders } from "@/lib/mail/placeholders";
import { reportSharedApiFailure } from "./serviceAlerts";
import type { BusinessProfileData, PageAnalysis, ProfileSynthesis } from "@/lib/businessProfile/types";

export type LlmProvider = "deepseek" | "claude";

export const DEFAULT_PROVIDER: LlmProvider = "deepseek";

export const providers: { value: LlmProvider; label: string; available: boolean }[] = [
  { value: "deepseek", label: "DeepSeek", available: true },
  { value: "claude", label: "Claude (Скоро)", available: false },
];

export type LlmOutcome<T> = { data: T; notice?: string };
export class LlmUnavailableError extends Error {}
export class LlmInvalidResponseError extends Error {}
const useTestMocks = () => process.env.LLM_TEST_MOCKS === "true";

function adapterFor(provider: LlmProvider) {
  return provider === "claude" ? claude : deepseek;
}

function providerLabel(provider: LlmProvider): string {
  return provider === "claude" ? "Claude" : "DeepSeek";
}

export function isProviderLive(provider: LlmProvider): boolean {
  return provider === "claude" ? claude.isClaudeLive : deepseek.isDeepseekLive;
}

function failureNotice(provider: LlmProvider): string {
  return `${providerLabel(provider)} сейчас недоступен. Ничего не сгенерировано — попробуйте ещё раз позже.`;
}

async function unavailable(provider: LlmProvider, error: unknown): Promise<never> {
  await reportSharedApiFailure(providerLabel(provider), error);
  throw new LlmUnavailableError(failureNotice(provider));
}

export async function generateEmailVariants(
  input: {
    offer: string;
    targetAudience: string;
    websiteUrl?: string | null;
    variants?: number;
    /** Замечания пользователя к предыдущей генерации (перегенерация с правками). */
    feedback?: string | null;
    previous?: { subject: string; body: string } | null;
    segment?: string | null;
    businessContext?: string | null;
  },
  provider: LlmProvider = DEFAULT_PROVIDER
): Promise<LlmOutcome<{ subject: string; body: string }[]>> {
  if (!isProviderLive(provider) && useTestMocks()) {
    return { data: withCanonicalPlaceholders(deepseek.mockEmailVariants(input, "integration test")) };
  }
  if (!isProviderLive(provider)) return unavailable(provider, new Error("API key is not configured"));
  try {
    return { data: withCanonicalPlaceholders(await adapterFor(provider).generateEmailVariants(input)) };
  } catch (err) {
    console.error(`[llm:${provider}] generateEmailVariants failed:`, err);
    return unavailable(provider, err);
  }
}

/**
 * Единая точка нормализации плейсхолдеров для ЛЮБОГО провайдера и любого пути
 * (живой вызов, мок, откат после ошибки). В промпте синтаксис описан, но
 * полагаться на дисциплину модели нельзя: цена промаха — испорченные письма
 * реальным получателям (см. src/lib/mail/placeholders.ts).
 */
function withCanonicalPlaceholders(
  variants: { subject: string; body: string }[]
): { subject: string; body: string }[] {
  return variants.map((v) => ({
    subject: normalizePlaceholders(v.subject),
    body: normalizePlaceholders(v.body),
  }));
}

export async function generateReply(
  input: {
    offer: string;
    thread: { direction: string; body: string }[];
    /** Инструкция клиента по воронке — как вести переписку (User.funnelPrompt). */
    funnelPrompt?: string | null;
    businessContext?: string | null;
  },
  provider: LlmProvider = DEFAULT_PROVIDER
): Promise<LlmOutcome<string>> {
  if (!isProviderLive(provider) && useTestMocks()) return { data: deepseek.mockReply() };
  if (!isProviderLive(provider)) return unavailable(provider, new Error("API key is not configured"));
  try {
    return { data: await adapterFor(provider).generateReply(input) };
  } catch (err) {
    console.error(`[llm:${provider}] generateReply failed:`, err);
    return unavailable(provider, err);
  }
}

/**
 * Составить инструкцию по воронке из выгрузки диалогов клиента.
 * Только DeepSeek: у Claude-адаптера этой функции нет, и падать из-за выбора
 * провайдера здесь незачем — фича вспомогательная.
 */
export async function deriveFunnelPrompt(dialogs: string): Promise<LlmOutcome<string>> {
  if (!deepseek.isDeepseekLive && useTestMocks()) return { data: "Тестовая инструкция по воронке." };
  try {
    return { data: await deepseek.deriveFunnelPrompt(dialogs) };
  } catch (err) {
    console.error("[llm:deepseek] deriveFunnelPrompt failed:", err);
    return unavailable("deepseek", err);
  }
}

/**
 * Импорт базы: уточнение соответствия колонок и автосегментация.
 * Только DeepSeek. Ошибки не пробрасываем — импорт обязан работать и без ИИ
 * (эвристика в tableParse.ts справляется с типовыми файлами).
 */
export async function suggestFieldMapping(input: {
  headers: string[];
  sampleRows: string[][];
}): Promise<Record<number, string>> {
  try {
    return await deepseek.suggestFieldMapping(input);
  } catch (err) {
    console.error("[llm:deepseek] suggestFieldMapping failed:", err);
    return {};
  }
}

export async function suggestSegments(input: {
  companies: string[];
}): Promise<Record<string, string>> {
  try {
    return await deepseek.suggestSegments(input);
  } catch (err) {
    console.error("[llm:deepseek] suggestSegments failed:", err);
    return {};
  }
}

export async function qualifyLead(
  input: {
    thread: { direction: string; body: string }[];
    triggersPrompt?: string;
    triggerKeys?: string[];
    referenceDate?: string;
  },
  provider: LlmProvider = DEFAULT_PROVIDER
): Promise<LlmOutcome<deepseek.QualifyResult>> {
  if (!isProviderLive(provider) && useTestMocks()) {
    return { data: deepseek.mockQualifyLead(input.thread, input.triggerKeys ?? []) };
  }
  if (!isProviderLive(provider)) return unavailable(provider, new Error("API key is not configured"));
  try {
    return { data: await adapterFor(provider).qualifyLead(input) };
  } catch (err) {
    console.error(`[llm:${provider}] qualifyLead failed:`, err);
    return unavailable(provider, err);
  }
}

export async function analyzeBusinessPage(input: {
  url: string;
  title?: string | null;
  markdown: string;
}): Promise<PageAnalysis> {
  if (!deepseek.isDeepseekLive) return unavailable("deepseek", new Error("API key is not configured"));
  try {
    return await deepseek.analyzeBusinessPage(input);
  } catch (error) {
    console.error("[llm:deepseek] analyzeBusinessPage failed:", error);
    if (error instanceof deepseek.DeepseekResponseError) {
      await reportSharedApiFailure("DeepSeek", error);
      throw new LlmInvalidResponseError("ИИ не смог корректно разобрать страницу после повторной попытки");
    }
    return unavailable("deepseek", error);
  }
}

export async function synthesizeBusinessProfile(input: {
  facts: Array<{ category: string; value: string; evidence?: string; confidence?: number; sensitive?: boolean; sourceUrl: string }>;
  manual: BusinessProfileData;
  sources: Array<{ url: string; title: string }>;
}): Promise<ProfileSynthesis> {
  if (!deepseek.isDeepseekLive) return unavailable("deepseek", new Error("API key is not configured"));
  try {
    return await deepseek.synthesizeBusinessProfile(input);
  } catch (error) {
    console.error("[llm:deepseek] synthesizeBusinessProfile failed:", error);
    if (error instanceof deepseek.DeepseekResponseError) {
      await reportSharedApiFailure("DeepSeek", error);
      throw new LlmInvalidResponseError("ИИ не смог собрать профиль в корректном формате после повторной попытки");
    }
    return unavailable("deepseek", error);
  }
}
