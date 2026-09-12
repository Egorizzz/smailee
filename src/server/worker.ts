/**
 * Standalone worker для прода (Amvera). Локально: `npm run worker`.
 *
 * Периодически:
 *  - запускает отложенные кампании, когда наступает scheduledAt;
 *  - добирает кампании с невыполненными письмами (QUEUED/SENDING) через пул
 *    ящиков клиента (§5.3, M2);
 *  - создаёт follow-up письма для кампаний без ответа;
 *  - опрашивает IMAP подключённых ящиков за новыми ответами (§5.4, M3) — throttle
 *    на ящик внутри pollInboundMailboxes, поэтому тик воркера может быть чаще;
 *  - гоняет сеть прогрева (§5.6, M4): рассылка по ramp-графику, вовлечённость
 *    "принимающей стороны" (прочитано/ответ/важное), спасение из спама.
 *    Работает независимо от кампаний клиента — служебный трафик между ящиками
 *    пула, никогда не выключается;
 *  - пересчитывает здоровье флота (§5.8, M5) и авто-приостанавливает
 *    выгоревшие ящики — throttle общим таймстемпом (не на ящик).
 *  - перепроверяет временно недоступные SMTP/IMAP и доставляет очередь
 *    технических уведомлений администраторам организации через no-reply.
 *  - планирует и доставляет тарифные предупреждения и реактивационные письма.
 *  - доставляет персональные Telegram-уведомления и email-дайджесты об
 *    ответах и тёплых лидах, сохраняя категории раздельными.
 *
 * Запуск кампании только ставит её в очередь. Фактическая отправка, приём
 * ответов и прогрев выполняются воркером.
 */
import { prisma } from "@/lib/prisma";
import { processCampaign, processFollowups } from "./sendEngine";
import { pollInboundMailboxes } from "./inboundEngine";
import { processWarmupSendRound, processWarmupEngagement, processWarmupSpamRescue } from "./warmupEngine";
import { computeFleetHealth } from "./fleetHealth";
import { config } from "@/lib/config";
import { reconnectMailboxes } from "./mailboxReconnect";
import { deliverAdminNotifications } from "./adminNotifications";
import { runTelegramPolling } from "./telegramPolling";
import { runAdminTelegramPolling } from "./adminTelegramPolling";
import { deliverAdminTelegramNotifications } from "./adminTelegramNotifications";
import { deliverPlanNotifications, syncPlanNotifications } from "./planNotifications";
import { processBusinessProfiles } from "./businessProfileEngine";
import { processAutoPings } from "./autoPingEngine";
import { deliverCustomerNotifications } from "./customerNotifications";
import { logRecentProspectingFailures, processQueuedProspectingRuns } from "@/lib/company-data/prospectingRuns";
import { processQueuedContactImports } from "@/lib/contacts/importQueue";
import { processRecurringPayments, syncPaymentWebhook } from "./subscriptionBilling";
import { simulateDemoCampaign } from "./demoWorkspace";
import { isWithinSendWindow } from "@/lib/schedule";
import { readyCampaignChannels } from "./channels/registry";

const POLL_MS = config.workerPollMs;
let lastFleetHealthCheck = 0;
let lastReconnectCheck = 0;
let lastNotificationCheck = 0;
let lastPlanNotificationCheck = 0;
let lastAdminTelegramDelivery = 0;
let lastRecurringPaymentCheck = 0;
let lastPaymentWebhookSync = 0;

async function runWorkerStep<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
  try {
    return await task();
  } catch (error) {
    console.error(`[worker] ${label} failed`, error);
    return undefined;
  }
}

async function tick() {
  if (Date.now() - lastPaymentWebhookSync >= config.tochka.webhookSyncMs) {
    try {
      if (await syncPaymentWebhook()) {
        lastPaymentWebhookSync = Date.now();
        console.log("[worker] payment webhook synchronized");
      } else {
        lastPaymentWebhookSync = Date.now();
      }
    } catch (error) {
      console.error("[worker] payment webhook synchronization failed", error);
      // На старте web-процесс может ещё не принимать контрольный запрос банка.
      // Повторяем через минуту, а не ждём следующий шестичасовой цикл.
      lastPaymentWebhookSync = Date.now() - config.tochka.webhookSyncMs + 60_000;
    }
  }

  if (Date.now() - lastRecurringPaymentCheck >= config.tochka.recurringPollMs) {
    lastRecurringPaymentCheck = Date.now();
    const billing = await runWorkerStep("recurring payments", processRecurringPayments);
    if (billing?.checked) {
      console.log(
        `[worker] recurring payments: checked=${billing.checked} started=${billing.started} failed=${billing.failed}`,
      );
    }
  }

  const contactImports = await runWorkerStep(
    "contact imports",
    () => processQueuedContactImports(prisma, 1),
  );
  if (contactImports?.length) console.log(`[worker] contact imports: ${contactImports.map((item) => `${item.id}=${item.processed}${item.completed ? ":done" : ""}`).join(", ")}`);
  const prospecting = await runWorkerStep(
    "prospecting runs",
    () => processQueuedProspectingRuns(prisma, 1),
  );
  if (prospecting?.length) console.log(`[worker] prospecting runs: ${prospecting.map((item) => `${item.id}=${item.status}`).join(", ")}`);
  const profiles = await runWorkerStep("business profiles", processBusinessProfiles);
  if (profiles && (profiles.polled || profiles.analyzed || profiles.finalized)) {
    console.log(`[worker] business profiles: polled=${profiles.polled} analyzed=${profiles.analyzed} finalized=${profiles.finalized}`);
  }
  const demoCampaigns = await runWorkerStep("load demo campaigns", () => prisma.campaign.findMany({
    where: {
      isDemo: true,
      channel: { in: readyCampaignChannels },
      status: { in: ["SCHEDULED", "QUEUED"] },
      scheduledAt: { lte: new Date() },
    },
    select: { id: true, userId: true, sendAnytime: true },
    take: 10,
  })) ?? [];
  for (const campaign of demoCampaigns) {
    if (campaign.sendAnytime || isWithinSendWindow(new Date(), config.sendWindow)) {
      await runWorkerStep(
        `demo campaign ${campaign.id}`,
        () => simulateDemoCampaign(campaign.id, campaign.userId),
      );
    }
  }
  // отложенные кампании, чей срок настал → в очередь
  await runWorkerStep("schedule due campaigns", () => prisma.campaign.updateMany({
      where: { channel: { in: readyCampaignChannels }, isDemo: false, status: "SCHEDULED", launchAfterWarmup: false, scheduledAt: { lte: new Date() } },
      data: { status: "QUEUED" },
    }),
  );

  // R4: кампании «Запустить после прогрева» — стартуют сами, как только у
  // клиента появился первый прогретый ящик (warmupState=warm). Это замена
  // красной ошибки «ящики не прогреты» на автозапуск.
  const waitingWarmup = await runWorkerStep("load campaigns waiting for warmup", () => prisma.campaign.findMany({
    where: { channel: { in: readyCampaignChannels }, isDemo: false, status: "SCHEDULED", launchAfterWarmup: true },
    select: { id: true, userId: true, name: true, scheduledAt: true },
  })) ?? [];
  for (const c of waitingWarmup) {
    if (c.scheduledAt && c.scheduledAt > new Date()) continue;
    const warm = await runWorkerStep(`check warmup for campaign ${c.id}`, () => prisma.mailbox.count({
        where: { userId: c.userId, warmupState: "warm", connState: { in: ["ok", "paused"] } },
      }),
    );
    if ((warm ?? 0) > 0) {
      const started = await runWorkerStep(`start warmed campaign ${c.id}`, () => prisma.campaign.update({
          where: { id: c.id },
          data: { status: "QUEUED", launchAfterWarmup: false },
        }),
      );
      if (started) console.log(`[worker] кампания «${c.name}» (${c.id}) стартует: прогрев завершён`);
    }
  }

  const campaigns = await runWorkerStep("load campaign queue", () => prisma.campaign.findMany({
    where: { channel: { in: readyCampaignChannels }, isDemo: false, status: { in: ["QUEUED", "SENDING"] } },
    select: { id: true },
    take: 5,
  })) ?? [];
  for (const c of campaigns) {
    const res = await runWorkerStep(`campaign ${c.id}`, () => processCampaign(c.id));
    if (res && (res.sent || res.failed || res.skipped)) {
      console.log(
        `[worker] campaign ${c.id}: sent=${res.sent} failed=${res.failed} skipped=${res.skipped} remaining=${res.remaining}`
      );
    }
  }

  // follow-up для отправленных кампаний
  const sentCampaigns = await runWorkerStep("load follow-up campaigns", () => prisma.campaign.findMany({
    where: { channel: { in: readyCampaignChannels }, isDemo: false, followupEnabled: true, status: { in: ["SENT", "SENDING"] } },
    select: { id: true },
    take: 10,
  })) ?? [];
  for (const c of sentCampaigns) {
    const n = await runWorkerStep(`follow-ups for campaign ${c.id}`, () => processFollowups(c.id));
    if (n) console.log(`[worker] campaign ${c.id}: created ${n} follow-ups`);
  }

  // IMAP-поллинг ящиков за новыми ответами (throttle на ящик — внутри)
  const inbound = await runWorkerStep("inbound polling", pollInboundMailboxes);
  if (inbound && (inbound.checked || inbound.matched)) {
    console.log(
      `[worker] inbound: checked=${inbound.checked} newEmails=${inbound.newEmails} matched=${inbound.matched} warmup=${inbound.warmup}`
    );
  }

  // здоровье флота (§5.8, M5) — не на каждый тик, throttle таймстемпом
  if (Date.now() - lastFleetHealthCheck >= config.fleetHealthPollMs) {
    lastFleetHealthCheck = Date.now();
    const health = await runWorkerStep("fleet health", computeFleetHealth);
    if (health?.disabled) {
      console.log(`[worker] fleet health: checked=${health.checked} disabled=${health.disabled}`);
    }
  }

  const customerNotifications = await runWorkerStep(
    "customer notifications",
    deliverCustomerNotifications,
  );
  if (customerNotifications?.checked) {
    console.log(
      `[worker] customer notifications: checked=${customerNotifications.checked} sent=${customerNotifications.sent} failed=${customerNotifications.failed} telegram=${customerNotifications.telegram.sent} email=${customerNotifications.email.sent}`
    );
  }

  const autoPings = await runWorkerStep("auto-pings", processAutoPings);
  if (autoPings && (autoPings.drafted || autoPings.sent || autoPings.failed)) {
    console.log(
      `[worker] auto-ping: checked=${autoPings.checked} drafted=${autoPings.drafted} sent=${autoPings.sent} failed=${autoPings.failed}`
    );
  }

  if (Date.now() - lastReconnectCheck >= config.mailboxReconnect.pollMs) {
    lastReconnectCheck = Date.now();
    const reconnect = await runWorkerStep("mailbox reconnect", reconnectMailboxes);
    if (reconnect?.checked) {
      console.log(
        `[worker] mailbox reconnect: checked=${reconnect.checked} recovered=${reconnect.recovered} alerts=${reconnect.alerted}`
      );
    }
  }

  if (Date.now() - lastNotificationCheck >= config.adminNotifications.pollMs) {
    lastNotificationCheck = Date.now();
    const notifications = await runWorkerStep("admin notifications", deliverAdminNotifications);
    if (notifications?.checked) {
      console.log(
        `[worker] admin notifications: checked=${notifications.checked} sent=${notifications.sent} failed=${notifications.failed} emails=${notifications.emails}`
      );
    }
  }

  if (Date.now() - lastAdminTelegramDelivery >= config.adminTelegram.deliveryPollMs) {
    lastAdminTelegramDelivery = Date.now();
    const telegram = await runWorkerStep(
      "admin Telegram notifications",
      deliverAdminTelegramNotifications,
    );
    if (telegram?.checked) {
      console.log(
        `[worker] admin Telegram delivery: checked=${telegram.checked} sent=${telegram.sent} failed=${telegram.failed} revoked=${telegram.revoked}`,
      );
    }
  }

  if (Date.now() - lastPlanNotificationCheck >= config.planNotifications.pollMs) {
    lastPlanNotificationCheck = Date.now();
    const synced = await runWorkerStep("sync plan notifications", syncPlanNotifications);
    const notifications = await runWorkerStep("deliver plan notifications", deliverPlanNotifications);
    if (notifications?.checked || synced) {
      console.log(
        `[worker] plan notifications: synced=${synced ?? 0} checked=${notifications?.checked ?? 0} sent=${notifications?.sent ?? 0} failed=${notifications?.failed ?? 0} canceled=${notifications?.canceled ?? 0}`
      );
    }
  }
}

/**
 * Прогрев работает отдельным циклом: медленный SMTP/IMAP кампании или одного
 * клиентского ящика не должен оставлять весь прогревочный пул без активности.
 * Внутри цикла порядок прежний — сначала ответы (они входят в дневную квоту),
 * затем новые письма и спасение из спама.
 */
async function warmupTick() {
  const engagement = await runWorkerStep("warmup engagement", processWarmupEngagement);
  if (engagement && (engagement.read || engagement.replied || engagement.flagged)) {
    console.log(
      `[worker] warmup engagement: read=${engagement.read} replied=${engagement.replied} flagged=${engagement.flagged}`
    );
  }

  const send = await runWorkerStep("warmup send", processWarmupSendRound);
  if (send && (send.sent || send.failed)) {
    console.log(`[worker] warmup send: sent=${send.sent} failed=${send.failed}`);
  }

  const rescue = await runWorkerStep("warmup spam rescue", processWarmupSpamRescue);
  if (rescue?.rescued) {
    console.log(`[worker] warmup spam-rescue: ${rescue.rescued}`);
  }
}

async function runWarmupLoop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await warmupTick();
    } catch (e) {
      console.error("[worker] warmup error:", e);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function main() {
  console.log("[worker] Smailee worker запущен (M2: пул ящиков; M3: IMAP-приём + AI-диалог; M4: прогрев)");
  await runWorkerStep("recent prospecting failures", () => logRecentProspectingFailures(prisma));
  void runTelegramPolling();
  void runAdminTelegramPolling();
  void runWarmupLoop();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (e) {
      console.error("[worker] error:", e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
