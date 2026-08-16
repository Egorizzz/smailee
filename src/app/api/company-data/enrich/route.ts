import { getCurrentUser } from "@/lib/auth";
import { ensureCompanyDataSource, hunterFromEnv, ingestProviderCompanies } from "@/lib/company-data";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  domain: z.string().trim().min(3).max(255),
  limit: z.number().int().min(1).max(50).default(10),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Требуется авторизация" }, { status: 401 });
  if (!hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "CONTACTS_VIEW")) {
    return Response.json({ error: "Недостаточно прав для поиска контактов" }, { status: 403 });
  }
  try {
    const body = schema.parse(await request.json());
    const hunter = hunterFromEnv();
    await ensureCompanyDataSource(prisma, { key: hunter.key, name: hunter.name, capabilities: hunter.capabilities, priority: 20 });
    const page = await hunter.search({ domains: [body.domain], limitPerDomain: body.limit });
    if (page.items.length) await ingestProviderCompanies(prisma, hunter.key, page.items);
    const value = page.items[0]?.fields?.hunter_emails;
    const contacts = Array.isArray(value)
      ? value.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) && typeof item.email === "string" ? [{
          email: item.email,
          firstName: typeof item.first_name === "string" ? item.first_name : undefined,
          lastName: typeof item.last_name === "string" ? item.last_name : undefined,
          position: typeof item.position === "string" ? item.position : undefined,
          department: typeof item.department === "string" ? item.department : undefined,
          confidence: typeof item.confidence === "number" ? item.confidence : undefined,
        }] : [])
      : [];
    return Response.json({ contacts, usage: page.usage ?? { requests: 0 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось найти контакты" }, { status: 400 });
  }
}
