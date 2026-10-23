import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { config } from "@/lib/config";
import { DELIVERABILITY_RULES } from "@/lib/mail/deliverabilityRules";
import {
  isWithinSendWindow,
  sendWindowDayKey,
  type SendWindow,
} from "@/lib/schedule";

export function pacingGap(limit: number, window: SendWindow) {
  return window.enabled
    ? ((window.endHour - window.startHour) * 3_600_000) / Math.max(1, limit)
    : 0;
}

export function nextPacedTime(target: Date, window: SendWindow): Date {
  let value = new Date(target);
  if (!window.enabled) return value;
  // Preserve a due slot; round only while searching outside the working window.
  for (let i = 0; i < 8 * 24 * 60; i++) {
    if (isWithinSendWindow(value, window)) return value;
    value = new Date(Math.floor(value.getTime() / 60_000) * 60_000 + 60_000);
  }
  throw new Error("SEND_WINDOW_UNAVAILABLE");
}

/** All campaigns of an owner share one persisted plan and one reservation lock. */
export async function planCampaignSends(
  userId: string,
  now = new Date(),
  window: SendWindow = config.sendWindow,
) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`send-plan:${userId}`}))`;
      const campaigns = await tx.campaign.findMany({
        where: {
          userId,
          isDemo: false,
          channel: "EMAIL",
          status: { in: ["QUEUED", "SENDING", "SCHEDULED"] },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          mailboxDeliveryStates: true,
          followupSteps: { orderBy: { stepNumber: "asc" } },
        },
      });
      if (!campaigns.length) return;
      const pool = await tx.mailbox.findMany({
        where: {
          userId,
          warmupState: "warm",
          connState: { in: ["ok", "paused"] },
        },
        include: { domainGroup: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const pending = await tx.message.findMany({
        where: {
          campaignId: { in: campaigns.map((c) => c.id) },
          status: "PENDING",
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          campaignId: true,
          contactId: true,
          step: true,
          plannedSendAt: true,
          plannedMailboxId: true,
        },
      });
      const planIsCurrent =
        pending.length > 0 &&
        pending.every((m) => {
          const b = pool.find((b) => b.id === m.plannedMailboxId);
          const c = campaigns.find((c) => c.id === m.campaignId)!;
          return (
            b &&
            m.plannedSendAt &&
            !c.mailboxDeliveryStates.some(
              (s) => s.mailboxId === b.id && s.excludedAt && !s.resumedAt,
            ) &&
            m.plannedSendAt.getTime() >=
              Math.max(
                b.nextCampaignSendAt?.getTime() ?? 0,
                b.domainGroup.nextCampaignSendAt?.getTime() ?? 0,
                b.smtpBlockedUntil?.getTime() ?? 0,
              )
          );
        });
      if (planIsCurrent) return;
      const history = await tx.message.findMany({
        where: {
          campaign: { userId },
          mailboxId: { not: null },
          OR: [{ deliveryClaimedAt: { not: null } }, { sentAt: { not: null } }],
        },
        select: {
          campaignId: true,
          contactId: true,
          mailboxId: true,
          deliveryClaimedAt: true,
          sentAt: true,
        },
        orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      });
      const mailboxNext = new Map(
        pool.map((b) => [
          b.id,
          Math.max(
            now.getTime(),
            b.nextCampaignSendAt?.getTime() ?? 0,
            b.smtpBlockedUntil?.getTime() ?? 0,
          ),
        ]),
      );
      const domainNext = new Map(
        pool.map((b) => [
          b.domainGroupId,
          Math.max(
            now.getTime(),
            b.domainGroup.nextCampaignSendAt?.getTime() ?? 0,
          ),
        ]),
      );
      const usedMailbox = new Map<string, number>();
      const usedDomain = new Map<string, number>();
      const sticky = new Map<string, string>();
      for (const m of history) {
        if (m.sentAt && !sticky.has(`${m.campaignId}:${m.contactId}`))
          sticky.set(`${m.campaignId}:${m.contactId}`, m.mailboxId!);
        const b = pool.find((b) => b.id === m.mailboxId);
        if (!b || !m.deliveryClaimedAt) continue;
        const day = sendWindowDayKey(m.deliveryClaimedAt, window.timeZone);
        const mk = `${b.id}:${day}`,
          dk = `${b.domainGroupId}:${day}`;
        usedMailbox.set(mk, (usedMailbox.get(mk) ?? 0) + 1);
        usedDomain.set(dk, (usedDomain.get(dk) ?? 0) + 1);
      }
      for (const b of pool) {
        const day = sendWindowDayKey(now, window.timeZone);
        if (
          b.coldSentDate &&
          sendWindowDayKey(b.coldSentDate, window.timeZone) === day
        )
          usedMailbox.set(
            `${b.id}:${day}`,
            Math.max(usedMailbox.get(`${b.id}:${day}`) ?? 0, b.coldSentToday),
          );
        if (
          b.domainGroup.sentTodayDate &&
          sendWindowDayKey(b.domainGroup.sentTodayDate, window.timeZone) === day
        )
          usedDomain.set(
            `${b.domainGroupId}:${day}`,
            Math.max(
              usedDomain.get(`${b.domainGroupId}:${day}`) ?? 0,
              b.domainGroup.sentToday,
            ),
          );
      }
      const completion = new Map<string, Date>();
      const incomplete = new Set<string>();
      const assignments: Array<{
        id: string;
        at: Date | null;
        mailboxId: string | null;
      }> = [];
      for (const m of pending) {
        const c = campaigns.find((c) => c.id === m.campaignId)!;
        const excluded = new Set(
          c.mailboxDeliveryStates
            .filter((s) => s.excludedAt && !s.resumedAt)
            .map((s) => s.mailboxId),
        );
        const prior = sticky.get(`${c.id}:${m.contactId}`);
        const candidates = pool.filter(
          (b) => !excluded.has(b.id) && (!prior || b.id === prior),
        );
        let best: {
          id: string;
          domainId: string;
          at: Date;
          mailboxLimit: number;
          domainLimit: number;
        } | null = null;
        for (const b of candidates) {
          const ml = Math.min(
            b.coldDailyLimit,
            DELIVERABILITY_RULES.coldPerMailboxDailyMax,
          );
          const dl = Math.min(
            b.domainGroup.dailyLimit,
            DELIVERABILITY_RULES.coldPerDomainDailyMax,
          );
          if (ml <= 0 || dl <= 0) continue;
          const calendar = c.sendAnytime
            ? { ...window, enabled: false }
            : window;
          let at = nextPacedTime(
            new Date(
              Math.max(
                mailboxNext.get(b.id)!,
                domainNext.get(b.domainGroupId)!,
                c.scheduledAt?.getTime() ?? 0,
              ),
            ),
            calendar,
          );
          for (let i = 0; i < 366; i++) {
            const day = sendWindowDayKey(at, window.timeZone);
            if (
              (usedMailbox.get(`${b.id}:${day}`) ?? 0) < ml &&
              (usedDomain.get(`${b.domainGroupId}:${day}`) ?? 0) < dl
            )
              break;
            let nextDay = new Date(at.getTime() + 3_600_000);
            while (sendWindowDayKey(nextDay, window.timeZone) === day)
              nextDay = new Date(nextDay.getTime() + 3_600_000);
            at = nextPacedTime(nextDay, calendar);
          }
          const day = sendWindowDayKey(at, window.timeZone);
          if (
            (usedMailbox.get(`${b.id}:${day}`) ?? 0) >= ml ||
            (usedDomain.get(`${b.domainGroupId}:${day}`) ?? 0) >= dl
          )
            continue;
          if (!best || at < best.at)
            best = {
              id: b.id,
              domainId: b.domainGroupId,
              at,
              mailboxLimit: ml,
              domainLimit: dl,
            };
        }
        assignments.push({
          id: m.id,
          at: best?.at ?? null,
          mailboxId: best?.id ?? null,
        });
        if (!best) {
          incomplete.add(c.id);
          continue;
        }
        const day = sendWindowDayKey(best.at, window.timeZone);
        const mk = `${best.id}:${day}`,
          dk = `${best.domainId}:${day}`;
        usedMailbox.set(mk, (usedMailbox.get(mk) ?? 0) + 1);
        usedDomain.set(dk, (usedDomain.get(dk) ?? 0) + 1);
        mailboxNext.set(
          best.id,
          best.at.getTime() + pacingGap(best.mailboxLimit, window),
        );
        domainNext.set(
          best.domainId,
          best.at.getTime() + pacingGap(best.domainLimit, window),
        );
        let finish = best.at;
        if (c.followupEnabled)
          for (const step of c.followupSteps.filter(
            (s) => s.stepNumber > m.step,
          ))
            finish = nextPacedTime(
              new Date(finish.getTime() + step.daysAfterPrevious * 86_400_000),
              c.sendAnytime ? { ...window, enabled: false } : window,
            );
        if (!completion.has(c.id) || finish > completion.get(c.id)!)
          completion.set(c.id, finish);
      }
      // A remote database must not require a round trip for every planned letter.
      for (let offset = 0; offset < assignments.length; offset += 500) {
        const values = assignments
          .slice(offset, offset + 500)
          .map(
            (a) =>
              Prisma.sql`(${a.id}::text, ${a.at ? a.at.toISOString().slice(0, -1) : null}::timestamp, ${a.mailboxId}::text)`,
          );
        await tx.$executeRaw`UPDATE "Message" AS m SET "plannedSendAt" = p.at, "plannedMailboxId" = p.mailbox
          FROM (VALUES ${Prisma.join(values)}) AS p(id, at, mailbox) WHERE m.id = p.id AND m.status = 'PENDING'`;
      }
      for (const c of campaigns)
        await tx.campaign.update({
          where: { id: c.id },
          data: {
            plannedCompletionAt: incomplete.has(c.id)
              ? null
              : (completion.get(c.id) ?? null),
          },
        });
    },
    { timeout: 60_000 },
  );
}

/** Reserve pacing before SMTP, atomically across workers and campaigns. */
export async function claimScheduledSend(input: {
  id: string;
  userId: string;
  mailboxId: string;
  key: string;
  now: Date;
  window: SendWindow;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`send-plan:${input.userId}`}))`;
    const m = await tx.message.findFirst({
      where: {
        id: input.id,
        campaign: { userId: input.userId, isDemo: false, channel: "EMAIL" },
      },
      include: { contact: true },
    });
    const b = await tx.mailbox.findUnique({
      where: { id: input.mailboxId },
      include: { domainGroup: true },
    });
    if (
      !m ||
      !b ||
      b.userId !== input.userId ||
      m.status !== "QUEUED" ||
      m.plannedMailboxId !== b.id ||
      !m.plannedSendAt ||
      m.plannedSendAt > input.now
    )
      return false;
    const excluded = await tx.campaignMailboxState.findUnique({
      where: {
        campaignId_mailboxId: { campaignId: m.campaignId, mailboxId: b.id },
      },
    });
    const suppressed = await tx.suppression.findUnique({
      where: { userId_email: { userId: input.userId, email: m.contact.email } },
    });
    if (
      (excluded?.excludedAt && !excluded.resumedAt) ||
      (suppressed && !suppressed.releasedAt) ||
      m.contact.status !== "ACTIVE" ||
      b.warmupState !== "warm" ||
      !["ok", "paused"].includes(b.connState)
    )
      return false;
    if (b.smtpBlockedUntil && b.smtpBlockedUntil > input.now) return false;
    if (
      input.window.enabled &&
      ((b.nextCampaignSendAt && b.nextCampaignSendAt > input.now) ||
        (b.domainGroup.nextCampaignSendAt &&
          b.domainGroup.nextCampaignSendAt > input.now))
    )
      return false;
    const ml = Math.min(
      b.coldDailyLimit,
      DELIVERABILITY_RULES.coldPerMailboxDailyMax,
    );
    const dl = Math.min(
      b.domainGroup.dailyLimit,
      DELIVERABILITY_RULES.coldPerDomainDailyMax,
    );
    // Count attempts, including rejections/unknown outcomes. Accepted-only counters cannot protect a failing sender.
    const day = sendWindowDayKey(input.now, input.window.timeZone);
    const attempts = await tx.message.findMany({
      where: {
        campaign: { userId: input.userId },
        deliveryClaimedAt: {
          gte: new Date(input.now.getTime() - 26 * 3_600_000),
        },
      },
      select: { mailboxId: true, deliveryClaimedAt: true },
    });
    const today = attempts.filter(
      (a) =>
        a.deliveryClaimedAt &&
        sendWindowDayKey(a.deliveryClaimedAt, input.window.timeZone) === day,
    );
    const domainBoxes = await tx.mailbox.findMany({
      where: { domainGroupId: b.domainGroupId },
      select: { id: true },
    });
    if (
      today.filter((a) => a.mailboxId === b.id).length >= ml ||
      today.filter((a) => domainBoxes.some((b) => b.id === a.mailboxId))
        .length >= dl
    )
      return false;
    await tx.mailbox.update({
      where: { id: b.id },
      data: {
        nextCampaignSendAt: new Date(
          input.now.getTime() + pacingGap(ml, input.window),
        ),
      },
    });
    await tx.domainGroup.update({
      where: { id: b.domainGroupId },
      data: {
        nextCampaignSendAt: new Date(
          input.now.getTime() + pacingGap(dl, input.window),
        ),
      },
    });
    await tx.message.update({
      where: { id: m.id },
      data: {
        status: "SENDING",
        deliveryClaimedAt: input.now,
        deliveryKey: input.key,
        messageIdHeader: input.key,
        mailboxId: b.id,
        error: null,
      },
    });
    return true;
  });
}
