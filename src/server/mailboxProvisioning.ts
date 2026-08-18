import type { MailProvider } from "@prisma/client";
import { config } from "@/lib/config";
import { encryptSecret } from "@/lib/crypto";
import { getProfile } from "@/lib/mail/profiles";
import { validateMailbox } from "@/lib/mail/validate";
import { prisma } from "@/lib/prisma";

export type MailboxProvisionMode = "customer" | "seed";

export type ProvisionMailboxInput = {
  userId: string;
  email: string;
  senderName: string;
  provider: MailProvider;
  appPassword: string;
  mode: MailboxProvisionMode;
  alreadyWarm?: boolean;
};

export function confirmedWarmupData(now: Date) {
  return {
    warmupState: "warm" as const,
    warmupStartedAt: new Date(
      now.getTime() - Math.max(0, config.warmup.rampDays - 1) * config.warmup.dayMs,
    ),
    warmupDay: config.warmup.rampDays,
  };
}

/**
 * Shared mailbox provisioning for customer senders and dedicated service seeds.
 * Authentication and authorization must be checked by the calling Server Action.
 */
export async function provisionMailbox(input: ProvisionMailboxInput): Promise<string | null> {
  const profile = getProfile(input.provider);
  if (!profile) return `Профиль провайдера ${input.provider} пока не поддержан (доступен Яндекс 360)`;

  const email = input.email.trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  if (!domain) return `Некорректный email: ${input.email}`;

  const existing = await prisma.mailbox.findUnique({
    where: { userId_email: { userId: input.userId, email } },
    select: { warmupState: true, warmupStartedAt: true, warmupDay: true },
  });

  const domainGroup = await prisma.domainGroup.upsert({
    where: { userId_domain: { userId: input.userId, domain } },
    update: {},
    create: { userId: input.userId, domain },
  });

  const result = await validateMailbox({
    email,
    smtpHost: profile.smtp.host,
    smtpPort: profile.smtp.port,
    smtpSecurity: profile.smtp.security,
    imapHost: profile.imap.host,
    imapPort: profile.imap.port,
    imapSecurity: profile.imap.security,
    smtpLogin: email,
    imapLogin: email,
    smtpPassword: input.appPassword,
    imapPassword: input.appPassword,
  });

  const now = new Date();
  const alreadyWarmData = confirmedWarmupData(now);
  const connectionData = {
    senderName: input.senderName,
    provider: input.provider,
    smtpHost: profile.smtp.host,
    smtpPort: profile.smtp.port,
    smtpSecurity: profile.smtp.security,
    smtpLogin: email,
    imapHost: profile.imap.host,
    imapPort: profile.imap.port,
    imapSecurity: profile.imap.security,
    imapLogin: email,
    smtpPasswordEnc: encryptSecret(input.appPassword),
    imapPasswordEnc: encryptSecret(input.appPassword),
    domainGroupId: domainGroup.id,
    connState: result.connState,
    connError: result.error ?? null,
    pausedReason: null,
    pauseKind:
      result.connState === "unreachable"
        ? ("NETWORK" as const)
        : result.connState === "auth_error"
          ? ("AUTH" as const)
          : null,
    connectionIncidentAt: result.connState === "ok" ? null : now,
    reconnectAttempts: 0,
    nextReconnectAt:
      result.connState === "unreachable"
        ? new Date(now.getTime() + config.mailboxReconnect.baseDelayMs)
        : null,
    lastValidatedAt: now,
    spamFolder: profile.spamFolder,
  };

  await prisma.mailbox.upsert({
    where: { userId_email: { userId: input.userId, email } },
    update: {
      ...connectionData,
      isSeed: input.mode === "seed",
      ...(input.mode === "seed"
        ? { warmupState: "off" as const }
        : input.alreadyWarm
          ? alreadyWarmData
        : result.connState === "ok" && (!existing || existing.warmupState === "off")
          ? {
              warmupState: "warming" as const,
              warmupStartedAt: existing?.warmupStartedAt ?? now,
              warmupDay: Math.max(1, existing?.warmupDay ?? 0),
            }
          : {}),
    },
    create: {
      userId: input.userId,
      email,
      ...connectionData,
      isSeed: input.mode === "seed",
      warmupState:
        input.mode === "customer" && input.alreadyWarm
          ? alreadyWarmData.warmupState
          : input.mode === "customer" && result.connState === "ok"
            ? "warming"
            : "off",
      warmupStartedAt:
        input.mode === "customer" && input.alreadyWarm
          ? alreadyWarmData.warmupStartedAt
          : input.mode === "customer" && result.connState === "ok"
            ? now
            : null,
      warmupDay:
        input.mode === "customer" && input.alreadyWarm
          ? alreadyWarmData.warmupDay
          : input.mode === "customer" && result.connState === "ok"
            ? 1
            : 0,
    },
  });

  if (result.connState !== "ok") {
    return `Ящик сохранён, но подключение не прошло: ${result.error ?? "проверьте пароль приложения и настройки SMTP/IMAP"}`;
  }
  return null;
}
