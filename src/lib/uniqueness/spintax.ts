/**
 * Движок уникальности (spintax + переменные) — ТЗ §5.9.
 *
 * Детерминированный, БЕЗ ИИ в рантайме. Общий для прогрева и боевых рассылок
 * (Яндекс требует уникальности одинаково для обоих).
 *
 * Синтаксис (§5.9.1):
 *   - альтернативы: {привет|здравствуйте|добрый день}, с вложенностью;
 *   - переменные: {{name}}, {{company}}.
 *
 * Send-time: по seed'у (напр. contactId+campaignId) детерминированно собирается
 * УНИКАЛЬНЫЙ вариант на каждое письмо. Один и тот же seed → один и тот же текст
 * (воспроизводимо); разные seed'ы → разные ветки (вариативность между получателями).
 *
 * M1.5 — только каркас send-time рендера. Build-time сборку вариантов (§5.9.2,
 * дешёвый батч-LLM в spintax-разметку) здесь НЕ делаем.
 *
 * ГПСЧ вынесен в src/lib/rng.ts — общий с движком прогрева (ramp/выбор пиров, §5.6).
 */

import { makeRng } from "@/lib/rng";

export type SpintaxNode =
  | { t: "text"; v: string }
  | { t: "var"; v: string }
  | { t: "choice"; options: SpintaxNode[][] };

// ── Парсер ──

function parseNodes(s: string, start: number, insideGroup: boolean): [SpintaxNode[], number] {
  const nodes: SpintaxNode[] = [];
  let text = "";
  let i = start;
  const flush = () => {
    if (text) {
      nodes.push({ t: "text", v: text });
      text = "";
    }
  };

  while (i < s.length) {
    const c = s[i];

    // переменная {{name}}
    if (c === "{" && s[i + 1] === "{") {
      const end = s.indexOf("}}", i + 2);
      if (end !== -1) {
        flush();
        nodes.push({ t: "var", v: s.slice(i + 2, end).trim() });
        i = end + 2;
        continue;
      }
      // незакрытая — трактуем как литерал
    }

    // начало группы {a|b|c}
    if (c === "{") {
      flush();
      const [choice, ni] = parseGroup(s, i + 1);
      nodes.push(choice);
      i = ni;
      continue;
    }

    // внутри группы: разделитель вариантов или её конец
    if (insideGroup && (c === "|" || c === "}")) {
      flush();
      return [nodes, i];
    }

    text += c;
    i += 1;
  }

  flush();
  return [nodes, i];
}

function parseGroup(s: string, startInside: number): [SpintaxNode, number] {
  const options: SpintaxNode[][] = [];
  let i = startInside;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [nodes, ni] = parseNodes(s, i, true);
    options.push(nodes);
    if (s[ni] === "|") {
      i = ni + 1;
      continue;
    }
    if (s[ni] === "}") {
      return [{ t: "choice", options }, ni + 1];
    }
    // конец строки без закрывающей } — закрываем группу как есть
    return [{ t: "choice", options }, ni];
  }
}

export function parseSpintax(template: string): SpintaxNode[] {
  const [nodes] = parseNodes(template, 0, false);
  return nodes;
}

// ── Рендер ──

function renderNodes(
  nodes: SpintaxNode[],
  vars: Record<string, string | null | undefined>,
  rng: () => number
): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += n.v;
    else if (n.t === "var") out += vars[n.v] ?? "";
    else {
      const idx = Math.floor(rng() * n.options.length);
      out += renderNodes(n.options[idx] ?? [], vars, rng);
    }
  }
  return out;
}

/**
 * Детерминированно собрать один вариант текста.
 * @param template — строка со spintax {a|b} и переменными {{var}}
 * @param vars — значения переменных
 * @param seed — детерминирует выбор веток (одинаковый seed → одинаковый текст)
 */
export function renderSpintax(
  template: string,
  vars: Record<string, string | null | undefined> = {},
  seed = ""
): string {
  const nodes = parseSpintax(template);
  const rng = makeRng(seed);
  return renderNodes(nodes, vars, rng);
}

/** Сколько всего уникальных вариантов даёт шаблон (произведение веток). */
export function countVariants(template: string): number {
  const count = (nodes: SpintaxNode[]): number =>
    nodes.reduce((acc, n) => {
      if (n.t === "choice") {
        return acc * n.options.reduce((s, opt) => s + count(opt), 0);
      }
      return acc;
    }, 1);
  return count(parseSpintax(template));
}

/** Есть ли в шаблоне spintax-альтернативы (для подсказок в UI). */
export function hasSpintax(template: string): boolean {
  return countVariants(template) > 1;
}
