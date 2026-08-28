import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { analyzeCompanySite } from "@/lib/company-data/siteIntelligence";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { prisma } from "@/lib/prisma";
import { productErrorResponse } from "@/lib/productErrors";

export const maxDuration = 300;

const inputSchema = z.object({
  companyId: z.string().trim().min(1),
  maxPages: z.number().int().min(1).max(3).default(3),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Требуется авторизация" }, { status: 401 });
  if (!hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "CONTACTS_VIEW")) {
    return Response.json({ error: "Недостаточно прав для анализа компаний" }, { status: 403 });
  }
  try {
    const input = inputSchema.parse(await request.json());
    const result = await analyzeCompanySite(prisma, input.companyId, { maxPages: input.maxPages });
    return Response.json(result);
  } catch (error) {
    return productErrorResponse(error, "CNT-1301");
  }
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Требуется авторизация" }, { status: 401 });
  if (!hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "CONTACTS_VIEW")) {
    return Response.json({ error: "Недостаточно прав для просмотра анализа" }, { status: 403 });
  }
  const companyId = new URL(request.url).searchParams.get("companyId");
  if (!companyId) return Response.json({ error: "Не указан companyId" }, { status: 400 });
  const result = await prisma.companySiteIntelligence.findUnique({ where: { companyId } });
  return result ? Response.json(result) : Response.json({ error: "Анализ ещё не выполнен" }, { status: 404 });
}
