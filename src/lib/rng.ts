/**
 * Детерминированный ГПСЧ (seed-строка → поток чисел [0,1)). Общий для
 * движка уникальности (spintax, §5.9) и движка прогрева (ramp/выбор пиров,
 * §5.6) — одинаковый seed всегда даёт одинаковый результат (воспроизводимо
 * между тиками воркера), разные seed'ы — разные ветки.
 */

// FNV-1a hash строки → uint32
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32
export function makeRng(seed: string): () => number {
  let a = hashSeed(seed) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Случайное целое в [min, max] (включительно), детерминировано через rng(). */
export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Случайный элемент массива, детерминировано через rng(). */
export function pickOne<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Перемешать копию массива (Fisher-Yates), детерминировано через rng(). */
export function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
