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
