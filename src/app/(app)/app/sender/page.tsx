import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { limitsFor, PLANS, effectivePlan } from "@/lib/plans";
import { toDnsLabel } from "@/lib/slug";
import { SenderForm } from "./SenderForm";
import { SenderDnsRecords } from "./SenderDnsRecords";
import { verifySender, deleteSender } from "./actions";

export default async function SenderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { error } = await searchParams;
  const senders = await prisma.sender.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  const limits = limitsFor(user.plan, user.planExpiresAt);
  const eff = effectivePlan(user.plan, user.planExpiresAt);
  const defaultSlug = toDnsLabel(user.companyName || user.email.split("@")[0], "client");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">Отправитель</h1>
      <p className="mt-1 text-ink-500">
        Адрес и домен, с которых Smailee отправляет письма. На тарифе «Демо» — готовый
        поддомен Smailee без настройки; на «Про» можно подключить свой домен.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="mt-6">
        <SenderForm
          baseDomain={config.mailBaseDomain}
          canUseOwnDomain={limits.customDomain}
          defaultSlug={defaultSlug}
        />
      </div>

      <div className="mt-8 space-y-3">
        {senders.length === 0 && (
          <p className="text-sm text-ink-500">Пока нет отправителей.</p>
        )}
        {senders.map((s) => (
          <div key={s.id} className="rounded-xl border border-line bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">
                    {s.fromName} &lt;{s.fromEmail}&gt;
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      s.kind === "MANAGED"
                        ? "bg-mint-100 text-mint-700"
                        : "bg-indigo-50 text-indigo-700"
                    }`}
                  >
                    {s.kind === "MANAGED" ? "Поддомен Smailee" : "Свой домен"}
                  </span>
                </div>
                <div className="mt-1 text-sm text-ink-500">Домен: {s.domain}</div>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                  s.verified
                    ? "bg-mint-100 text-mint-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {s.verified ? "Активен" : s.kind === "MANAGED" ? "Настраивается" : "Не подтверждён"}
              </span>
            </div>

            {s.kind === "MANAGED" ? (
              <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-xs text-ink-500">
                DNS настраиваем мы — вам ничего делать не нужно. Демо-режим: письма
                уходят только на разрешённые тестовые адреса и на вашу почту.
              </p>
            ) : (
              <>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <Badge ok={s.spfOk} label="SPF" />
                  <Badge ok={s.dkimOk} label="DKIM" />
                  <Badge ok={s.dmarcOk} label="DMARC" />
                </div>
                {!s.verified && <SenderDnsRecords senderId={s.id} />}
              </>
            )}

            <div className="mt-4 flex gap-2">
              {!s.verified && s.kind === "OWN" && (
                <form action={verifySender}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700">
                    Проверить DNS
                  </button>
                </form>
              )}
              <form action={deleteSender}>
                <input type="hidden" name="id" value={s.id} />
                <button className="rounded-lg px-4 py-2 text-sm text-ink-500 hover:text-red-500">
                  Удалить
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>

      {!limits.customDomain && (
        <p className="mt-6 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-500">
          Сейчас у вас тариф «{PLANS[eff].name}». Чтобы слать по своей базе со своего
          домена, перейдите на «Про» в разделе{" "}
          <a href="/app/billing" className="underline">Тариф</a>.
        </p>
      )}
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
        ok ? "bg-mint-100 text-mint-700" : "bg-surface text-ink-500"
      }`}
    >
      {ok ? "✓" : "○"} {label}
    </span>
  );
}
