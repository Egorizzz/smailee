import { getCurrentUser } from "@/lib/auth";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user?.organizationId) return Response.json({ error: "Требуется организация" }, { status: 401 });
  if (!hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "CONTACTS_VIEW")) {
    return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const { id } = await params;
  const run = await prisma.prospectingRun.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      candidates: {
        orderBy: { position: "asc" },
        include: {
          company: { select: { id: true, displayName: true, legalName: true, communicationName: true, communicationNameConfidence: true, inn: true, domain: true, website: true } },
          selectedContact: { include: { sources: true } },
        },
      },
      contacts: {
        orderBy: { createdAt: "asc" }, take: 500,
        select: {
          company: { select: { displayName: true, legalName: true, communicationName: true, communicationNameConfidence: true, inn: true } },
          contact: { select: { email: true, name: true, role: true, kind: true, source: true, verificationState: true } },
        },
      },
      _count: { select: { issues: { where: { resolvedAt: null } } } },
      issues: { where: { resolvedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { code: true } },
    },
  });
  if (!run) return Response.json({ error: "Задание не найдено" }, { status: 404 });
  const { _count, issues, query, ...publicRun } = run;
  const searchMode = query && typeof query === "object" && !Array.isArray(query) && (query as Record<string, unknown>).search_mode === "deep" ? "deep" : "standard";
  return Response.json({
    run: {
      ...publicRun,
      searchMode,
      issueCount: _count.issues,
      latestIssueCode: issues[0]?.code ?? null,
    },
  });
}
