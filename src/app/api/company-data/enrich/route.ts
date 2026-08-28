import { getCurrentUser } from "@/lib/auth";
import { cachedExternalOperation, ensureCompanyDataSource, hunterDomainLimit, hunterFromEnv, ingestProviderCompanies } from "@/lib/company-data";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { productErrorResponse } from "@/lib/productErrors";

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
    const cached = await cachedExternalOperation({
      prisma, provider: hunter.key, operation: "domainSearch", params: { domain: body.domain, limit: hunterDomainLimit(body.limit) },
      execute: () => hunter.search({ domains: [body.domain], limitPerDomain: hunterDomainLimit(body.limit) }),
      usage: (value) => value.usage,
    });
    const page = cached.value;
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
    return Response.json({ contacts, usage: cached.cacheHit ? { requests: 0, credits: 0 } : page.usage ?? { requests: 0 }, cacheHit: cached.cacheHit, expiresInDays: 180 });
  } catch (error) {
    return productErrorResponse(error, "SRC-2121");
  }
}
