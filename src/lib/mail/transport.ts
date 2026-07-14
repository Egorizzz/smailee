import nodemailer from "nodemailer";
import type { Mailbox } from "@prisma/client";

/**
 * Транспорт для отправки письма через КОНКРЕТНЫЙ ящик клиента (модель C, §5.3).
 *
 * Провайдер-агностично по построению: host/port/security уже разрешены в
 * записи Mailbox в момент подключения (см. src/lib/mail/profiles.ts), здесь
 * нет ветвления по provider — просто используем то, что сохранено в ящике.
 *
 * НЕ импортирует "server-only": вызывается из standalone-воркера (npm run
 * worker) вне Next-рантайма, где react-server-условие не действует.
 *
 * Расшифрованный пароль передаётся вызывающей стороной (sendEngine) и живёт
 * только на время этого вызова — здесь не логируется и не сохраняется (§8.2).
 */

export type SendMailInput = {
  to: string;
  toName?: string | null;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  // Для непрерывности треда AI-ответов (M3, §5.5) — nodemailer форматирует их
  // как отдельные RFC 5322-корректные заголовки, не через generic headers.
  inReplyTo?: string;
  references?: string;
};

export type SendMailResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; kind: "auth" | "network" | "other" };

export async function sendViaMailbox(
  mailbox: Pick<Mailbox, "smtpHost" | "smtpPort" | "smtpSecurity" | "smtpLogin" | "senderName" | "email">,
  smtpPassword: string,
  input: SendMailInput
): Promise<SendMailResult> {
  const transporter = nodemailer.createTransport({
    host: mailbox.smtpHost,
    port: mailbox.smtpPort,
    secure: mailbox.smtpSecurity === "SSL", // SSL = implicit TLS (465); STARTTLS = upgrade на 587
    auth: { user: mailbox.smtpLogin, pass: smtpPassword },
  });

  try {
    const info = await transporter.sendMail({
      from: `"${mailbox.senderName}" <${mailbox.email}>`,
      to: input.toName ? `"${input.toName}" <${input.to}>` : input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
      headers: input.headers,
      inReplyTo: input.inReplyTo,
      references: input.references,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const kind = /auth|credential|invalid login/i.test(message)
      ? "auth"
      : /econnrefused|etimedout|enotfound|dns/i.test(message)
        ? "network"
        : "other";
    return { ok: false, error: message, kind };
  } finally {
    transporter.close();
  }
}

/** Быстрая проверка SMTP-логина без отправки письма (для валидации ящика, §5.1). */
export async function verifySmtpAuth(
  mailbox: Pick<Mailbox, "smtpHost" | "smtpPort" | "smtpSecurity" | "smtpLogin">,
  smtpPassword: string
): Promise<{ ok: boolean; error?: string; kind?: "auth" | "network" | "other" }> {
  const transporter = nodemailer.createTransport({
    host: mailbox.smtpHost,
    port: mailbox.smtpPort,
    secure: mailbox.smtpSecurity === "SSL",
    auth: { user: mailbox.smtpLogin, pass: smtpPassword },
    // не висеть на недоступном хосте (валидация синхронна в UI)
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const kind = /auth|credential|invalid login|username|password/i.test(message)
      ? "auth"
      : /econnrefused|etimedout|enotfound|dns|timeout/i.test(message)
        ? "network"
        : "other";
    return { ok: false, error: message, kind };
  } finally {
    transporter.close();
  }
}
