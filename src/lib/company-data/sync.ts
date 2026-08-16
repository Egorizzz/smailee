import type { PrismaClient } from "@prisma/client";
import { getCompanyProvider } from "./providerRegistry";
import { ensureCompanyDataSource, ensureCompanyFieldDefinitions, ingestProviderCompanies } from "./repository";

export async function syncCompanyProviderPage(
  prisma: PrismaClient,
  sourceKey: string,
  query: unknown,
  cursor?: string,
) {
  const provider = getCompanyProvider(sourceKey);
  await ensureCompanyDataSource(prisma, {
    key: provider.key, name: provider.name, capabilities: provider.capabilities,
  });
  await ensureCompanyFieldDefinitions(prisma, provider.fieldDefinitions ?? []);
  const page = await provider.search(query, cursor);
  const ingested = await ingestProviderCompanies(prisma, provider.key, page.items);
  return { ingested, nextCursor: page.nextCursor };
}
