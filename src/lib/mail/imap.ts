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
  isDeliveryReport?: boolean;
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

/**
 * Поля ошибки imapflow. Библиотека НЕ кладёт причину в message: там всегда
 * generic "Command failed" (lib/imap-flow.js), а детали расходятся по
 * отдельным полям — authenticationFailed выставляется при любом отказе LOGIN
 * (lib/commands/login.js), serverResponseCode и responseText несут ответ сервера.
 */
type ImapErrorShape = {
  message?: string;
  authenticationFailed?: boolean;
  responseText?: string;
  serverResponseCode?: string;
  code?: string;
};

type ImapMailboxConfig = Pick<
  Mailbox,
  "imapHost" | "imapPort" | "imapSecurity" | "imapLogin"
>;

/**
 * ImapFlow сообщает часть ошибок активного соединения через EventEmitter,
 * отдельно от Promise текущей команды. Без error-listener стандартное
 * поведение Node — завершить весь процесс, даже если connect/fetch обёрнуты в
 * try/catch. Listener ставится до connect и сохраняет исходную ошибку, чтобы
 * вызывающий код вернул её как обычный результат проверки конкретного ящика.
 */
function createImapClient(mailbox: ImapMailboxConfig, imapPassword: string) {
  let emittedError: unknown = null;
  const client = new ImapFlow({
    host: mailbox.imapHost,
    port: mailbox.imapPort,
    secure: mailbox.imapSecurity === "SSL",
    auth: { user: mailbox.imapLogin, pass: imapPassword },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  client.on("error", (error) => {
    emittedError ??= error;
  });

  return {
    client,
    error: (fallback: unknown) => emittedError ?? fallback,
  };
}

/**
 * Классификация ошибки IMAP.
 *
 * Раньше смотрели только на message — и промахивались на самом важном случае:
 * Яндекс на неверный пароль отдаёт ровно "Command failed", где нет ни "auth",
 * ни "login". Отказ уходил в "other", а при "other" вызывающий код НЕ меняет
 * connState — ящик со сброшенным паролем оставался зелёным и в ротации,
 * поллинг молча падал каждую минуту, и снаружи это было незаметно.
 * Проверено вживую на Яндекс 360 (2026-07-29).
 */
export function classifyImapError(err: unknown): "auth" | "network" | "other" {
  const e = (err ?? {}) as ImapErrorShape;
  // самый надёжный признак: библиотека сама пометила отказ аутентификации
  if (e.authenticationFailed) return "auth";
  const text = [e.message, e.responseText, e.serverResponseCode, e.code]
    .filter(Boolean)
    .join(" ");
  if (/auth|credential|invalid login|login failed/i.test(text)) return "auth";
  if (
    /econnrefused|etimeout|etimedout|connect_timeout|greeting_timeout|timeout|enotfound|dns|closed/i.test(
      text,
    )
  )
    return "network";
  return "other";
}

/**
 * Человекочитаемый текст ошибки для интерфейса. Без него в карточке ящика
 * оставалось бесполезное "Command failed" — по такому сообщению невозможно
 * понять, что именно не так.
 */
export function describeImapError(err: unknown): string {
  const e = (err ?? {}) as ImapErrorShape;
  const base = e.message ?? String(err);
  const detail = e.responseText ?? e.serverResponseCode;
  return detail ? `${base}: ${detail}` : base;
}

function firstAddress(list: unknown): {
  address: string | null;
  name: string | null;
} {
  const value = (
    list as { value?: { address?: string; name?: string }[] } | undefined
  )?.value?.[0];
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
  mailbox: Pick<
    Mailbox,
    "imapHost" | "imapPort" | "imapSecurity" | "imapLogin"
  >,
  imapPassword: string,
): Promise<{
  ok: boolean;
  error?: string;
  kind?: "auth" | "network" | "other";
}> {
  const connection = createImapClient(mailbox, imapPassword);
  const { client } = connection;
  try {
    await client.connect();
    return { ok: true };
  } catch (err) {
    const cause = connection.error(err);
    return {
      ok: false,
      error: describeImapError(cause),
      kind: classifyImapError(cause),
    };
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
  mailbox: Pick<
    Mailbox,
    "imapHost" | "imapPort" | "imapSecurity" | "imapLogin"
  >,
  imapPassword: string,
  expectedUidValidity: number | null,
  lastUid: number,
): Promise<PollResult> {
  const connection = createImapClient(mailbox, imapPassword);
  const { client } = connection;

  try {
    await client.connect();
  } catch (err) {
    const cause = connection.error(err);
    return {
      ok: false,
      error: describeImapError(cause),
      kind: classifyImapError(cause),
    };
  }

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const box = client.mailbox;
      if (!box) throw new Error("INBOX не открылся");

      const uidValidity = Number(box.uidValidity);
      const uidNext = box.uidNext;
      const reset =
        expectedUidValidity === null || expectedUidValidity !== uidValidity;

      if (reset || uidNext - 1 <= lastUid) {
        return { ok: true, reset, uidValidity, uidNext, emails: [] };
      }

      const emails: FetchedEmail[] = [];
      for await (const msg of client.fetch(
        `${lastUid + 1}:*`,
        { source: true, uid: true },
        { uid: true },
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
          isDeliveryReport:
            /multipart\/report|message\/delivery-status/i.test(
              String(
                parsed.headers.get("content-type")
                  ? JSON.stringify(parsed.headers.get("content-type"))
                  : "",
              ),
            ) || /mailer-daemon|postmaster/i.test(from.address ?? ""),
        });
      }

      return { ok: true, reset: false, uidValidity, uidNext, emails };
    } finally {
      lock.release();
    }
  } catch (err) {
    const cause = connection.error(err);
    return {
      ok: false,
      error: describeImapError(cause),
      kind: classifyImapError(cause),
    };
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

/** Read delivery reports independently of the conversation cursor, including Spam.
 * The callback must persist a batch before its UID cursor is advanced. No flags change.
 */
export async function scanMailboxDeliveryReports(
  mailbox: ImapMailboxConfig,
  password: string,
  cursorFor: (
    folder: string,
  ) => Promise<{ uidValidity: string; lastUid: number } | null>,
  commit: (
    folder: string,
    uidValidity: string,
    lastUid: number,
    reports: Array<{ externalId: string; source: string }>,
  ) => Promise<void>,
) {
  const { client } = createImapClient(mailbox, password);
  try {
    await client.connect();
    const folders = await client.list();
    for (const folder of folders) {
      if (
        folder.flags?.has("\\Noselect") ||
        ["\\Sent", "\\Trash", "\\Drafts"].includes(folder.specialUse ?? "")
      )
        continue;
      const lock = await client.getMailboxLock(folder.path);
      try {
        const box = client.mailbox;
        if (!box) continue;
        const validity = String(box.uidValidity);
        const saved = await cursorFor(folder.path);
        const lastUid =
          saved?.uidValidity === validity
            ? saved.lastUid
            : Math.max(0, box.uidNext - 201);
        const end = Math.min(box.uidNext - 1, lastUid + 100);
        if (end <= lastUid) continue;
        const reports: Array<{ externalId: string; source: string }> = [];
        const reportUids: number[] = [];
        for await (const msg of client.fetch(
          `${lastUid + 1}:${end}`,
          { headers: ["content-type", "from"], size: true, uid: true },
          { uid: true },
        )) {
          const headers = msg.headers?.toString("utf8") ?? "";
          if (
            !/multipart\/report|message\/delivery-status|mailer-daemon|postmaster/i.test(
              headers,
            )
          )
            continue;
          if ((msg.size ?? 0) > 2_000_000)
            reports.push({
              externalId: `${folder.path}:${validity}:${msg.uid}`,
              source: headers,
            });
          else reportUids.push(msg.uid);
        }
        // Finish the first iterator before issuing the second IMAP command.
        if (reportUids.length)
          for await (const msg of client.fetch(
            reportUids.join(","),
            { source: true, uid: true },
            { uid: true },
          )) {
            if (!msg.source) continue;
            const raw = msg.source.toString("utf8");
            const parsed = await simpleParser(msg.source);
            const attachments = parsed.attachments
              .filter((a) =>
                /message\/rfc822|text\/rfc822-headers|message\/delivery-status/i.test(
                  a.contentType,
                ),
              )
              .map((a) => a.content.toString("utf8"))
              .join("\n");
            reports.push({
              externalId:
                parsed.messageId ?? `${folder.path}:${validity}:${msg.uid}`,
              source: `${raw}\n${parsed.text ?? ""}\n${attachments}`,
            });
          }
        await commit(folder.path, validity, end, reports);
      } finally {
        lock.release();
      }
    }
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
  mailbox: Pick<
    Mailbox,
    "imapHost" | "imapPort" | "imapSecurity" | "imapLogin"
  >,
  imapPassword: string,
  folder: string,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<
  | { ok: true; value: T }
  | { ok: false; error: string; kind: "auth" | "network" | "other" }
> {
  const connection = createImapClient(mailbox, imapPassword);
  const { client } = connection;
  try {
    await client.connect();
  } catch (err) {
    const cause = connection.error(err);
    return {
      ok: false,
      error: describeImapError(cause),
      kind: classifyImapError(cause),
    };
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
    const cause = connection.error(err);
    return {
      ok: false,
      error: describeImapError(cause),
      kind: classifyImapError(cause),
    };
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
  mailbox: Pick<
    Mailbox,
    "imapHost" | "imapPort" | "imapSecurity" | "imapLogin"
  >,
  imapPassword: string,
  uid: number,
): Promise<boolean> {
  const res = await withMailboxLock(mailbox, imapPassword, "INBOX", (client) =>
    client.messageFlagsAdd(uid, ["\\Seen"], { uid: true }),
  );
  return res.ok && Boolean(res.value);
}

/** Помечает письмо флажком "важное" (\Flagged) — иногда, по ТЗ §5.6. */
export async function flagImportant(
  mailbox: Pick<
    Mailbox,
    "imapHost" | "imapPort" | "imapSecurity" | "imapLogin"
  >,
  imapPassword: string,
  uid: number,
): Promise<boolean> {
  const res = await withMailboxLock(mailbox, imapPassword, "INBOX", (client) =>
    client.messageFlagsAdd(uid, ["\\Flagged"], { uid: true }),
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
  mailbox: Pick<
    Mailbox,
    "imapHost" | "imapPort" | "imapSecurity" | "imapLogin" | "spamFolder"
  >,
  imapPassword: string,
  extractCode: (
    email: Pick<FetchedEmail, "subject" | "text" | "html">,
  ) => string | null,
  limit = 30,
): Promise<
  | { ok: true; rescued: { uid: number; code: string }[] }
  | { ok: false; error: string }
> {
  const res = await withMailboxLock(
    mailbox,
    imapPassword,
    mailbox.spamFolder,
    async (client) => {
      const box = client.mailbox;
      if (!box) return [];
      const from = Math.max(1, box.uidNext - limit);
      const rescued: { uid: number; code: string }[] = [];
      for await (const msg of client.fetch(
        `${from}:*`,
        { source: true, uid: true },
        { uid: true },
      )) {
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
    },
  );
  if (!res.ok) {
    // папки "Спам" может не быть под этим именем на конкретном аккаунте —
    // не считаем это фатальной ошибкой опроса, просто нечего спасать
    return { ok: true, rescued: [] };
  }
  return { ok: true, rescued: res.value };
}
