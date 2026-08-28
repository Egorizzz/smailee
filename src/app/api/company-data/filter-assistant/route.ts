import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { suggestProspectingFilters } from "@/lib/services/llm";
import { productErrorResponse } from "@/lib/productErrors";

const schema = z.object({ description: z.string().trim().max(2_000).optional(), includeProfile: z.boolean().default(true) });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.organizationId) return Response.json({ error: "Требуется организация", code: "AUTH-1001" }, { status: 401 });
  if (!hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "CONTACTS_VIEW")) return Response.json({ error: "Недостаточно прав", code: "AUTH-1003" }, { status: 403 });
  try {
    const body = schema.parse(await request.json());
    const [profile, exclusions] = await Promise.all([
      body.includeProfile ? prisma.organizationProfile.findUnique({ where: { organizationId: user.organizationId }, select: { publishedData: true, publishedAt: true } }) : null,
      prisma.contactRelevanceFeedback.findMany({ where: { organizationId: user.organizationId }, orderBy: { createdAt: "desc" }, take: 50, select: { reason: true, companySnapshot: true } }),
    ]);
    const suggestion = await suggestProspectingFilters({ description: body.description, profile: profile?.publishedData, exclusions });
    return Response.json({ suggestion, profilePublished: Boolean(profile?.publishedAt) });
  } catch (error) { return productErrorResponse(error, "AI-3001"); }
}
