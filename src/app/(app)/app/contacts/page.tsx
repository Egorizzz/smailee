import Link from "next/link";
import { can, requireCapability } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { releaseSuppression } from "./actions";
import { PermissionDeniedButton } from "@/components/PermissionDeniedButton";
import { isDemoWorkspaceActive } from "@/lib/demoWorkspace";
import { ContactsWorkspace, type ContactWorkspaceItem } from "@/components/ContactsWorkspace";
import { isPlanActive } from "@/lib/plans";
import { publicCompanyFacts, publicCompanyName, publicSegment } from "@/lib/company-data/contactPresentation";
import { effectiveCommunicationName } from "@/lib/mail/recipientPersonalization";

const reasonLabels: Record<string, string> = { unsubscribed: "Отписался", declined_via_reply: "Отказался в переписке", complained: "Пожаловался", bounced: "Не доставлено", manual: "Вручную" };
const RELEASE_SUGGESTED_AFTER_DAYS = 180;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ error?: string; tab?: string }> }) {
  const workspace = await requireCapability("CONTACTS_VIEW");
  const user = workspace.owner;
  const canManage = can(workspace, "CONTACTS_MANAGE");
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);
  const contactWhere = { userId: user.id, isDemo: demoActive };
  const { error, tab } = await searchParams;
  const activeTab = tab === "suppressions" ? "suppressions" : "contacts";
  const [total, contacts, suppressions] = await Promise.all([
    prisma.contact.count({ where: contactWhere }),
    prisma.contact.findMany({
      where: contactWhere, orderBy: { createdAt: "desc" }, take: 500,
      include: { sourceCompany: { include: { siteIntelligence: true } } },
    }),
    demoActive ? Promise.resolve([]) : prisma.suppression.findMany({ where: { userId: user.id, releasedAt: null }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  const items: ContactWorkspaceItem[] = contacts.map((contact) => {
    const intelligence = asRecord(contact.sourceCompany?.siteIntelligence?.intelligence);
    const companyData = asRecord(contact.sourceCompany?.data);
    const companyFacts = publicCompanyFacts(companyData, { inn: contact.sourceCompany?.inn });
    const activity = companyFacts.find((fact) => fact.key === "activity")?.value;
    const autoCommunicationName = effectiveCommunicationName({
      communicationName: contact.sourceCompany?.communicationName,
      communicationNameConfidence: contact.sourceCompany?.communicationNameConfidence,
    });
    const communicationName = effectiveCommunicationName({
      communicationNameOverride: contact.communicationNameOverride,
      communicationName: contact.sourceCompany?.communicationName,
      communicationNameConfidence: contact.sourceCompany?.communicationNameConfidence,
    });
    return {
      id: contact.id, email: contact.email, name: contact.name, company: communicationName,
      autoCommunicationName, communicationNameOverride: contact.communicationNameOverride,
      legalCompanyName: publicCompanyName(contact.sourceCompany?.legalName ?? contact.company),
      segment: publicSegment(contact.segment, activity), role: contact.role, source: contact.source, domain: contact.sourceCompany?.domain ?? contact.domain,
      website: contact.sourceCompany?.website ?? contact.website, status: contact.status, verificationState: contact.verificationState,
      verificationScore: contact.verificationScore, relevanceStatus: contact.relevanceStatus,
      irrelevanceReason: contact.irrelevanceReason, createdAt: contact.createdAt.toISOString(),
      customFields: asRecord(contact.customFields), companyFacts,
      siteIntelligence: intelligence ? {
        summary: typeof intelligence.summary === "string" ? intelligence.summary : undefined,
        facts: Array.isArray(intelligence.facts) ? intelligence.facts as Array<{ category?: string; value?: string }> : undefined,
        personalizationHooks: Array.isArray(intelligence.personalizationHooks) ? intelligence.personalizationHooks as Array<{ value?: string } | string> : undefined,
      } : null,
    };
  });

  return <div className="mx-auto max-w-6xl">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold text-slate-900">Контакты</h1></div>
    <div className="mt-5 flex gap-2 border-b border-line">{[
      { key: "contacts", href: "/app/contacts", label: `База · ${total}` },
      { key: "suppressions", href: "/app/contacts?tab=suppressions", label: `Отписки и стоп-лист · ${suppressions.length}` },
    ].map((item) => <Link key={item.key} href={item.href} className={`metric-number -mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${activeTab === item.key ? "border-mint-500 text-slate-900" : "border-transparent text-ink-500 hover:text-slate-900"}`}>{item.label}</Link>)}</div>
    {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Не удалось выполнить действие. Код: CNT-1001</div>}

    {activeTab === "contacts" ? <div className="mt-6">
      {demoActive && <p className="mb-4 rounded-lg border border-mint-100 bg-mint-50 px-4 py-3 text-sm text-mint-800">В демо показана виртуальная база. Просматривайте контакты и фильтры — реальные данные останутся без изменений.</p>}
      <ContactsWorkspace contacts={items} total={total} canManage={!demoActive && canManage && isPlanActive(user.plan, user.planExpiresAt)} />
    </div>
    : <Suppressions suppressions={suppressions} canManage={canManage} />}
  </div>;
}

function Suppressions({ suppressions, canManage }: { suppressions: Array<{ id: string; email: string; reason: string; createdAt: Date }>; canManage: boolean }) {
  return <><p className="mt-5 text-sm text-ink-500">Этим адресам письма не отправляются. Стоп-лист действует сразу для всех кампаний аккаунта.</p><div className="mt-4 overflow-hidden rounded-xl border border-line bg-white">{suppressions.length === 0 ? <div className="p-10 text-center text-ink-500">Стоп-лист пуст — это хорошо.</div> : <div className="scroll-x"><table className="w-full min-w-[480px] text-left text-sm"><thead className="bg-surface text-ink-500"><tr><th className="px-4 py-3 font-medium">Email</th><th className="px-4 py-3 font-medium">Причина</th><th className="px-4 py-3 font-medium">Дата</th><th className="px-4 py-3 font-medium">Действия</th></tr></thead><tbody>{suppressions.map((item) => { const daysAgo = Math.floor((Date.now() - item.createdAt.getTime()) / 86_400_000); const suggested = daysAgo >= RELEASE_SUGGESTED_AFTER_DAYS; return <tr key={item.id} className="border-t border-line"><td className="px-4 py-3 text-slate-900">{item.email}</td><td className="px-4 py-3"><span className="rounded-md bg-surface px-2 py-0.5 text-xs text-ink-700">{reasonLabels[item.reason] ?? item.reason}</span></td><td className="metric-number px-4 py-3 text-ink-500">{item.createdAt.toLocaleDateString("ru-RU")}</td><td className="px-4 py-3">{canManage ? <form action={releaseSuppression}><input type="hidden" name="id" value={item.id} /><button className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${suggested ? "border-mint-200 bg-mint-100 text-mint-700" : "border-line text-ink-500 hover:text-slate-900"}`}>Вернуть в базу</button></form> : <PermissionDeniedButton label="Вернуть в базу" className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink-500" />}</td></tr>; })}</tbody></table></div>}</div></>;
}

function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
