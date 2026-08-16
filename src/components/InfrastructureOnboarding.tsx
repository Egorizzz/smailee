"use client";

import { useState } from "react";

const steps = [
  { title: "Подготовьте домены", text: "Используйте отдельные рассылочные домены. Для каждого домена подключите Яндекс 360 для бизнеса и подтвердите владение доменом." },
  { title: "Настройте DNS", text: "Добавьте выданные Яндексом записи MX, SPF и DKIM. Дождитесь, пока проверка домена завершится." },
  { title: "Создайте ящики", text: "Добавьте сотрудников в админке Яндекс 360. Для стабильной отправки размещайте не более 4 ящиков на одном домене." },
  { title: "Разрешите подключение", text: "В настройках Почты включите IMAP. Затем войдите в каждый ящик, примите соглашение и создайте отдельный пароль приложения для Почты." },
  { title: "Подключите в Smailee", text: "Укажите имя отправителя, email и пароль приложения. После проверки ящик автоматически начнёт прогреваться." },
];

export function InfrastructureOnboarding() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 hover:border-slate-300">
      Как подготовить инфраструктуру
    </button>
    {open && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4" role="dialog" aria-modal="true" aria-labelledby="infra-guide-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-white shadow-2xl">
        <div className="sticky top-0 flex items-start justify-between border-b border-line bg-white px-5 py-4">
          <div><p className="text-xs font-semibold text-mint-700">Подготовка к подключению</p><h2 id="infra-guide-title" className="mt-1 text-xl font-bold text-slate-900">Создание почтовой инфраструктуры</h2></div>
          <button type="button" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-md text-xl text-ink-500 hover:bg-surface" aria-label="Закрыть">×</button>
        </div>
        <ol className="divide-y divide-line px-5">
          {steps.map((step, index) => <li key={step.title} className="grid grid-cols-[32px_1fr] gap-3 py-4"><span className="grid size-7 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{index + 1}</span><div><h3 className="font-semibold text-slate-900">{step.title}</h3><p className="mt-1 text-sm leading-6 text-ink-500">{step.text}</p></div></li>)}
        </ol>
        <div className="border-t border-line bg-amber-50 px-5 py-4 text-sm text-amber-800">Расчёт количества доменов и ящиков находится в плане инфраструктуры. Подключайте только полностью созданные и проверенные ящики.</div>
      </div>
    </div>}
  </>;
}
