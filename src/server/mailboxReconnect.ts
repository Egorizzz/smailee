import { config } from "@/lib/config";
import { decryptSecret } from "@/lib/crypto";
import { validateMailbox } from "@/lib/mail/validate";
import { prisma } from "@/lib/prisma";
import { queueTechnicalAlert } from "@/server/adminNotifications";

const NETWORK_ATTEMPTS_BEFORE_ALERT = 3;

function reconnectDelay(attempt: number) {
  return Math.min(
    config.mailboxReconnect.maxDelayMs,
    config.mailboxReconnect.baseDelayMs * 2 ** Math.max(0, attempt),
  );
}

async function alertMailboxPaused(input: {
  userId: string;
  mailboxId: string;
  email: string;
  reason: string;
  auth: boolean;
  now: Date;
}) {
  const action = input.auth
    ? "Проверьте пароль приложения и переподключите ящик в разделе «Инфраструктура»."
    : "Smailee продолжит проверять подключение автоматически. При необходимости проверьте доступность SMTP/IMAP у провайдера.";
  return queueTechnicalAlert({
    ownerId: input.userId,
    type: "MAILBOX_PAUSED",
    resourceKey: input.mailboxId,
    subject: `[Smailee] Почтовый ящик ${input.email} приостановлен`,
    text: [
      `Ящик ${input.email} исключён из отправки, приёма и прогрева.`,
      `Причина: ${input.reason}`,
      action,
      "Повторное уведомление по этому ящику придёт не раньше чем через сутки.",
    ].join("\n\n"),
    now: input.now,
  });
}

/**
 * Revalidates temporarily unavailable mailboxes. Network failures get three
 * attempts (15/30/60 min by default) before an alert; auth failures are not
 * hammered repeatedly because providers may lock the account.
 */
export async function reconnectMailboxes(
  now = new Date(),
  validator: typeof validateMailbox = validateMailbox,
) {
  const mailboxes = await prisma.mailbox.findMany({
    where: {
      connState: { in: ["unreachable", "disabled"] },
      pauseKind: "NETWORK",
      nextReconnectAt: { lte: now },
    },
    take: 20,
  });

  let checked = 0;
  let recovered = 0;
  let alerted = 0;
  for (const mailbox of mailboxes) {
    checked++;
    const result = await validator({
      email: mailbox.email,
      smtpHost: mailbox.smtpHost,
      smtpPort: mailbox.smtpPort,
      smtpSecurity: mailbox.smtpSecurity,
      imapHost: mailbox.imapHost,
      imapPort: mailbox.imapPort,
      imapSecurity: mailbox.imapSecurity,
      smtpLogin: mailbox.smtpLogin,
      imapLogin: mailbox.imapLogin,
      smtpPassword: decryptSecret(mailbox.smtpPasswordEnc),
      imapPassword: decryptSecret(mailbox.imapPasswordEnc),
    });

    if (result.connState === "ok") {
      await prisma.mailbox.update({
        where: { id: mailbox.id },
        data: {
          connState: "ok",
          connError: null,
          pausedReason: null,
          pauseKind: null,
          connectionIncidentAt: null,
          reconnectAttempts: 0,
          nextReconnectAt: null,
          lastValidatedAt: now,
          healthScore: 100,
        },
      });
      recovered++;
      continue;
    }

    const attempt = mailbox.reconnectAttempts + 1;
    const auth = result.connState === "auth_error";
    const reason = `Ошибка подключения: ${result.error ?? result.connState}`;
    const shouldAlert = auth || attempt >= NETWORK_ATTEMPTS_BEFORE_ALERT;
    const disabled = shouldAlert;
    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        connState: disabled ? "disabled" : "unreachable",
        connError: result.error ?? null,
        pausedReason: reason,
        pauseKind: auth ? "AUTH" : "NETWORK",
        reconnectAttempts: attempt,
        // Auth waits for manual reconnect; network retries continue with backoff.
        nextReconnectAt: auth ? null : new Date(now.getTime() + reconnectDelay(attempt)),
        lastValidatedAt: now,
      },
    });
    if (shouldAlert) {
      const queued = await alertMailboxPaused({
        userId: mailbox.userId,
        mailboxId: mailbox.id,
        email: mailbox.email,
        reason,
        auth,
        now,
      });
      if (queued !== false) alerted++;
    }
  }
  return { checked, recovered, alerted };
}
