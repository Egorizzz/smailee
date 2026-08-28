import { can, requireCapability } from "@/lib/organization";
import { ProspectingWorkspace } from "@/components/ProspectingWorkspace";
import { isDemoWorkspaceActive } from "@/lib/demoWorkspace";
import { prisma } from "@/lib/prisma";
import { getCompanyInspectionUsage, getContactProcessingUsage } from "@/server/limits";
import { isPlanActive } from "@/lib/plans";
import { LEGAL_FORM_OPTIONS } from "@/lib/company-data/prospectingCatalog";

export default async function DiscoverContactsPage({ searchParams }: { searchParams: Promise<{ onboarding?: string }> }) {
  const workspace = await requireCapability("CONTACTS_VIEW");
  const { onboarding } = await searchParams;
  const demoActive = await isDemoWorkspaceActive(workspace.organizationId);
  if (demoActive) {
    const contacts = await prisma.contact.findMany({
      where: { userId: workspace.owner.id, isDemo: true },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        email: true,
        name: true,
        role: true,
        source: true,
        verificationState: true,
        company: true,
        sourceCompany: {
          select: {
            displayName: true,
            legalName: true,
            communicationName: true,
            communicationNameConfidence: true,
            inn: true,
          },
        },
      },
    });
    const demoRun = {
      id: "demo-prospecting-run",
      status: "COMPLETED",
      targetContacts: 30,
      maxCandidates: 120,
      processedCount: 74,
      acceptedCount: contacts.length,
      completionReason: "TARGET_REACHED",
      error: null,
      createdAt: new Date(Date.now() - 18 * 60_000),
      startedAt: new Date(Date.now() - 17 * 60_000),
      completedAt: new Date(Date.now() - 4 * 60_000),
      searchMode: "standard" as const,
      criteria: {
        description: "Технологические компании Москвы и Санкт-Петербурга, которым важны сервисы для сотрудников и посетителей",
        okveds: [{ code: "62.01", description: "Разработка компьютерного программного обеспечения" }],
        region: "77, 78",
        legalForms: ["organizations"],
        desiredRoles: ["Генеральный директор", "Директор по развитию", "HR-директор"],
        keywords: "",
        excludeCompanyTraits: "",
        onlyActive: true,
        segment: "Технологические компании",
        searchMode: "standard" as const,
      },
      contacts: contacts.map((contact) => ({
        company: {
          displayName: contact.sourceCompany?.displayName ?? contact.company,
          legalName: contact.sourceCompany?.legalName ?? contact.company,
          communicationName: contact.sourceCompany?.communicationName ?? contact.company,
          communicationNameConfidence: contact.sourceCompany?.communicationNameConfidence ?? 1,
          inn: contact.sourceCompany?.inn ?? null,
        },
        contact: {
          email: contact.email,
          name: contact.name,
          role: contact.role,
          kind: contact.name ? "person" : "generic",
          source: contact.source,
          verificationState: contact.verificationState,
        },
      })),
    };
    return <ProspectingWorkspace
      initialRun={demoRun}
      isAdmin={false}
      canManage={false}
      quota={{ used: 80, limit: 500, remaining: 420 }}
      searchBudget={{
        used: 160,
        limit: 1000,
        remaining: 840,
        deepUsed: 0,
        history: { standard: { processed: 74, accepted: 30 }, deep: { processed: 0, accepted: 0 } },
        historyByCriteria: {},
      }}
      profilePublished
      isTrial={false}
    />;
  }
  const [latestRun, profile, quota, searchBudget] = await Promise.all([prisma.prospectingRun.findFirst({
    where: { organizationId: workspace.organizationId!, status: { not: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, status: true, targetContacts: true, maxCandidates: true,
      processedCount: true, acceptedCount: true, error: true, completionReason: true,
      query: true,
      createdAt: true, startedAt: true, completedAt: true,
      _count: { select: { issues: { where: { resolvedAt: null } } } },
      issues: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { code: true } },
      contacts: {
        orderBy: { createdAt: "asc" }, take: 500,
        select: {
          company: { select: { displayName: true, legalName: true, communicationName: true, communicationNameConfidence: true, inn: true } },
          contact: { select: { email: true, name: true, role: true, kind: true, source: true, verificationState: true } },
        },
      },
    },
  }), prisma.organizationProfile.findUnique({ where: { organizationId: workspace.organizationId! }, select: { publishedAt: true } }), getContactProcessingUsage(workspace.owner), getCompanyInspectionUsage(workspace.owner)]);
  const initialRun = latestRun ? (() => {
    const { _count, issues, query, ...run } = latestRun;
    const saved = asRecord(query);
    const searchMode = saved?.search_mode === "deep" ? "deep" as const : "standard" as const;
    const okvedCodes = stringArray(saved?.okveds);
    const okvedLabels = Array.isArray(saved?.okved_labels) ? saved.okved_labels.flatMap((value) => {
      const item = asRecord(value);
      return typeof item?.code === "string" && typeof item.description === "string" ? [{ code: item.code, description: item.description }] : [];
    }) : [];
    const providerCodes = stringArray(saved?.opf_codes);
    const legalForms = stringArray(saved?.legal_forms);
    return {
      ...run,
      searchMode,
      criteria: {
        description: typeof saved?.search_description === "string" ? saved.search_description : "",
        okveds: okvedLabels.length ? okvedLabels : okvedCodes.map((code) => ({ code, description: "" })),
        region: stringArray(saved?.region_codes).join(", "),
        legalForms: legalForms.length ? legalForms : LEGAL_FORM_OPTIONS.filter((option) => option.providerCodes.length === providerCodes.length && option.providerCodes.every((code) => providerCodes.includes(code))).map((option) => option.value),
        desiredRoles: stringArray(saved?.desired_roles),
        keywords: stringArray(saved?.keywords).join(", "),
        excludeCompanyTraits: stringArray(saved?.exclude_company_traits).join(", "),
        onlyActive: saved?.only_active !== false,
        segment: typeof saved?.segment === "string" ? saved.segment : "Сегмент не определён",
        searchMode,
      },
      issueCount: _count.issues,
      latestIssueCode: issues[0]?.code ?? null,
    };
  })() : null;
  return <ProspectingWorkspace initialRun={initialRun} isAdmin={workspace.actor.role === "ADMIN"} canManage={can(workspace, "CONTACTS_MANAGE") && isPlanActive(workspace.owner.plan, workspace.owner.planExpiresAt)} quota={quota} searchBudget={searchBudget} profilePublished={Boolean(profile?.publishedAt)} defaultTargetContacts={onboarding ? Math.min(5, quota.remaining) : undefined} isTrial={workspace.owner.plan === "TRIAL"} planExpiresAt={workspace.owner.planExpiresAt?.toISOString() ?? null} />;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}
