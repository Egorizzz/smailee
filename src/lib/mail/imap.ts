import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { Mailbox } from "@prisma/client";

/**
 * IMAP-приём для КОНКРЕТНОГО ящика клиента (модель C, §5.4).
 *
 * Провайдер-агностично: host/port/security берутся из записи Mailbox (уже
 * разрешены при подключении, см. src/lib/mail/profiles.ts), ветвления по
 * provider здесь нет.
 *
 * НЕ импортирует "server-only": вызывается из standalone-воркера вне Next.
 * Расшифрованный IMAP-пароль передаётся вызывающей стороной и живёт только на
 * время вызова (§8.2).
 */

export type FetchedEmail = {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromEmail: string | null;
  fromName: string | null;
  subject: string;
  text: string | null;
  html: string | null;
  date: Date | null;
};

export type PollResult =
  | {
      ok: true;
      /** true = UIDVALIDITY сменилась (или это первый опрос) — emails всегда
       *  пуст, вызывающая сторона просто сохраняет новый baseline (uidValidity/
       *  uidNext), не поднимая старую переписку как "новые" письма. */
      reset: boolean;
      uidValidity: number;
      uidNext: number;
      emails: FetchedEmail[];
    }
  | { ok: false; error: string; kind: "auth" | "network" | "other" };

function classifyError(err: unknown): "auth" | "network" | "other" {
  const message = err instanceof Error ? err.message : String(err);
  if (/auth|credential|invalid login|login failed/i.test(message)) return "auth";
  if (/econnrefused|etimedout|enotfound|dns|closed/i.test(message)) return "network";
  return "other";
}

function firstAddress(list: unknown): { address: string | null; name: string | null } {
  const value = (list as { value?: { address?: string; name?: string }[] } | undefined)?.value?.[0];
  return { address: value?.address ?? null, name: value?.name ?? null };
}

function toReferencesArray(refs: unknown): string[] {
  if (!refs) return [];
  if (Array.isArray(refs)) return refs;
  return String(refs).split(/\s+/).filter(Boolean);
}

/**
 * Проверка IMAP-логина без чтения писем (для валидации ящика при подключении,
 * §5.1). Успешный connect+logout сам по себе подтверждает логин и доступность
 * IMAP-сервера. Таймаут ограничивает висение на мёртвом хосте.
 */
export async function verifyImapLogin(
  mailbox: Pick<Mailbox, "imapHost" | "imapPort" | "imapSecurity" | "imapLogin">,
  imapPassword: string
): Promise<{ ok: boolean; error?: string; kind?: "auth" | "network" | "other" }> {
  const client = new ImapFlow({
    host: mailbox.imapHost,
    port: mailbox.imapPort,
    secure: mailbox.imapSecurity === "SSL",
    auth: { user: mailbox.imapLogin, pass: imapPassword },
    logger: false,
    // не висеть на недоступном хосте дольше ~10 с (валидация синхронна в UI)
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await client.connect();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), kind: classifyError(err) };
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

/**
 * Опрашивает INBOX ящика. `expectedUidValidity`/`lastUid` — то, что известно
 * из БД (Mailbox.imapUidValidity/imapLastUid). Если UIDVALIDITY изменилась
 * (или ещё не известна — первый опрос) — письма не забираются, только
 * возвращается новый baseline: не поднимаем историю ящика как "новые ответы".
 */
export async function pollMailboxInbox(
  mailbox: Pick<Mailbox, "imapHost" | "imapPort" | "imapSecurity" | "imapLogin">,
  imapPassword: string,
  expectedUidValidity: number | null,
  lastUid: number
): Promise<PollResult> {
  const client = new ImapFlow({
    host: mailbox.imapHost,
    port: mailbox.imapPort,
    secure: mailbox.imapSecurity === "SSL",
    auth: { user: mailbox.imapLogin, pass: imapPassword },
    logger: false,
  });

  try {
    await client.connect();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), kind: classifyError(err) };
  }

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const box = client.mailbox;
      if (!box) throw new Error("INBOX не открылся");

      const uidValidity = Number(box.uidValidity);
      const uidNext = box.uidNext;
      const reset = expectedUidValidity === null || expectedUidValidity !== uidValidity;

      if (reset || uidNext - 1 <= lastUid) {
        return { ok: true, reset, uidValidity, uidNext, emails: [] };
      }

      const emails: FetchedEmail[] = [];
      for await (const msg of client.fetch(
        `${lastUid + 1}:*`,
        { source: true, uid: true },
        { uid: true }
      )) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const from = firstAddress(parsed.from);
        emails.push({
          uid: msg.uid,
          messageId: parsed.messageId ?? null,
          inReplyTo: parsed.inReplyTo ?? null,
          references: toReferencesArray(parsed.references),
          fromEmail: from.address,
          fromName: from.name,
          subject: parsed.subject ?? "",
          text: parsed.text ?? null,
          html: typeof parsed.html === "string" ? parsed.html : null,
          date: parsed.date ?? null,
        });
      }

      return { ok: true, reset: false, uidValidity, uidNext, emails };
    } finally {
      lock.release();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), kind: classifyError(err) };
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

/**
 * Открывает соединение, выполняет `fn` с заблокированной папкой `folder`, и
 * аккуратно закрывает — общий каркас для точечных IMAP-операций движка
 * прогрева (§5.6: пометить прочитанным/важным, спасти из спама).
 */
async function withMailboxLock<T>(
  mailbox: Pick<Mailbox, "imapHost" | "imapPort" | "imapSecurity" | "imapLogin">,
  imapPassword: string,
  folder: string,
  fn: (client: ImapFlow) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: string; kind: "auth" | "network" | "other" }> {
  const client = new ImapFlow({
    host: mailbox.imapHost,
    port: mailbox.imapPort,
    secure: mailbox.imapSecurity === "SSL",
    auth: { user: mailbox.imapLogin, pass: imapPassword },
    logger: false,
  });
  try {
    await client.connect();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), kind: classifyError(err) };
  }
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const value = await fn(client);
      return { ok: true, value };
    } finally {
      lock.release();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), kind: classifyError(err) };
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

/** Помечает письмо прочитанным (\Seen) — «принимающая сторона» прогрева (§5.6). */
export async function markSeen(
  mailbox: Pick<Mailbox, "imapHost" | "imapPort" | "imapSecurity" | "imapLogin">,
  imapPassword: string,
  uid: number
): Promise<boolean> {
  const res = await withMailboxLock(mailbox, imapPassword, "INBOX", (client) =>
    client.messageFlagsAdd(uid, ["\\Seen"], { uid: true })
  );
  return res.ok && Boolean(res.value);
}

/** Помечает письмо флажком "важное" (\Flagged) — иногда, по ТЗ §5.6. */
export async function flagImportant(
  mailbox: Pick<Mailbox, "imapHost" | "imapPort" | "imapSecurity" | "imapLogin">,
  imapPassword: string,
  uid: number
): Promise<boolean> {
  const res = await withMailboxLock(mailbox, imapPassword, "INBOX", (client) =>
    client.messageFlagsAdd(uid, ["\\Flagged"], { uid: true })
  );
  return res.ok && Boolean(res.value);
}

/**
 * Сканирует папку "Спам" на прогревочные маркеры и переносит найденные в
 * INBOX (§5.6: «вытащить из спама»). `extractCode` — детектор маркера
 * (warmupDetector.ts), передаётся вызывающей стороной, чтобы imap.ts не
 * зависел от формата маркера. Возвращает список {uid, code} перенесённых писем.
 */
export async function rescueWarmupFromSpam(
  mailbox: Pick<Mailbox, "imapHost" | "imapPort" | "imapSecurity" | "imapLogin" | "spamFolder">,
  imapPassword: string,
  extractCode: (email: Pick<FetchedEmail, "subject" | "text" | "html">) => string | null,
  limit = 30
): Promise<{ ok: true; rescued: { uid: number; code: string }[] } | { ok: false; error: string }> {
  const res = await withMailboxLock(mailbox, imapPassword, mailbox.spamFolder, async (client) => {
    const box = client.mailbox;
    if (!box) return [];
    const from = Math.max(1, box.uidNext - limit);
    const rescued: { uid: number; code: string }[] = [];
    for await (const msg of client.fetch(`${from}:*`, { source: true, uid: true }, { uid: true })) {
      if (!msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const code = extractCode({
        subject: parsed.subject ?? "",
        text: parsed.text ?? null,
        html: typeof parsed.html === "string" ? parsed.html : null,
      });
      if (!code) continue;
      const moved = await client.messageMove(msg.uid, "INBOX", { uid: true });
      if (moved) rescued.push({ uid: msg.uid, code });
    }
    return rescued;
  });
  if (!res.ok) {
    // папки "Спам" может не быть под этим именем на конкретном аккаунте —
    // не считаем это фатальной ошибкой опроса, просто нечего спасать
    return { ok: true, rescued: [] };
  }
  return { ok: true, rescued: res.value };
}
