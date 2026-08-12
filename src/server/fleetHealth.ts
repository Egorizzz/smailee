import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { queueTechnicalAlert } from "@/server/adminNotifications";
import type { MessageStatus } from "@prisma/client";

/**
 * Мониторинг здоровья флота (§5.8, M5). Читает данные, которые уже пишут
 * M1–M4 (Message.status, Mailbox.connState) — никакой новой логики
 * отправки/приёма/прогрева здесь нет, только агрегация + управление
 * Mailbox.connState (пауза / вывод из ротации).
 *
 * Честно: «всплески bounce/жалоб» (§5.8) НЕ учитываются — такого пайплайна в
 * M1–M4 нет (разбор DSN-писем о недоставке через IMAP не реализован, это
 * отдельная задача за пределами M5, не "агрегация поверх готового"). Скоринг
 * строится из реальных сигналов: доля FAILED-отправок (холодных) за окно +
 * состояние подключения.
 *
 * "disabled" (не "paused"!) — новое состояние специально для этого: "paused"
 * уже занят в M1–M4 как «только что подключён, ждёт первого успеха» и потому
 * ВХОДИТ в allow-list ротации движков. "disabled" ни в один allow-list не
 * входит — ящик выпадает из отправки/приёма/прогрева без единой правки их
 * кода (см. prisma/schema.prisma, enum MailboxConnState).
 *
 * НЕ импортирует "server-only": вызывается из standalone-воркера вне Next.
 */

const WINDOW_DAYS = 7;
const MIN_SAMPLE = 5;
const FAILURE_RATE_DISABLE_THRESHOLD = 0.5;

const ATTEMPTED_STATUSES: MessageStatus[] = ["SENT", "DELIVERED", "OPENED", "CLICKED", "REPLIED", "FAILED"];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export async function computeFleetHealth(now = new Date()): Promise<{ checked: number; disabled: number }> {
  const cutoff = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  // уже приостановленные не пересчитываем — ждут ручного "Возобновить" на дашборде
  const mailboxes = await prisma.mailbox.findMany({ where: { connState: { not: "disabled" } } });

  let checked = 0;
  let disabled = 0;

  for (const mailbox of mailboxes) {
    checked++;
    const [coldTotal, coldFailed] = await Promise.all([
      prisma.message.count({
        where: { mailboxId: mailbox.id, status: { in: ATTEMPTED_STATUSES }, createdAt: { gte: cutoff } },
      }),
      prisma.message.count({
        where: { mailboxId: mailbox.id, status: "FAILED", createdAt: { gte: cutoff } },
      }),
    ]);

    const failureRate = coldTotal > 0 ? coldFailed / coldTotal : 0;
    const connBad = mailbox.connState === "auth_error" || mailbox.connState === "unreachable";
    const healthScore = clamp(Math.round(100 - failureRate * 70 - (connBad ? 30 : 0)), 0, 100);
    const deliveryFailure = coldTotal >= MIN_SAMPLE && failureRate > FAILURE_RATE_DISABLE_THRESHOLD;

    // Временная сеть: не объявляем окончательную паузу и не пишем письмо по
    // первому сбою. Планируем три независимые перепроверки; только после них
    // mailboxReconnect переведёт ящик в disabled и уведомит администратора.
    if (mailbox.connState === "unreachable") {
      await prisma.mailbox.update({
        where: { id: mailbox.id },
        data: mailbox.pauseKind === "NETWORK" && mailbox.nextReconnectAt
          ? { healthScore }
          : {
              pauseKind: "NETWORK",
              connectionIncidentAt: now,
              reconnectAttempts: 0,
              nextReconnectAt: new Date(now.getTime() + config.mailboxReconnect.baseDelayMs),
              healthScore,
            },
      });
      continue;
    }

    const shouldDisable = mailbox.connState === "auth_error" || deliveryFailure;

    if (shouldDisable) {
      const reason = connBad
        ? `Ошибка подключения: ${mailbox.connError ?? mailbox.connState}`
        : `Доля отказов отправки ${Math.round(failureRate * 100)}% за ${WINDOW_DAYS} дн. (${coldFailed}/${coldTotal})`;
      const pauseKind = mailbox.connState === "auth_error" ? "AUTH" : "DELIVERY_FAILURES";
      await prisma.mailbox.update({
        where: { id: mailbox.id },
        data: {
          connState: "disabled",
          pausedReason: reason,
          pauseKind,
          healthScore,
          connectionIncidentAt: connBad ? now : mailbox.connectionIncidentAt,
          reconnectAttempts: 0,
          nextReconnectAt: null,
        },
      });
      // Ошибка пароля не лечится повторами и может привести к блокировке у
      // провайдера, поэтому уведомляем сразу. Сетевую ошибку сначала трижды
      // перепроверяет reconnectMailboxes. Доля отказов — уже подтверждённый
      // агрегированный сигнал, по ней также уведомляем сразу.
      await queueTechnicalAlert({
          ownerId: mailbox.userId,
          type: "MAILBOX_PAUSED",
          resourceKey: mailbox.id,
          subject: `[Smailee] Почтовый ящик ${mailbox.email} приостановлен`,
          text: [
            `Ящик ${mailbox.email} исключён из отправки, приёма и прогрева.`,
            `Причина: ${reason}`,
            pauseKind === "AUTH"
              ? "Проверьте пароль приложения и переподключите ящик в разделе «Инфраструктура»."
              : "Проверьте ошибки последних отправок перед возобновлением ящика.",
            "Повторное уведомление по этому ящику придёт не раньше чем через сутки.",
          ].join("\n\n"),
          now,
      });
      disabled++;
    } else {
      await prisma.mailbox.update({ where: { id: mailbox.id }, data: { healthScore } });
    }
  }

  return { checked, disabled };
}
