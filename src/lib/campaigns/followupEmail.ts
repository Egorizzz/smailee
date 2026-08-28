import { createHash } from "node:crypto";
import type { PersonalizedEmail } from "@/lib/services/emailVariants";

export const FOLLOWUP_EMAIL_REVISION = 1;
export const FOLLOWUP_EMAIL_MAX_BODY_CHARS = 320;

export type FollowupEmailGenerationInput = {
  /** A compact creative direction. It is never a source of recipient facts. */
  structure: {
    subjectGuide: string;
    bodyGuide: string;
  };
  /** The only factual source available to follow-up generation. */
  lastEmail: {
    subject: string;
    body: string;
  };
  /** Number of follow-ups already sent before the message being generated. */
  followupsSent: number;
};

export function followupThreadSubject(value: string) {
  const root = value.replace(/^(?:\s*re\s*:\s*)+/i, "").trim();
  return `Re: ${root || "Короткий вопрос"}`.slice(0, 240);
}

/**
 * A deliberately generic last resort: it makes no claims about the recipient,
 * reading the previous email, timing, colleagues or prepared materials.
 */
export function safeFollowupEmail(input: FollowupEmailGenerationInput): PersonalizedEmail {
  const body = input.followupsSent <= 0
    ? "Коротко вернусь к прошлому письму. Подскажите, стоит обсудить эту тему сейчас?"
    : input.followupsSent === 1
      ? "Ещё раз вернусь к прошлому письму. Подскажите, лучше продолжить сейчас или написать вам позже?"
      : "Пожалуй, пока остановлюсь здесь. Если захотите вернуться к теме позже — просто ответьте на это письмо, буду на связи.";
  return {
    subject: followupThreadSubject(input.lastEmail.subject),
    body,
    usedContextIds: [],
  };
}

export function followupEmailContextHash(input: FollowupEmailGenerationInput) {
  return createHash("sha256")
    .update(JSON.stringify({ revision: FOLLOWUP_EMAIL_REVISION, input }))
    .digest("hex");
}

export function followupValidationIssues(
  body: string,
  lastBody: string,
  followupsSent: number,
): string[] {
  const issues: string[] = [];
  const candidate = body.replace(/\s+/g, " ").trim();
  const previous = lastBody.replace(/\s+/g, " ").trim();
  const lower = candidate.toLocaleLowerCase("ru-RU");
  const previousLower = previous.toLocaleLowerCase("ru-RU");

  if (!candidate) issues.push("пустой текст");
  if (candidate.length > FOLLOWUP_EMAIL_MAX_BODY_CHARS) issues.push(`текст длиннее ${FOLLOWUP_EMAIL_MAX_BODY_CHARS} символов`);
  if (/[{}\[\]]/.test(candidate)) issues.push("есть плейсхолдеры или скобочные переменные");
  if (/^(?:здравствуйте|добрый день|привет)[!,.\s]/iu.test(candidate)) issues.push("есть повторное приветствие");
  if (/^(?:re\s*:|тема\s*:)/iu.test(candidate)) issues.push("тема письма попала в текст");
  if (/\b(?:решил|решила|хотел|хотела)\b/i.test(candidate)) issues.push("текст приписывает отправителю пол");
  if (/(?:успел\p{L}*|получил\p{L}*|прочитал\p{L}*|ознакомил\p{L}*|посмотрел\p{L}*).{0,35}(?:письм|сообщен|предложен|тем)/iu.test(candidate)
    || /(?:письм|сообщен).{0,24}(?:потерял|затерял|увидел|получил|прочитал)/iu.test(candidate)) {
    issues.push("есть предположение, что получатель видел или читал письмо");
  }
  if (/(?:не буду|не хочу).{0,20}(?:мешать|беспокоить)|не до (?:этого|письма)|сейчас не время|может быть не до/iu.test(candidate)) {
    issues.push("придумана причина отсутствия ответа");
  }

  const newAsset = firstNewMatch(lower, previousLower, ["пример", "кейс", "материал", "расчёт", "расчет", "презентаци"]);
  if (newAsset) issues.push(`появился не упомянутый ранее материал: ${newAsset}`);
  const newPeople = firstNewMatch(lower, previousLower, ["команд", "коллег", "сотрудник", "кому переслать", "другому человеку"]);
  if (newPeople) issues.push(`появились не упомянутые ранее люди: ${newPeople}`);

  const relativeTime = /\b(?:сегодня|завтра|послезавтра|на этой неделе|на следующей неделе)\b/iu;
  const duration = /\b(?:\d+|пара|несколько)\s+(?:минут|час\p{L}*|дн\p{L}*|недел\p{L}*)/iu;
  if ((relativeTime.test(candidate) && !relativeTime.test(previous)) || (duration.test(candidate) && !duration.test(previous))) {
    issues.push("появился новый срок или оценка времени");
  }

  const opening = candidate.match(/^([\p{L}Ёё-]{2,40})[!,]/u)?.[1];
  const discourseStarters = new Set([
    "может", "понимаю", "возможно", "если", "возвращаясь", "подскажите",
    "здравствуйте", "напомню", "коротко", "пожалуй", "ещё", "еще",
  ]);
  if (opening && !discourseStarters.has(opening.toLocaleLowerCase("ru-RU")) && !containsWord(previousLower, opening)) {
    issues.push("появилось имя или обращение, которого не было в прошлом письме");
  }

  if (followupsSent >= 2 && !/(?:вернут|актуал|позже|закро|останов|на связи|ответ)/iu.test(candidate)) {
    issues.push("финальный follow-up не завершает цепочку мягко");
  }

  return issues;
}

function firstNewMatch(candidate: string, previous: string, stems: string[]) {
  return stems.find((stem) => candidate.includes(stem) && !previous.includes(stem));
}

function containsWord(value: string, word: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}])${escaped}(?:$|[^\\p{L}])`, "iu").test(value);
}
