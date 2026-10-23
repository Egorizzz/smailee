import {
  planCampaignSends,
  claimScheduledSend,
  nextPacedTime,
} from "@/server/campaigns/sendSchedule";
import {
  recordDeliverySignal,
  ingestDeliveryReports,
  deliverCampaignMailboxNotices,
} from "@/server/campaigns/deliverySignals";
import { processCampaign } from "@/server/sendEngine";
import { readFileSync } from "node:fs";
import { parseDeliveryReports } from "@/lib/mail/deliverySignals";
import {
  makeUser,
  makeDomain,
  makeMailbox,
  makeQueuedCampaign,
  makeMessage,
  makeContact,
  test,
  assert,
  prisma,
  suiteHeader,
} from "../harness";
import type { FakeSmtp } from "../fakeSmtp";

const WINDOW = {
  enabled: true,
  timeZone: "Europe/Moscow",
  startHour: 9,
  endHour: 19,
  weekdays: [1, 2, 3, 4, 5],
};
const NOW = new Date("2026-10-23T06:00:00Z");

export default async function run(smtp: FakeSmtp) {
  suiteHeader("delivery — durable schedule, DSN and sender quarantine");
  await test("legacy migration repairs explicit spam failures without retrying or replacing opt-outs", async () => {
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    const box = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
    });
    const { campaign, contacts } = await makeQueuedCampaign(user.id, 1);
    const m = await prisma.message.findFirstOrThrow({
      where: { campaignId: campaign.id },
    });
    await prisma.message.update({
      where: { id: m.id },
      data: {
        status: "SENDING",
        mailboxId: box.id,
        error:
          "Message failed: 554 5.7.1 Message rejected under suspicion of SPAM",
        deliveryClaimedAt: NOW,
      },
    });
    await prisma.suppression.create({
      data: {
        userId: user.id,
        email: contacts[0].email,
        reason: "unsubscribed",
      },
    });
    const migration = readFileSync(
      "prisma/migrations/20261023160000_delivery_tracking_and_send_schedule/migration.sql",
      "utf8",
    );
    const backfill = migration.slice(
      migration.indexOf("-- Repair only explicit"),
    );
    await prisma.$transaction(async (tx) => {
      for (const sql of backfill
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean))
        await tx.$executeRawUnsafe(sql);
    });
    const repaired = await prisma.message.findUniqueOrThrow({
      where: { id: m.id },
    });
    assert.equal(repaired.status, "FAILED");
    assert.equal(repaired.deliveryIssue, "SPAM_REJECTED");
    assert.equal(repaired.sentAt, null);
    assert.equal(
      (await prisma.suppression.findFirstOrThrow()).reason,
      "unsubscribed",
    );
    assert.equal(
      (await prisma.mailbox.findUniqueOrThrow({ where: { id: box.id } }))
        .spamRejectionsSinceWarmup,
      1,
    );
  });
  await test("sender threshold counts distinct rejections across campaigns", async () => {
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    const box = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
    });
    const first = await makeQueuedCampaign(user.id, 3);
    const second = await makeQueuedCampaign(user.id, 3);
    const messages = await prisma.message.findMany({
      where: { campaignId: { in: [first.campaign.id, second.campaign.id] } },
      orderBy: { createdAt: "asc" },
    });
    for (const m of messages) {
      await prisma.message.update({
        where: { id: m.id },
        data: { status: "FAILED", mailboxId: box.id },
      });
      await recordDeliverySignal({
        messageId: m.id,
        source: "SMTP",
        key: m.id,
        issue: "SPAM_REJECTED",
        payload: { responseCode: 554 },
        now: NOW,
      });
    }
    assert.equal(
      (await prisma.mailbox.findUniqueOrThrow({ where: { id: box.id } }))
        .warmupState,
      "warming",
    );
    assert.equal(
      await prisma.campaignMailboxState.count({
        where: { mailboxId: box.id, excludedAt: { not: null } },
      }),
      1,
    );
  });
  await test("real SMTP 554 records a terminal rejection, blocks the contact and keeps IMAP available", async () => {
    smtp.reset();
    smtp.rejectSpam = true;
    try {
      const user = await makeUser();
      const domain = await makeDomain(user.id);
      const box = await makeMailbox({
        userId: user.id,
        domainGroupId: domain.id,
        smtpPort: smtp.port,
      });
      const { campaign } = await makeQueuedCampaign(user.id, 1);
      const result = await processCampaign(campaign.id);
      assert.equal(result.failed, 1);
      const m = await prisma.message.findFirstOrThrow({
        where: { campaignId: campaign.id },
      });
      assert.equal(m.status, "FAILED");
      assert.equal(m.sentAt, null);
      assert.equal(m.deliveryIssue, "SPAM_REJECTED");
      assert.equal(await prisma.suppression.count(), 1);
      const sender = await prisma.mailbox.findUniqueOrThrow({
        where: { id: box.id },
      });
      assert.equal(sender.connState, "ok");
      assert(sender.smtpBlockedUntil);
      assert.equal(await prisma.event.count({ where: { messageId: m.id } }), 1);
    } finally {
      smtp.reset();
    }
  });
  await test("mandatory exclusion notice retries a failed email and is not resent after success", async () => {
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    const box = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
    });
    const { campaign } = await makeQueuedCampaign(user.id, 1);
    const notice = await prisma.campaignMailboxState.create({
      data: {
        campaignId: campaign.id,
        mailboxId: box.id,
        spamRejections: 6,
        excludedAt: NOW,
        notificationNextAt: NOW,
      },
    });
    let calls = 0;
    await deliverCampaignMailboxNotices(NOW, async () => {
      calls++;
      return { ok: false as const, error: "temporary failure" };
    });
    assert.equal(
      (
        await prisma.campaignMailboxState.findUniqueOrThrow({
          where: { id: notice.id },
        })
      ).notificationSentAt,
      null,
    );
    const later = new Date(NOW.getTime() + 16 * 60_000);
    await deliverCampaignMailboxNotices(later, async (mail) => {
      calls++;
      assert(String(mail.to).includes(user.email));
      return { ok: true as const };
    });
    await deliverCampaignMailboxNotices(later, async () => {
      calls++;
      return { ok: true as const };
    });
    assert.equal(calls, 2);
  });
  await test("one persisted mailbox/domain schedule covers concurrent campaigns and restarts", async () => {
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    const box = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
    });
    const a = await makeQueuedCampaign(user.id, 2);
    const b = await makeQueuedCampaign(user.id, 2);
    await planCampaignSends(user.id, NOW, WINDOW);
    const plan = await prisma.message.findMany({
      where: { campaignId: { in: [a.campaign.id, b.campaign.id] } },
      orderBy: { plannedSendAt: "asc" },
    });
    assert.equal(plan.length, 4);
    for (let i = 1; i < plan.length; i++)
      assert.equal(
        plan[i].plannedSendAt!.getTime() - plan[i - 1].plannedSendAt!.getTime(),
        20 * 60_000,
      );
    await planCampaignSends(user.id, new Date(NOW.getTime() + 1000), WINDOW);
    assert.equal(
      (
        await prisma.message.findUniqueOrThrow({ where: { id: plan[0].id } })
      ).plannedSendAt!.getTime(),
      NOW.getTime(),
    );
    await prisma.message.update({
      where: { id: plan[0].id },
      data: { status: "QUEUED" },
    });
    const attempts = await Promise.all(
      [1, 2].map(() =>
        claimScheduledSend({
          id: plan[0].id,
          userId: user.id,
          mailboxId: box.id,
          key: `<${plan[0].id}@test.local>`,
          now: NOW,
          window: WINDOW,
        }),
      ),
    );
    assert.equal(attempts.filter(Boolean).length, 1);
    assert.equal(
      (
        await prisma.mailbox.findUniqueOrThrow({ where: { id: box.id } })
      ).nextCampaignSendAt!.getTime(),
      NOW.getTime() + 20 * 60_000,
    );
  });
  await test("six unique spam rejections exclude the sender, persist notice and redistribute only unattempted mail", async () => {
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    const bad = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
    });
    const good = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
    });
    const { campaign } = await makeQueuedCampaign(user.id, 2);
    for (let i = 0; i < 6; i++) {
      const contact = await makeContact(user.id);
      const m = await makeMessage(campaign.id, contact.id, {
        status: "FAILED",
        mailboxId: bad.id,
      });
      const signal = {
        messageId: m.id,
        source: "SMTP" as const,
        key: `spam-${i}`,
        issue: "SPAM_REJECTED" as const,
        payload: { responseCode: 554 },
        now: NOW,
      };
      await recordDeliverySignal(signal);
      await recordDeliverySignal(signal);
      const state = await prisma.campaignMailboxState.findUniqueOrThrow({
        where: {
          campaignId_mailboxId: { campaignId: campaign.id, mailboxId: bad.id },
        },
      });
      assert.equal(state.spamRejections, i + 1);
      assert.equal(Boolean(state.excludedAt), i === 5);
    }
    assert.equal(
      (await prisma.mailbox.findUniqueOrThrow({ where: { id: bad.id } }))
        .warmupState,
      "warming",
    );
    await planCampaignSends(user.id, NOW, WINDOW);
    const pending = await prisma.message.findMany({
      where: { campaignId: campaign.id, status: "PENDING" },
    });
    assert(pending.every((m) => m.plannedMailboxId === good.id));
    assert(
      (await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } }))
        .plannedCompletionAt,
    );
    assert.equal(await prisma.suppression.count(), 6);
  });
  await test("DSN requires original ID, never retries mail, preserves accepted count and deduplicates", async () => {
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    const box = await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
    });
    const { campaign, contacts } = await makeQueuedCampaign(user.id, 1);
    const m = await prisma.message.findFirstOrThrow({
      where: { campaignId: campaign.id },
    });
    await prisma.message.update({
      where: { id: m.id },
      data: {
        status: "SENT",
        sentAt: NOW,
        mailboxId: box.id,
        messageIdHeader: "<original@test.local>",
      },
    });
    const source = `Original-Message-ID: <original@test.local>\r\n\r\nFinal-Recipient: rfc822; ${contacts[0].email}\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 user unknown\r\n`;
    const reports = parseDeliveryReports(source);
    assert.equal(reports.length, 1);
    await ingestDeliveryReports(box.id, "report-1", reports);
    await ingestDeliveryReports(box.id, "report-1", reports);
    const result = await prisma.message.findUniqueOrThrow({
      where: { id: m.id },
    });
    assert.equal(result.status, "BOUNCED");
    assert.equal(result.deliveryIssue, "INVALID_RECIPIENT");
    assert(result.sentAt);
    assert.equal(await prisma.event.count({ where: { messageId: m.id } }), 1);
    await ingestDeliveryReports(box.id, "unmatched", [
      { ...reports[0], originalIds: ["<other@test.local>"] },
    ]);
    assert.equal(await prisma.event.count({ where: { messageId: m.id } }), 1);
  });
  await test("weekend scheduling and restart do not release missed slots in a burst", async () => {
    assert.equal(
      nextPacedTime(new Date("2026-10-23T17:00:00Z"), WINDOW).toISOString(),
      "2026-10-26T06:00:00.000Z",
    );
    const user = await makeUser();
    const domain = await makeDomain(user.id);
    await makeMailbox({
      userId: user.id,
      domainGroupId: domain.id,
      smtpPort: smtp.port,
    });
    const { campaign } = await makeQueuedCampaign(user.id, 3);
    await planCampaignSends(user.id, NOW, WINDOW);
    const messages = await prisma.message.findMany({
      where: { campaignId: campaign.id },
      orderBy: { plannedSendAt: "asc" },
    });
    const restart = new Date(NOW.getTime() + 4 * 3_600_000);
    await prisma.message.updateMany({
      where: { campaignId: campaign.id },
      data: { status: "QUEUED" },
    });
    const results = await Promise.all(
      messages.map((m) =>
        claimScheduledSend({
          id: m.id,
          userId: user.id,
          mailboxId: m.plannedMailboxId!,
          key: `<${m.id}@test.local>`,
          now: restart,
          window: WINDOW,
        }),
      ),
    );
    assert.equal(results.filter(Boolean).length, 1);
  });
}
