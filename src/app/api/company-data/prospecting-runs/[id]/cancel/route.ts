import { getCurrentUser } from "@/lib/auth";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { prisma } from "@/lib/prisma";
import { cancelProspectingRun } from "@/lib/company-data";
import { productErrorResponse } from "@/lib/productErrors";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user?.organizationId) return Response.json({ error: "Требуется организация", code: "AUTH-1001" }, { status: 401 });
  if (!hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "CONTACTS_MANAGE")) return Response.json({ error: "Недостаточно прав", code: "AUTH-1003" }, { status: 403 });
  try { const { id } = await params; await cancelProspectingRun(prisma, user.organizationId, id); return Response.json({ ok: true }); }
  catch (error) { return productErrorResponse(error, "SRC-2001"); }
}
