import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { completeProspectingCompanyReview } from "@/lib/company-data";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { isPlanActive } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { productErrorResponse } from "@/lib/productErrors";

const schema = z.object({
  skip: z.boolean().default(false),
  decisions: z.array(z.object({
    companyId: z.string().min(1),
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason: z.string().trim().max(500).optional(),
  })).max(20).default([]),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user?.organizationId) return Response.json({ error: "Требуется организация", code: "AUTH-1001" }, { status: 401 });
  if (!hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "CONTACTS_MANAGE")) {
    return Response.json({ error: "Недостаточно прав", code: "AUTH-1003" }, { status: 403 });
  }
  try {
    const body = schema.parse(await request.json());
    const owner = (await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId }, include: { owner: true } })).owner;
    if (!isPlanActive(owner.plan, owner.planExpiresAt)) {
      return Response.json({ error: "Доступ приостановлен. Оплатите тариф, чтобы продолжить поиск.", code: "BILL-1002" }, { status: 409 });
    }
    const { id } = await params;
    const run = await completeProspectingCompanyReview(prisma, {
      organizationId: user.organizationId,
      runId: id,
      decisions: body.decisions,
      skip: body.skip,
    });
    return Response.json({ run });
  } catch (error) {
    return productErrorResponse(error, "SRC-2013");
  }
}
