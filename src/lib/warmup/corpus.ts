import fs from "node:fs";
import path from "node:path";
import { renderSpintax } from "@/lib/uniqueness/spintax";
import { makeRng, pickOne } from "@/lib/rng";

/**
 * Корпус прогревочной переписки (ТЗ §5.9.3) — дерево диалогов, которое
 * дописывает оператор РУКАМИ (JSON, без кода). Формат:
 *
 *   openers[]       — открывающие письма (opener → responses[] дочерних id)
 *   responses[]      — ответные письма (response → continuations[] дочерних id)
 *   continuations[]  — необязательное продолжение треда (второй ход)
 *
 * Каждый узел — spintax-шаблон (см. src/lib/uniqueness/spintax.ts): {a|b|c}
 * альтернативы + {{var}} переменные. Никаких вызовов ИИ — ни здесь, ни при
 * сборке, ни в рантайме (§1, §5.6).
 *
 * Пример: src/lib/warmup/corpus/ru-default.json. Оператор добавляет узлы в
 * массивы и проставляет id в responses/continuations — движок подхватит их
 * без изменений в коде.
 */

export type OpenerNode = { id: string; subject: string; body: string; responses: string[] };
export type ResponseNode = { id: string; body: string; continuations: string[] };
export type ContinuationNode = { id: string; body: string };

export type CorpusFile = {
  openers: OpenerNode[];
  responses: ResponseNode[];
  continuations: ContinuationNode[];
};

let cached: CorpusFile | null = null;

function validate(corpus: CorpusFile) {
  const responseIds = new Set(corpus.responses.map((r) => r.id));
  const continuationIds = new Set(corpus.continuations.map((c) => c.id));
  for (const o of corpus.openers) {
    for (const rid of o.responses) {
      if (!responseIds.has(rid)) {
        throw new Error(`Корпус прогрева: opener "${o.id}" ссылается на неизвестный response "${rid}"`);
      }
    }
  }
  for (const r of corpus.responses) {
    for (const cid of r.continuations) {
      if (!continuationIds.has(cid)) {
        throw new Error(`Корпус прогрева: response "${r.id}" ссылается на неизвестный continuation "${cid}"`);
      }
    }
  }
  if (corpus.openers.length === 0) {
    throw new Error("Корпус прогрева пуст: нет ни одного opener'а");
  }
}

/** Загружает корпус (JSON, без ИИ) один раз за процесс. */
export function loadCorpus(file = "ru-default.json"): CorpusFile {
  if (cached) return cached;
  const filePath = path.join(process.cwd(), "src", "lib", "warmup", "corpus", file);
  const raw = fs.readFileSync(filePath, "utf-8");
  const corpus = JSON.parse(raw) as CorpusFile;
  validate(corpus);
  cached = corpus;
  return corpus;
}

export type RenderedNode = { subject?: string; body: string };

/** Детерминированно выбирает opener и рендерит spintax по seed'у. */
export function pickOpener(seed: string): { node: OpenerNode; rendered: RenderedNode } {
  const corpus = loadCorpus();
  const rng = makeRng(`${seed}:opener`);
  const node = pickOne(rng, corpus.openers);
  return {
    node,
    rendered: {
      subject: renderSpintax(node.subject, {}, `${seed}:subject`),
      body: renderSpintax(node.body, {}, `${seed}:body`),
    },
  };
}

/** Детерминированно выбирает ответ на opener (или null, если у него их нет). */
export function pickResponse(openerId: string, seed: string): { node: ResponseNode; rendered: RenderedNode } | null {
  const corpus = loadCorpus();
  const opener = corpus.openers.find((o) => o.id === openerId);
  if (!opener || opener.responses.length === 0) return null;
  const rng = makeRng(`${seed}:response`);
  const responseId = pickOne(rng, opener.responses);
  const node = corpus.responses.find((r) => r.id === responseId);
  if (!node) return null;
  return { node, rendered: { body: renderSpintax(node.body, {}, `${seed}:body`) } };
}

/** Детерминированно выбирает продолжение треда после response (или null). */
export function pickContinuation(
  responseId: string,
  seed: string
): { node: ContinuationNode; rendered: RenderedNode } | null {
  const corpus = loadCorpus();
  const response = corpus.responses.find((r) => r.id === responseId);
  if (!response || response.continuations.length === 0) return null;
  const rng = makeRng(`${seed}:continuation`);
  const continuationId = pickOne(rng, response.continuations);
  const node = corpus.continuations.find((c) => c.id === continuationId);
  if (!node) return null;
  return { node, rendered: { body: renderSpintax(node.body, {}, `${seed}:body`) } };
}
