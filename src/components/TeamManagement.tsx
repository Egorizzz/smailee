"use client";

import { useActionState, useState } from "react";
import type { OrganizationPermission, OrganizationRole } from "@prisma/client";
import { inviteMemberAction, removeMemberAction, resendInviteAction, updateMemberAction } from "@/app/(app)/app/settings/teamActions";

type Member = {
  id: string;
  email: string;
  name: string | null;
  organizationRole: OrganizationRole;
  organizationPermissions: OrganizationPermission[];
  isOwner: boolean;
};

const permissionGroups: { title: string; items: { key: OrganizationPermission; label: string; hint: string }[] }[] = [
  { title: "Контакты", items: [
    { key: "CONTACTS_VIEW", label: "Просмотр базы", hint: "Видит контакты и стоп-лист." },
    { key: "CONTACTS_MANAGE", label: "Управление базой", hint: "Добавляет, импортирует и изменяет контакты; включает просмотр базы." },
  ] },
  { title: "Кампании", items: [
    { key: "CAMPAIGNS_VIEW_ALL", label: "Все кампании", hint: "Видит кампании, созданные коллегами." },
    { key: "CAMPAIGNS_CREATE", label: "Создание кампаний", hint: "Создаёт новые кампании от своего имени." },
    { key: "CAMPAIGNS_MANAGE_OWN", label: "Свои кампании", hint: "Редактирует и запускает только созданные собой кампании." },
    { key: "CAMPAIGNS_MANAGE_ALL", label: "Все кампании", hint: "Редактирует и запускает кампании всей организации; включает просмотр и управление своими." },
    { key: "CAMPAIGN_RECIPIENTS_VIEW", label: "Контакты получателей кампании", hint: "Видит имя, компанию и email получателей в карточках кампаний." },
    { key: "STATS_VIEW_ALL", label: "Общая статистика", hint: "Видит показатели всей организации." },
  ] },
  { title: "Лиды", items: [
    { key: "LEADS_VIEW_ALL", label: "Все лиды", hint: "Видит обращения по всем кампаниям." },
    { key: "LEADS_REPLY_OWN", label: "Ответы по своим кампаниям", hint: "Отвечает только лидам из собственных кампаний." },
    { key: "LEADS_REPLY_ALL", label: "Ответы всем лидам", hint: "Отвечает лидам из любых кампаний; включает просмотр всех лидов." },
  ] },
  { title: "Служебное", items: [
    { key: "INFRASTRUCTURE_MANAGE", label: "Инфраструктура", hint: "Подключает почтовые ящики и домены." },
    { key: "BILLING_MANAGE", label: "Тариф и оплата", hint: "Управляет тарифом организации." },
  ] },
];

const managerPreset: OrganizationPermission[] = ["CONTACTS_VIEW", "CONTACTS_MANAGE", "CAMPAIGNS_CREATE", "CAMPAIGNS_MANAGE_OWN", "LEADS_REPLY_OWN"];
const salesPreset: OrganizationPermission[] = ["CAMPAIGNS_VIEW_ALL", "STATS_VIEW_ALL", "LEADS_VIEW_ALL", "LEADS_REPLY_ALL"];

export function TeamManagement({ members }: { members: Member[] }) {
  return (
    <section className="mt-7">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Команда</h2>
          <p className="mt-1 text-sm text-ink-500">Нажмите на сотрудника, чтобы изменить его роль и доступы.</p>
        </div>
        <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-ink-500">{members.length} в команде</span>
      </div>
      <div className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
        {members.map((member) => <MemberCard key={member.id} member={member} />)}
      </div>
      <InviteForm />
    </section>
  );
}

function InviteForm() {
  const [state, action, pending] = useActionState(inviteMemberAction, undefined);
  const [preset, setPreset] = useState<"campaign" | "sales" | "custom">("campaign");
  const current = preset === "campaign" ? managerPreset : preset === "sales" ? salesPreset : [];
  return <details className="group mt-4 rounded-xl border border-line bg-white">
    <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-slate-900 marker:content-none">
      <span className="inline-flex items-center gap-2"><span className="grid size-7 place-items-center rounded-md bg-slate-900 text-lg leading-none text-white">+</span> Пригласить сотрудника</span>
      <span className="text-ink-500 transition group-open:rotate-45">+</span>
    </summary>
    <form action={action} className="border-t border-line p-4">
      <div className="grid gap-3 sm:grid-cols-2"><input name="email" required type="email" placeholder="employee@company.ru" className="input" /><select name="role" className="input"><option value="MEMBER">Сотрудник</option><option value="ORG_ADMIN">Администратор организации</option></select></div>
      <label className="mt-3 block text-sm font-medium text-slate-900">Стартовый набор</label>
      <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)} className="input mt-1">
        <option value="campaign">Менеджер кампаний</option><option value="sales">Менеджер продаж</option><option value="custom">Без доступов</option>
      </select>
      <details className="mt-3 rounded-lg border border-line bg-surface">
        <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-ink-700 marker:content-none">Настроить права <span className="float-right text-ink-500">⌄</span></summary>
        <div className="border-t border-line px-3 pb-3"><PermissionList key={preset} selected={current} /></div>
      </details>
      {state?.error && <p className="mt-3 text-sm text-red-500">{state.error}</p>}
      {state?.ok && <p className="mt-3 text-sm text-mint-700">{state.ok}</p>}
      <button disabled={pending} className="mt-4 rounded-lg brand-gradient px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Добавляем…" : "Отправить приглашение"}</button>
    </form>
  </details>;
}

function MemberCard({ member }: { member: Member }) {
  const [state, action, pending] = useActionState(updateMemberAction, undefined);
  const [inviteState, inviteAction, inviting] = useActionState(resendInviteAction, undefined);
  const [removeState, removeAction, removing] = useActionState(removeMemberAction, undefined);
  const isAdmin = member.organizationRole === "ORG_ADMIN";
  return <details className="group">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 marker:content-none hover:bg-surface/60">
      <div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface text-sm font-bold text-ink-700">{(member.name || member.email).slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate font-medium text-slate-900">{member.name || member.email}</p><p className="truncate text-xs text-ink-500">{member.name ? member.email : member.organizationRole === "ORG_ADMIN" ? "Администратор" : "Сотрудник"}</p></div></div>
      <div className="flex shrink-0 items-center gap-3">{member.isOwner && <span className="rounded-full bg-mint-50 px-2 py-1 text-xs font-medium text-mint-700">Владелец</span>}<span className="text-ink-500 transition group-open:rotate-180">⌄</span></div>
    </summary>
    {!member.isOwner && <div className="border-t border-line bg-surface/40 p-4"><form action={action}><input type="hidden" name="memberId" value={member.id} /><label className="block text-sm font-medium text-slate-900">Уровень доступа</label><select name="role" defaultValue={member.organizationRole} className="input mt-1"><option value="MEMBER">Сотрудник с выбранными доступами</option><option value="ORG_ADMIN">Администратор организации</option></select>{!isAdmin && <PermissionList selected={member.organizationPermissions} />}{isAdmin && <p className="mt-3 text-sm text-ink-500">Администратор имеет полный доступ к настройкам организации и команды.</p>}{state?.error && <p className="mt-3 text-sm text-red-500">{state.error}</p>}{state?.ok && <p className="mt-3 text-sm text-mint-700">{state.ok}</p>}<button disabled={pending} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Сохранить права</button></form>
      <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-3"><form action={inviteAction}><input type="hidden" name="memberId" value={member.id} /><button disabled={inviting} className="text-sm font-medium text-ink-700 disabled:opacity-60">Отправить приглашение повторно</button></form><form action={removeAction}><input type="hidden" name="memberId" value={member.id} /><button disabled={removing} className="text-sm font-medium text-red-600 disabled:opacity-60">Удалить из организации</button></form></div>
      {inviteState?.error && <p className="mt-2 text-sm text-red-500">{inviteState.error}</p>}{inviteState?.ok && <p className="mt-2 text-sm text-mint-700">{inviteState.ok}</p>}{removeState?.error && <p className="mt-2 text-sm text-red-500">{removeState.error}</p>}{removeState?.ok && <p className="mt-2 text-sm text-mint-700">{removeState.ok}</p>}
    </div>}
    {member.isOwner && <div className="border-t border-line bg-surface/40 px-4 py-3 text-sm text-ink-500">У владельца всегда полный доступ к кабинету.</div>}
  </details>;
}

function PermissionList({ selected }: { selected: OrganizationPermission[] }) {
  return <div className="mt-4 grid gap-3 sm:grid-cols-2">{permissionGroups.map((group) => <fieldset key={group.title} className="rounded-lg border border-line p-3"><legend className="px-1 text-xs font-semibold text-ink-500">{group.title}</legend>{group.items.map((permission) => <label key={permission.key} className="mt-2 flex gap-2 text-sm"><input type="checkbox" name="permissions" value={permission.key} defaultChecked={selected.includes(permission.key)} /><span><span className="block font-medium text-slate-900">{permission.label}</span><span className="block text-xs text-ink-500">{permission.hint}</span></span></label>)}</fieldset>)}</div>;
}
