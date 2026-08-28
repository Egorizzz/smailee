import { prisma } from "@/lib/prisma";
import { consolidateDuplicateCompanies } from "@/lib/company-data/repository";

async function main() {
  const groups = new Map<string, Array<{ id: string; inn: string | null; ogrn: string | null; displayName: string | null }>>();
  const companies = await prisma.company.findMany({
    where: { domain: { not: null } },
    select: { id: true, inn: true, ogrn: true, domain: true, displayName: true },
    orderBy: { createdAt: "asc" },
  });
  for (const company of companies) {
    if (!company.domain) continue;
    const group = groups.get(company.domain) ?? [];
    group.push(company);
    groups.set(company.domain, group);
  }
  const safeGroups = [...groups.entries()].filter(([, group]) =>
    group.length > 1 && group.filter((company) => company.inn || company.ogrn).length <= 1,
  );
  console.log(`Безопасных групп для объединения: ${safeGroups.length}`);
  for (const [domain, group] of safeGroups) {
    console.log(`- ${domain}: ${group.map((company) => `${company.displayName ?? company.id}${company.inn ? ` (ИНН ${company.inn})` : ""}`).join(" + ")}`);
  }
  if (!process.argv.includes("--apply")) {
    console.log("Изменения не внесены. Для применения добавьте --apply.");
    return;
  }
  const merged = await consolidateDuplicateCompanies(prisma);
  console.log(`Объединено записей: ${merged}`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
