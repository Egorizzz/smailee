import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  classifyDeliveryIssue,
  type DeliveryIssue,
  type DeliveryReport,
} from "@/lib/mail/deliverySignals";
import { sendSystemMail } from "@/lib/systemMail";
import { config } from "@/lib/config";

export async function recordDeliverySignal(input: {
  messageId: string;
  source: "SMTP" | "DSN";
  key: string;
  issue?: DeliveryIssue;
  delivered?: boolean;
  payload: Prisma.InputJsonValue;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const m = await tx.message.findUnique({
      where: { id: input.messageId },
      include: { campaign: true, contact: true },
    });
    if (!m) return;
    // The outbox, counters and contact block commit with the deduplicated event.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`delivery-signal:${m.mailboxId ?? m.id}`}))`;
    const externalKey = createHash("sha256").update(input.key).digest("hex");
    if (await tx.event.findUnique({ where: { externalKey } })) return;
    await tx.event.create({
      data: {
        messageId: m.id,
        externalKey,
        type: input.delivered
          ? "delivered"
          : input.source === "DSN"
            ? "bounce"
            : "smtp",
        payload: input.payload,
        createdAt: now,
      },
    });
    if (input.delivered && (!m.deliveryIssue || m.deliveryIssue === "DELAYED"))
      await tx.message.update({
        where: { id: m.id },
        data: { deliveredAt: now, deliveryIssue: null, deliveryIssueAt: null },
      });
    if (!input.issue) return;
    if (
      input.issue === m.deliveryIssue ||
      (input.issue === "DELAYED" && m.deliveryIssue)
    )
      return;
    await tx.message.update({
      where: { id: m.id },
      data: {
        deliveryIssue: input.issue,
        deliveryIssueAt: now,
        ...(input.source === "DSN" && input.issue !== "DELAYED"
          ? { status: "BOUNCED" as const }
          : {}),
      },
    });
    if (input.issue === "DELAYED") return;
    if (input.issue === "REJECTED") return;
    const reason =
      input.issue === "SPAM_REJECTED" ? "spam_rejected" : "bounced";
    const previous = await tx.suppression.findUnique({
      where: {
        userId_email: { userId: m.campaign.userId, email: m.contact.email },
      },
    });
    // Never downgrade an opt-out/complaint or reopen one as a side effect.
    if (
      !previous ||
      previous.releasedAt ||
      ["bounced", "spam_rejected"].includes(previous.reason)
    ) {
      await tx.suppression.upsert({
        where: {
          userId_email: { userId: m.campaign.userId, email: m.contact.email },
        },
        create: { userId: m.campaign.userId, email: m.contact.email, reason },
        update: { reason, releasedAt: null, createdAt: now },
      });
    }
    await tx.message.updateMany({
      where: {
        contactId: m.contactId,
        campaign: { userId: m.campaign.userId, isDemo: false },
        status: "PENDING",
      },
      data: {
        status: "CANCELLED",
        plannedSendAt: null,
        plannedMailboxId: null,
      },
    });
    if (input.issue !== "SPAM_REJECTED" || !m.mailboxId) return;
    const state = await tx.campaignMailboxState.upsert({
      where: {
        campaignId_mailboxId: {
          campaignId: m.campaignId,
          mailboxId: m.mailboxId,
        },
      },
      create: {
        campaignId: m.campaignId,
        mailboxId: m.mailboxId,
        spamRejections: 1,
      },
      update: { spamRejections: { increment: 1 } },
    });
    // Yandex may extend a block on repeated attempts. Cooling down also gates warmup.
    const cooldown = new Date(now.getTime() + 24 * 3_600_000);
    const senderState = await tx.mailbox.update({
      where: { id: m.mailboxId },
      data: {
        smtpBlockedUntil: cooldown,
        spamRejectionsSinceWarmup: { increment: 1 },
      },
    });
    if (
      senderState.spamRejectionsSinceWarmup > 5 &&
      (!state.excludedAt || state.resumedAt)
    ) {
      await tx.campaignMailboxState.update({
        where: { id: state.id },
        data: {
          excludedAt: now,
          resumedAt: null,
          notificationSentAt: null,
          notificationClaimedAt: null,
          notificationNextAt: now,
        },
      });
      await tx.mailbox.update({
        where: { id: m.mailboxId },
        data: {
          warmupState: "warming",
          warmupStartedAt: cooldown,
          warmupDay: 0,
        },
      });
      await tx.message.updateMany({
        where: {
          campaignId: m.campaignId,
          plannedMailboxId: m.mailboxId,
          status: "PENDING",
        },
        data: { plannedSendAt: null, plannedMailboxId: null },
      });
      await tx.campaign.update({
        where: { id: m.campaignId },
        data: { plannedCompletionAt: null },
      });
    }
  });
}

export async function ingestDeliveryReports(
  mailboxId: string,
  externalId: string,
  reports: DeliveryReport[],
) {
  const b = await prisma.mailbox.findUnique({ where: { id: mailboxId } });
  if (!b) return;
  for (const [index, r] of reports.entries()) {
    // A recipient alone is not sufficient: require an exact original Message-ID.
    const matches = r.originalIds.length
      ? await prisma.message.findMany({
          where: {
            campaign: { userId: b.userId },
            mailboxId,
            contact: { email: r.recipient },
            OR: [
              { messageIdHeader: { in: r.originalIds } },
              { providerMessageId: { in: r.originalIds } },
            ],
          },
          select: { id: true },
          take: 2,
        })
      : [];
    if (matches.length !== 1) {
      console.warn("[DEL-1404] unmatched delivery report", {
        mailboxId,
        externalId,
        recipient: r.recipient,
      });
      continue;
    }
    if (
      !["failed", "delayed", "delivered", "relayed", "expanded"].includes(
        r.action,
      )
    )
      continue;
    await recordDeliverySignal({
      messageId: matches[0].id,
      source: "DSN",
      key: `dsn:${mailboxId}:${externalId}:${index}`,
      delivered: r.action === "delivered",
      issue:
        r.action === "failed" || r.action === "delayed"
          ? classifyDeliveryIssue(r.diagnostic, r.status)
          : undefined,
      payload: { ...r, source: "DSN" },
    });
  }
}

export async function deliverCampaignMailboxNotices(
  now = new Date(),
  mailer = sendSystemMail,
) {
  const notices = await prisma.campaignMailboxState.findMany({
    where: {
      excludedAt: { not: null },
      notificationSentAt: null,
      notificationNextAt: { lte: now },
      OR: [
        { notificationClaimedAt: null },
        { notificationClaimedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
      ],
    },
    include: { campaign: { include: { user: true } }, mailbox: true },
    take: 10,
  });
  for (const n of notices) {
    const claim = await prisma.campaignMailboxState.updateMany({
      where: {
        id: n.id,
        notificationSentAt: null,
        OR: [
          { notificationClaimedAt: null },
          {
            notificationClaimedAt: { lt: new Date(now.getTime() - 5 * 60_000) },
          },
        ],
      },
      data: { notificationClaimedAt: now },
    });
    if (!claim.count) continue;
    const text = `Ящик ${n.mailbox.email} временно отключён от кампании «${n.campaign.name}» после отказов антиспама и направлен на повторный прогрев. Прогрев начнётся после паузы отправки. Ещё не отправленные письма будут распределены между доступными ящиками. Если других ящиков нет, очередь сохранится.\n${config.appUrl}/app/campaigns/${n.campaignId}`;
    const result = await mailer({
      to: n.campaign.user.email,
      subject: "Smailee: изменилось расписание кампании",
      text,
      html: `<p>${text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!).replace(/\n/g, "<br>")}</p>`,
    });
    await prisma.campaignMailboxState.update({
      where: { id: n.id },
      data: {
        notificationSentAt: result.ok ? now : null,
        notificationClaimedAt: null,
        notificationNextAt: new Date(now.getTime() + 15 * 60_000),
      },
    });
  }
}
