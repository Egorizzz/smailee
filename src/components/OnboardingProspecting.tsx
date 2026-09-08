import { ProspectingWorkspace } from "@/components/ProspectingWorkspace";
import { can, type Workspace } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { getCompanyInspectionUsage, getContactProcessingUsage } from "@/server/limits";
import { isPlanActive } from "@/lib/plans";
import { LEGAL_FORM_OPTIONS } from "@/lib/company-data/prospectingCatalog";

export async function OnboardingProspecting({ workspace }: { workspace: Workspace }) {
  const [latestRun, profile, quota, searchBudget] = await Promise.all([
    prisma.prospectingRun.findFirst({
      where: { organizationId: workspace.organizationId!, status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, status: true, targetContacts: true, maxCandidates: true,
        processedCount: true, acceptedCount: true, error: true, completionReason: true,
        query: true, createdAt: true, startedAt: true, completedAt: true,
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
    }),
    prisma.organizationProfile.findUnique({ where: { organizationId: workspace.organizationId! }, select: { publishedAt: true } }),
    getContactProcessingUsage(workspace.owner),
    getCompanyInspectionUsage(workspace.owner),
  ]);

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
        segment: typeof saved?.segment === "string" ? saved.segment : "",
        searchMode,
      },
      issueCount: _count.issues,
      latestIssueCode: issues[0]?.code ?? null,
    };
  })() : null;

  return <ProspectingWorkspace
    initialRun={initialRun}
    isAdmin={workspace.actor.role === "ADMIN"}
    canManage={can(workspace, "CONTACTS_MANAGE") && isPlanActive(workspace.owner.plan, workspace.owner.planExpiresAt)}
    quota={quota}
    searchBudget={searchBudget}
    profilePublished={Boolean(profile?.publishedAt)}
    defaultTargetContacts={Math.min(5, quota.remaining)}
    isTrial={workspace.owner.plan === "TRIAL"}
    planExpiresAt={workspace.owner.planExpiresAt?.toISOString() ?? null}
    embedded
  />;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}
