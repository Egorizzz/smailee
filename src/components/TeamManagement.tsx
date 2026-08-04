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
    { key: "CONTACTS_MANAGE", label: "Управление базой", hint: "Добавляет, импортирует и изменяет контакты." },
  ] },
  { title: "Кампании", items: [
    { key: "CAMPAIGNS_VIEW_ALL", label: "Все кампании", hint: "Видит кампании, созданные коллегами." },
    { key: "CAMPAIGNS_CREATE", label: "Создание кампаний", hint: "Создаёт новые кампании от своего имени." },
    { key: "CAMPAIGNS_MANAGE_OWN", label: "Свои кампании", hint: "Редактирует и запускает только созданные собой кампании." },
    { key: "CAMPAIGNS_MANAGE_ALL", label: "Все кампании", hint: "Редактирует и запускает кампании всей организации." },
    { key: "STATS_VIEW_ALL", label: "Общая статистика", hint: "Видит показатели всей организации." },
  ] },
  { title: "Лиды", items: [
    { key: "LEADS_VIEW_ALL", label: "Все лиды", hint: "Видит обращения по всем кампаниям." },
    { key: "LEADS_REPLY_OWN", label: "Ответы по своим кампаниям", hint: "Отвечает только лидам из собственных кампаний." },
    { key: "LEADS_REPLY_ALL", label: "Ответы всем лидам", hint: "Отвечает лидам из любых кампаний." },
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
    <section className="mt-10 border-t border-line pt-8">
      <h2 className="text-lg font-semibold text-slate-900">Команда</h2>
      <p className="mt-1 text-sm text-ink-500">Добавляйте сотрудников и включайте только нужные им доступы. Настройки организации доступны только администраторам.</p>
      <InviteForm />
      <div className="mt-6 space-y-4">
        {members.map((member) => <MemberCard key={member.id} member={member} />)}
      </div>
    </section>
  );
}

function InviteForm() {
  const [state, action, pending] = useActionState(inviteMemberAction, undefined);
  const [preset, setPreset] = useState<"campaign" | "sales" | "custom">("campaign");
  const current = preset === "campaign" ? managerPreset : preset === "sales" ? salesPreset : [];
  return <form action={action} className="mt-4 rounded-xl border border-line bg-surface p-4">
    <div className="grid gap-3 sm:grid-cols-2"><input name="email" required type="email" placeholder="employee@company.ru" className="input" /><select name="role" className="input"><option value="MEMBER">Сотрудник</option><option value="ORG_ADMIN">Администратор организации</option></select></div>
    <label className="mt-3 block text-sm font-medium text-slate-900">Стартовый набор</label>
    <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)} className="input mt-1">
      <option value="campaign">Менеджер кампаний</option><option value="sales">Менеджер продаж</option><option value="custom">Без доступов — настрою вручную</option>
    </select>
    <PermissionList key={preset} selected={current} />
    {state?.error && <p className="mt-3 text-sm text-red-500">{state.error}</p>}
    {state?.ok && <p className="mt-3 text-sm text-mint-700">{state.ok}</p>}
    <button disabled={pending} className="mt-4 rounded-lg brand-gradient px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Добавляем…" : "Пригласить сотрудника"}</button>
  </form>;
}

function MemberCard({ member }: { member: Member }) {
  const [state, action, pending] = useActionState(updateMemberAction, undefined);
  const [inviteState, inviteAction, inviting] = useActionState(resendInviteAction, undefined);
  const [removeState, removeAction, removing] = useActionState(removeMemberAction, undefined);
  const isAdmin = member.organizationRole === "ORG_ADMIN";
  return <div className="rounded-xl border border-line bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium text-slate-900">{member.name || member.email}</p>{member.name && <p className="text-sm text-ink-500">{member.email}</p>}</div>{member.isOwner && <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">Владелец</span>}</div>
    {!member.isOwner && <form action={action} className="mt-4"><input type="hidden" name="memberId" value={member.id} /><label className="block text-sm font-medium text-slate-900">Уровень доступа</label><select name="role" defaultValue={member.organizationRole} className="input mt-1"><option value="MEMBER">Сотрудник с выбранными доступами</option><option value="ORG_ADMIN">Администратор организации</option></select>{!isAdmin && <PermissionList selected={member.organizationPermissions} />}{isAdmin && <p className="mt-3 text-sm text-ink-500">У администратора всегда полный доступ, включая настройки организации и команду.</p>}{state?.error && <p className="mt-3 text-sm text-red-500">{state.error}</p>}{state?.ok && <p className="mt-3 text-sm text-mint-700">{state.ok}</p>}<button disabled={pending} className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 disabled:opacity-60">Сохранить доступы</button></form>}
    {!member.isOwner && <div className="mt-4 flex flex-wrap gap-2"><form action={inviteAction}><input type="hidden" name="memberId" value={member.id} /><button disabled={inviting} className="text-sm font-medium text-indigo-600 disabled:opacity-60">Отправить ссылку повторно</button></form><form action={removeAction}><input type="hidden" name="memberId" value={member.id} /><button disabled={removing} className="text-sm font-medium text-red-600 disabled:opacity-60">Удалить из организации</button></form></div>}
    {inviteState?.error && <p className="mt-2 text-sm text-red-500">{inviteState.error}</p>}{inviteState?.ok && <p className="mt-2 text-sm text-mint-700">{inviteState.ok}</p>}{removeState?.error && <p className="mt-2 text-sm text-red-500">{removeState.error}</p>}{removeState?.ok && <p className="mt-2 text-sm text-mint-700">{removeState.ok}</p>}
  </div>;
}

function PermissionList({ selected }: { selected: OrganizationPermission[] }) {
  return <div className="mt-4 grid gap-3 sm:grid-cols-2">{permissionGroups.map((group) => <fieldset key={group.title} className="rounded-lg border border-line p-3"><legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{group.title}</legend>{group.items.map((permission) => <label key={permission.key} className="mt-2 flex gap-2 text-sm"><input type="checkbox" name="permissions" value={permission.key} defaultChecked={selected.includes(permission.key)} /><span><span className="block font-medium text-slate-900">{permission.label}</span><span className="block text-xs text-ink-500">{permission.hint}</span></span></label>)}</fieldset>)}</div>;
}
