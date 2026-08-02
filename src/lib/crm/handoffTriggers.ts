/**
 * Триггеры передачи лида в CRM — что именно считать «клиент созрел».
 *
 * Зачем настраиваемо. Раньше единственным условием была общая квалификация
 * ИИ (HOT), то есть «модели показалось, что клиент тёплый». Но у разных
 * бизнесов разный порог: кому-то достаточно вопроса о цене, а кому-то нужна
 * прямая договорённость о встрече, иначе продавец тратит время на праздный
 * интерес. Поэтому список выбирает сам клиент.
 *
 * Ключи попадают в три места сразу: чекбоксы в настройках, промпт
 * квалификации (перечисляем ИИ, что искать) и Lead.handoffTrigger (какой
 * сработал). Список общий, чтобы они не разъехались.
 */

export type HandoffTrigger = {
  key: string;
  /** Название для интерфейса. */
  label: string;
  /** Формулировка для промпта ИИ — что именно считать срабатыванием. */
  aiDescription: string;
};

export const HANDOFF_TRIGGERS: HandoffTrigger[] = [
  {
    key: "call_request",
    label: "Просит позвонить",
    aiDescription: "клиент просит созвониться, спрашивает про звонок или оставляет телефон",
  },
  {
    key: "meeting_request",
    label: "Предлагает встречу или демо",
    aiDescription: "клиент предлагает встретиться, просит демонстрацию или зовёт на созвон с показом",
  },
  {
    key: "ready_to_start",
    label: "Готов начать работу",
    aiDescription: "клиент прямо говорит, что готов начать, попробовать или заключить договор",
  },
  {
    key: "decision_maker",
    label: "Подключает ЛПР или коллег",
    aiDescription: "клиент подключает к переписке руководителя, коллег или просит написать другому человеку в компании",
  },
];

// Дефолт для новых аккаунтов — все встроенные триггеры сразу включены, а не
// пустой список. Пустой список означал бы, что ИИ не понимает, когда лид
// готов, и держит линию бесконечно; хотя бы один сигнал должен быть всегда
// (это же требование enforced на сохранении, см. saveCrmSettings).
export const DEFAULT_HANDOFF_TRIGGERS = HANDOFF_TRIGGERS.map((t) => t.key);

// НЕ входит в HANDOFF_TRIGGERS: это не чекбокс, а результат свободного текста
// клиента (User.customHandoffPrompt). Ключ синтетический, нужен только чтобы
// модель могла на него сослаться в поле trigger и чтобы отличить «сработал
// пользовательский сценарий» от конкретного встроенного.
export const CUSTOM_TRIGGER_KEY = "custom_scenario";
// Ручная передача кнопкой в интерфейсе — минуя ИИ-квалификацию полностью.
export const MANUAL_TRIGGER_KEY = "manual";

const BY_KEY = new Map(HANDOFF_TRIGGERS.map((t) => [t.key, t]));

export function isKnownTrigger(key: string): boolean {
  return BY_KEY.has(key);
}

const SPECIAL_LABELS: Record<string, string> = {
  [CUSTOM_TRIGGER_KEY]: "Пользовательский сценарий",
  [MANUAL_TRIGGER_KEY]: "Передано вручную",
};

export function triggerLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? SPECIAL_LABELS[key] ?? key;
}

/**
 * Отбрасывает незнакомые ключи. Значения приходят из формы (браузер), а
 * попадают в промпт ИИ — подложенный мусор не должен туда доехать.
 */
export function sanitizeTriggerKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  return keys.filter((k) => isKnownTrigger(k) && !seen.has(k) && seen.add(k));
}

/** Блок для промпта квалификации: что ИИ должен искать в переписке. */
export function describeTriggersForPrompt(keys: string[]): string {
  const chosen = sanitizeTriggerKeys(keys)
    .map((k) => BY_KEY.get(k))
    .filter((t): t is HandoffTrigger => Boolean(t));
  if (chosen.length === 0) return "";
  return chosen.map((t) => `- ${t.key}: ${t.aiDescription}`).join("\n");
}

/**
 * Полный контекст для квалификации: встроенные триггеры + пользовательский
 * сценарий одной строкой (User.customHandoffPrompt), если задан. Возвращает
 * готовый блок для промпта и полный список ключей, которые модели разрешено
 * вернуть в поле trigger — без этого списка ответ "custom_scenario" был бы
 * отвергнут как незнакомый ключ (см. qualifyLead в deepseek.ts/claude.ts).
 */
export function buildHandoffContext(
  triggerKeys: string[],
  customPrompt: string | null | undefined
): { promptText: string; validKeys: string[] } {
  const fixed = sanitizeTriggerKeys(triggerKeys);
  const lines = fixed.map((k) => `- ${k}: ${BY_KEY.get(k)!.aiDescription}`);
  const validKeys = [...fixed];

  const custom = customPrompt?.trim();
  if (custom) {
    lines.push(`- ${CUSTOM_TRIGGER_KEY}: ${custom}`);
    validKeys.push(CUSTOM_TRIGGER_KEY);
  }

  return { promptText: lines.join("\n"), validKeys };
}
