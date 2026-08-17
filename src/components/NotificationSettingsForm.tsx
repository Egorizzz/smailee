"use client";

import { useActionState, useState } from "react";
import type {
  CustomerDigestFrequency,
  CustomerNotificationMode,
  CustomerNotificationScope,
  ReplyNotificationPolicy,
} from "@prisma/client";
import { saveNotificationPreferences, type NotificationSettingsState } from "@/app/(app)/app/notifications/actions";

type Props = {
  initial: {
    scope: CustomerNotificationScope;
    replyPolicy: ReplyNotificationPolicy;
    telegramReplyMode: CustomerNotificationMode;
    telegramWarmLeadMode: CustomerNotificationMode;
    telegramGroupMinutes: number;
    emailDigestReplies: boolean;
    emailDigestWarmLeads: boolean;
    emailDigestFrequency: CustomerDigestFrequency;
    emailDigestHourMsk: number;
  };
  canReceiveAll: boolean;
  telegramConnected: boolean;
};

const initialState: NotificationSettingsState = {};

const selectClass = "w-full rounded-lg border border-line bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-mint-500 focus:ring-2 focus:ring-mint-100 disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-500";

export function NotificationSettingsForm({ initial, canReceiveAll, telegramConnected }: Props) {
  const [state, action, pending] = useActionState(saveNotificationPreferences, initialState);
  const [telegramReplyMode, setTelegramReplyMode] = useState<CustomerNotificationMode>(telegramConnected ? initial.telegramReplyMode : "OFF");
  const [telegramWarmLeadMode, setTelegramWarmLeadMode] = useState<CustomerNotificationMode>(telegramConnected ? initial.telegramWarmLeadMode : "OFF");
  const [emailDigestFrequency, setEmailDigestFrequency] = useState<"HOURLY" | "DAILY">(
    initial.emailDigestFrequency === "DAILY" ? "DAILY" : "HOURLY",
  );
  const showTelegramGroupInterval = telegramConnected && (telegramReplyMode === "GROUPED" || telegramWarmLeadMode === "GROUPED");

  return (
    <form action={action} className="space-y-6">
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">Что присылать</h2>
        <p className="mt-1 text-sm text-ink-500">Настройки личные: коллеги выбирают свои каналы и частоту отдельно.</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">Кампании</legend>
            <div className="mt-2 space-y-2">
              <label className="flex items-start gap-3 rounded-lg border border-line p-3">
                <input type="radio" name="scope" value="OWN" defaultChecked={initial.scope === "OWN" || !canReceiveAll} className="mt-1" />
                <span><span className="block text-sm font-medium text-slate-900">Только мои</span><span className="block text-xs text-ink-500">Ответы из кампаний, которые запустили вы.</span></span>
              </label>
              <label className={`flex items-start gap-3 rounded-lg border p-3 ${canReceiveAll ? "border-line" : "border-line bg-surface text-ink-500"}`}>
                <input type="radio" name="scope" value="ALL" defaultChecked={initial.scope === "ALL" && canReceiveAll} disabled={!canReceiveAll} className="mt-1" />
                <span><span className="block text-sm font-medium text-slate-900">Все кампании</span><span className="block text-xs text-ink-500">Доступно сотрудникам с правом отвечать всем лидам.</span></span>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">Обычные ответы</legend>
            <div className="mt-2 space-y-2">
              <label className="flex items-start gap-3 rounded-lg border border-line p-3">
                <input type="radio" name="replyPolicy" value="ACTION_REQUIRED" defaultChecked={initial.replyPolicy === "ACTION_REQUIRED"} className="mt-1" />
                <span><span className="block text-sm font-medium text-slate-900">Требуют действия</span><span className="block text-xs text-ink-500">Черновик ждёт проверки или автоматический ответ не создан.</span></span>
              </label>
              <label className="flex items-start gap-3 rounded-lg border border-line p-3">
                <input type="radio" name="replyPolicy" value="ALL" defaultChecked={initial.replyPolicy === "ALL"} className="mt-1" />
                <span><span className="block text-sm font-medium text-slate-900">Все ответы</span><span className="block text-xs text-ink-500">Включая ответы, которые ИИ обработал сам.</span></span>
              </label>
            </div>
          </fieldset>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Каналы и группировка</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${telegramConnected ? "bg-mint-100 text-mint-700" : "bg-slate-100 text-slate-500"}`}>
            Telegram {telegramConnected ? "подключён" : "не подключён"}
          </span>
        </div>

        <div className="mt-5 overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-3 border-b border-line pb-2 text-xs font-semibold text-ink-500">
              <div>Событие</div><div>Telegram</div><div>Email-дайджест</div>
            </div>
            <div className="grid grid-cols-[1.2fr_1fr_1fr] items-center gap-3 border-b border-line py-4">
              <div><div className="text-sm font-semibold text-slate-900">Новый ответ</div><div className="mt-0.5 text-xs text-ink-500">Сообщение клиента и переход в Inbox.</div></div>
              <select name="telegramReplyMode" value={telegramReplyMode} onChange={(event) => setTelegramReplyMode(event.target.value as CustomerNotificationMode)} disabled={!telegramConnected} className={selectClass}>
                <option value="OFF">Не присылать</option><option value="IMMEDIATE">Сразу</option><option value="GROUPED">Группой</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-slate-900"><input type="checkbox" name="emailDigestReplies" defaultChecked={initial.emailDigestReplies} /> Включить</label>
            </div>
            <div className="grid grid-cols-[1.2fr_1fr_1fr] items-center gap-3 py-4">
              <div><div className="text-sm font-semibold text-slate-900">Тёплый лид</div><div className="mt-0.5 text-xs text-ink-500">Отдельная приоритетная группа.</div></div>
              <select name="telegramWarmLeadMode" value={telegramWarmLeadMode} onChange={(event) => setTelegramWarmLeadMode(event.target.value as CustomerNotificationMode)} disabled={!telegramConnected} className={selectClass}>
                <option value="OFF">Не присылать</option><option value="IMMEDIATE">Сразу</option><option value="GROUPED">Группой</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-slate-900"><input type="checkbox" name="emailDigestWarmLeads" defaultChecked={initial.emailDigestWarmLeads} /> Включить</label>
            </div>
          </div>
        </div>

        {!telegramConnected && (
          <>
            <input type="hidden" name="telegramReplyMode" value="OFF" />
            <input type="hidden" name="telegramWarmLeadMode" value="OFF" />
            <p className="rounded-lg bg-surface px-3 py-2 text-sm text-ink-500">Подключите Telegram ниже, чтобы выбрать мгновенную доставку или группировку.</p>
          </>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {showTelegramGroupInterval ? (
            <label className="text-sm font-medium text-slate-900">Интервал группировки Telegram
              <select name="telegramGroupMinutes" defaultValue={initial.telegramGroupMinutes} className={`${selectClass} mt-2`}>
                <option value="5">5 минут</option><option value="15">15 минут</option><option value="30">30 минут</option>
              </select>
            </label>
          ) : (
            <input type="hidden" name="telegramGroupMinutes" value={initial.telegramGroupMinutes} />
          )}
          <label className="text-sm font-medium text-slate-900">Частота email-дайджеста
            <select name="emailDigestFrequency" value={emailDigestFrequency} onChange={(event) => setEmailDigestFrequency(event.target.value as "HOURLY" | "DAILY")} className={`${selectClass} mt-2`}>
              <option value="HOURLY">Раз в час</option><option value="DAILY">Раз в день</option>
            </select>
          </label>
          {emailDigestFrequency === "DAILY" ? (
            <label className="text-sm font-medium text-slate-900">Время отправки, МСК
              <select name="emailDigestHourMsk" defaultValue={initial.emailDigestHourMsk} className={`${selectClass} metric-number mt-2`}>
                {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}
              </select>
            </label>
          ) : (
            <input type="hidden" name="emailDigestHourMsk" value={initial.emailDigestHourMsk} />
          )}
        </div>
      </section>

      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>}
      {state.ok && <p role="status" aria-live="polite" className="rounded-lg bg-mint-50 px-4 py-3 text-sm text-mint-700">{state.ok}</p>}
      <button disabled={pending} className="rounded-lg brand-gradient px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
        {pending ? "Сохраняем…" : "Сохранить уведомления"}
      </button>
    </form>
  );
}
