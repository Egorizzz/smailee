
/**
 * fal.ai адаптер (генерация картинок для писем контент-маркетинга).
 * Модель: Recraft v3, стиль digital_illustration (см. DECISIONS.md — выбран за
 * чёткие flat-иллюстрации, FLUX не используем).
 *
 * DeepSeek/Claude сюда API-ключ не получают: модель только придумывает текстовый
 * промпт, а реальный HTTP-вызов к fal.ai делает наш сервер (эта функция).
 *
 * Пока FAL_KEY пуст — mock-режим: детерминированная SVG-заглушка вместо сети.
 * В реальном режиме — бюджет генераций ограничен и учитывается в таблице
 * ImageGeneration (см. DECISIONS.md: "не более 50 генераций").
 *
 * Документация: https://fal.ai/docs/model-endpoints, https://fal.ai/models/fal-ai/recraft-v3
 */

import { prisma } from "@/lib/prisma";

const API_KEY = process.env.FAL_KEY;
const ENDPOINT = "https://fal.run/fal-ai/recraft-v3";
const STYLE = "digital_illustration";

export const isFalLive = Boolean(API_KEY);

export const IMAGE_BUDGET_LIMIT = Number(process.env.FAL_IMAGE_BUDGET ?? 50);

export class FalError extends Error {}

/** Сколько реальных (не mock) генераций уже потрачено — для отображения в UI. */
export async function getImageGenerationCount(): Promise<number> {
  return prisma.imageGeneration.count({ where: { mocked: false } });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
}

function placeholderImageUrl(prompt: string): string {
  const label = escapeXml(prompt.slice(0, 70));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320"><rect width="100%" height="100%" fill="#eef1ff"/><rect x="1" y="1" width="598" height="318" fill="none" stroke="#c7d2fe" stroke-width="2"/><text x="50%" y="46%" font-family="sans-serif" font-size="15" fill="#4f46e5" text-anchor="middle">[mock-изображение, добавьте FAL_KEY]</text><text x="50%" y="58%" font-family="sans-serif" font-size="12" fill="#6366f1" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Генерирует иллюстрацию по текстовому промпту. Промпт пишет LLM (DeepSeek/Claude),
 * сам HTTP-вызов и ключ — только здесь, на сервере.
 */
export async function generateImage(
  prompt: string,
  opts?: { userId?: string | null }
): Promise<{ url: string; mocked: boolean }> {
  if (!isFalLive) {
    const url = placeholderImageUrl(prompt);
    await prisma.imageGeneration.create({
      data: { userId: opts?.userId ?? null, prompt, imageUrl: url, mocked: true },
    });
    return { url, mocked: true };
  }

  const used = await getImageGenerationCount();
  if (used >= IMAGE_BUDGET_LIMIT) {
    throw new FalError(
      `Бюджет генераций картинок исчерпан (${used}/${IMAGE_BUDGET_LIMIT}). Увеличьте FAL_IMAGE_BUDGET, если это осознанно.`
    );
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Key ${API_KEY}`,
      },
      body: JSON.stringify({
        prompt,
        style: STYLE,
        image_size: "landscape_4_3",
      }),
    });
  } catch (err) {
    throw new FalError(
      `Не удалось связаться с fal.ai: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    throw new FalError(`fal.ai API error: ${res.status}`);
  }
  const data = await res.json();
  const url = data.images?.[0]?.url;
  if (!url) throw new FalError("fal.ai не вернул изображение в ответе");

  await prisma.imageGeneration.create({
    data: { userId: opts?.userId ?? null, prompt, imageUrl: url, mocked: false },
  });

  return { url, mocked: false };
}
