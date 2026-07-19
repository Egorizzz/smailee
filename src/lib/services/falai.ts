/**
 * fal.ai адаптер — генерация картинок для писем.
 * Модель: Recraft v3, стиль digital_illustration (чёткие flat-иллюстрации).
 *
 * LLM сюда API-ключ не получает: модель может лишь придумать текстовый промпт,
 * реальный HTTP-вызов делает сервер.
 *
 * Лимит: 10 генераций в СУТКИ на клиента (внешний платный API — без потолка
 * один пользователь может незаметно выжечь общий баланс). Считается скользящим
 * окном по таблице ImageGeneration, а не счётчиком с датой сброса: не нужно
 * ни хранить дату, ни чинить состояние, если сброс не отработал.
 *
 * Пока FAL_KEY пуст — mock-режим: детерминированная SVG-заглушка вместо сети,
 * чтобы сценарий работал без ключа (и не тратил лимит).
 *
 * Документация: https://fal.ai/models/fal-ai/recraft-v3
 */

import { prisma } from "@/lib/prisma";

const API_KEY = process.env.FAL_KEY;
const ENDPOINT = "https://fal.run/fal-ai/recraft-v3";
const STYLE = "digital_illustration";

export const isFalLive = Boolean(API_KEY);

/** Сколько картинок в сутки может сгенерировать один клиент. */
export const DAILY_IMAGE_LIMIT = Number(process.env.FAL_DAILY_IMAGE_LIMIT ?? 10);

export class FalError extends Error {}

/** Потрачено за последние 24 часа этим клиентом (для UI и проверки лимита). */
export async function imagesUsedToday(userId: string): Promise<number> {
  return prisma.imageGeneration.count({
    where: { userId, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
  });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
}

function placeholderImageUrl(prompt: string): string {
  const label = escapeXml(prompt.slice(0, 70));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320"><rect width="100%" height="100%" fill="#eef1ff"/><rect x="1" y="1" width="598" height="318" fill="none" stroke="#c7d2fe" stroke-width="2"/><text x="50%" y="46%" font-family="sans-serif" font-size="15" fill="#4f46e5" text-anchor="middle">[mock-изображение, добавьте FAL_KEY]</text><text x="50%" y="58%" font-family="sans-serif" font-size="12" fill="#6366f1" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export type GenerateImageResult =
  | { ok: true; url: string; mocked: boolean; usedToday: number; limit: number }
  | { ok: false; error: string; usedToday: number; limit: number };

/**
 * Генерирует иллюстрацию по промпту пользователя.
 * Ошибки возвращаются значением, а не исключением: вызывающий UI показывает
 * их пользователю, и падать всему запросу из-за внешнего API незачем.
 */
export async function generateImage(
  prompt: string,
  userId: string
): Promise<GenerateImageResult> {
  const limit = DAILY_IMAGE_LIMIT;
  const usedToday = await imagesUsedToday(userId);

  if (usedToday >= limit) {
    return {
      ok: false,
      error: `Лимит генераций исчерпан: ${usedToday} из ${limit} за сутки. Появится снова, когда самой старой генерации станет больше 24 часов.`,
      usedToday,
      limit,
    };
  }

  if (!isFalLive) {
    // mock не ходит в сеть и ничего не стоит — лимит на него не тратим
    return { ok: true, url: placeholderImageUrl(prompt), mocked: true, usedToday, limit };
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Key ${API_KEY}` },
      body: JSON.stringify({ prompt, style: STYLE, image_size: "landscape_4_3" }),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Не удалось связаться с fal.ai: ${err instanceof Error ? err.message : String(err)}`,
      usedToday,
      limit,
    };
  }
  if (!res.ok) {
    return { ok: false, error: `fal.ai вернул ошибку ${res.status}`, usedToday, limit };
  }

  const data = await res.json();
  const url = data.images?.[0]?.url;
  if (!url) return { ok: false, error: "fal.ai не вернул изображение", usedToday, limit };

  // считаем ТОЛЬКО реальные генерации — они и стоят денег
  await prisma.imageGeneration.create({ data: { userId, prompt, url } });

  return { ok: true, url, mocked: false, usedToday: usedToday + 1, limit };
}
