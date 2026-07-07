
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

export type LlmProvider = "deepseek" | "claude";

export const DEFAULT_PROVIDER: LlmProvider = "deepseek";

export const providers: { value: LlmProvider; label: string; available: boolean }[] = [
  { value: "deepseek", label: "DeepSeek", available: true },
  { value: "claude", label: "Claude (Скоро)", available: false },
];

export type LlmOutcome<T> = { data: T; notice?: string };

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
  return `${providerLabel(provider)} временно недоступен (ошибка API или закончился баланс). Показан пример текста — попробуйте ещё раз позже.`;
}

export async function generateEmailVariants(
  input: {
    offer: string;
    targetAudience: string;
    websiteUrl?: string | null;
    variants?: number;
  },
  provider: LlmProvider = DEFAULT_PROVIDER
): Promise<LlmOutcome<{ subject: string; body: string }[]>> {
  try {
    return { data: await adapterFor(provider).generateEmailVariants(input) };
  } catch (err) {
    console.error(`[llm:${provider}] generateEmailVariants failed:`, err);
    const data =
      provider === "deepseek"
        ? deepseek.mockEmailVariants(input, "показан пример — DeepSeek временно недоступен")
        : await claude.generateEmailVariants(input); // claude мок-режим не кидает ошибок
    return { data, notice: failureNotice(provider) };
  }
}

export async function generateReply(
  input: { offer: string; thread: { direction: string; body: string }[] },
  provider: LlmProvider = DEFAULT_PROVIDER
): Promise<LlmOutcome<string>> {
  try {
    return { data: await adapterFor(provider).generateReply(input) };
  } catch (err) {
    console.error(`[llm:${provider}] generateReply failed:`, err);
    const data = provider === "deepseek" ? deepseek.mockReply() : await claude.generateReply(input);
    return { data, notice: failureNotice(provider) };
  }
}

export async function qualifyLead(
  input: { thread: { direction: string; body: string }[] },
  provider: LlmProvider = DEFAULT_PROVIDER
): Promise<LlmOutcome<{ qualification: deepseek.Qualification; summary: string }>> {
  try {
    return { data: await adapterFor(provider).qualifyLead(input) };
  } catch (err) {
    console.error(`[llm:${provider}] qualifyLead failed:`, err);
    const data =
      provider === "deepseek"
        ? deepseek.mockQualifyLead(input.thread)
        : await claude.qualifyLead(input);
    return { data, notice: failureNotice(provider) };
  }
}

// ── Контент-маркетинг: серия писем ──

export type PlannedStep = deepseek.PlannedStep;
export type DraftedEmail = deepseek.DraftedEmail;

export async function planContentSeries(
  input: {
    topic: string;
    targetAudience: string;
    offer: string;
    totalSteps: number;
    frequencyDays: number;
  },
  provider: LlmProvider = DEFAULT_PROVIDER
): Promise<LlmOutcome<PlannedStep[]>> {
  try {
    return { data: await adapterFor(provider).planContentSeries(input) };
  } catch (err) {
    console.error(`[llm:${provider}] planContentSeries failed:`, err);
    return { data: deepseek.mockPlanSeries(input), notice: failureNotice(provider) };
  }
}

export async function draftContentEmail(
  input: { topic: string; angle: string; offer: string; includeCta: boolean; ctaLabel?: string },
  provider: LlmProvider = DEFAULT_PROVIDER
): Promise<LlmOutcome<DraftedEmail>> {
  try {
    return { data: await adapterFor(provider).draftContentEmail(input) };
  } catch (err) {
    console.error(`[llm:${provider}] draftContentEmail failed:`, err);
    return { data: deepseek.mockDraftEmail(input), notice: failureNotice(provider) };
  }
}

export async function generatePersonalNudge(
  input: { topic: string; offer: string; contactName?: string | null },
  provider: LlmProvider = DEFAULT_PROVIDER
): Promise<LlmOutcome<string>> {
  try {
    return { data: await adapterFor(provider).generatePersonalNudge(input) };
  } catch (err) {
    console.error(`[llm:${provider}] generatePersonalNudge failed:`, err);
    return { data: deepseek.mockPersonalNudge(input), notice: failureNotice(provider) };
  }
}
