import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkoFromEnv, dataNewtonFromEnv, runProviderExperiment, type JsonValue } from "@/lib/company-data";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { z } from "zod";

const schema = z.object({
  okved: z.string().trim().min(2),
  region: z.string().trim().optional(),
  revenueFrom: z.number().nonnegative().optional(),
  employeesFrom: z.number().int().nonnegative().optional(),
  hasWebsite: z.boolean().default(true),
  hasEmail: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(25),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Требуется авторизация" }, { status: 401 });
  if (!hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "CONTACTS_VIEW")) {
    return Response.json({ error: "Недостаточно прав для поиска контактов" }, { status: 403 });
  }
  try {
    const query = schema.parse(await request.json());
    const useDataNewton = Boolean(process.env.DATANEWTON_API_KEY && process.env.DATANEWTON_BASE_URL && process.env.DATANEWTON_SEARCH_PATH);
    const filters: Record<string, JsonValue> = {
      okved: [query.okved],
      has_website: query.hasWebsite,
      has_email: query.hasEmail,
    };
    if (query.region) filters.region = [query.region];
    if (query.revenueFrom !== undefined) filters.revenue_from = query.revenueFrom;
    if (query.employeesFrom !== undefined) filters.employee_count_from = query.employeesFrom;
    const result = useDataNewton
      ? await runProviderExperiment({
          prisma, companyProvider: dataNewtonFromEnv(),
          query: { limit: query.limit, filters }, enrichWithHunter: false,
        })
      : await runProviderExperiment({
          prisma, companyProvider: checkoFromEnv(),
          query: { by: "okved", query: query.okved, obj: "org", active: true, limit: query.limit },
          enrichWithHunter: false,
        });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось выполнить поиск" }, { status: 400 });
  }
}
