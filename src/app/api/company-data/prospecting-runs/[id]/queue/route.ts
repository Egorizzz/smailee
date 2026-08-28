import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { prisma } from "@/lib/prisma";
import { queueProspectingRun } from "@/lib/company-data";
import { productErrorResponse } from "@/lib/productErrors";
import { isPlanActive } from "@/lib/plans";

const schema = z.object({ confirmed: z.literal(true) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user?.organizationId) return Response.json({ error: "Требуется организация", code: "AUTH-1001" }, { status: 401 });
  if (!hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "CONTACTS_MANAGE")) return Response.json({ error: "Недостаточно прав", code: "AUTH-1003" }, { status: 403 });
  try {
    schema.parse(await request.json());
    const owner = (await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId }, include: { owner: true } })).owner;
    if (!isPlanActive(owner.plan, owner.planExpiresAt)) return Response.json({ error: "Доступ приостановлен. Оплатите тариф, чтобы продолжить поиск.", code: "BILL-1002" }, { status: 409 });
    const { id } = await params;
    return Response.json({ run: await queueProspectingRun(prisma, user.organizationId, id) });
  }
  catch (error) { return productErrorResponse(error, "SRC-2001"); }
}
