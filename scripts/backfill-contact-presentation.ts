import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const [{ prisma }, presentation] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/company-data/contactPresentation"),
  ]);
  const contacts = await prisma.contact.findMany({
    where: { OR: [{ segment: "AI-подборка" }, { company: "Информация о компании" }] },
    include: { sourceCompany: true },
  });
  let updatedContacts = 0;
  const companyIds = new Set<string>();
  for (const contact of contacts) {
    const companyData = contact.sourceCompany?.data && typeof contact.sourceCompany.data === "object" && !Array.isArray(contact.sourceCompany.data)
      ? contact.sourceCompany.data as Record<string, unknown>
      : null;
    const activity = presentation.publicCompanyFacts(companyData).find((fact) => fact.key === "activity")?.value;
    const company = presentation.publicCompanyName(contact.company)
      ?? presentation.publicCompanyName(contact.sourceCompany?.displayName)
      ?? presentation.publicCompanyName(contact.sourceCompany?.legalName);
    const segment = presentation.publicSegment(contact.segment, activity);
    if (company !== contact.company || segment !== contact.segment) {
      await prisma.contact.update({ where: { id: contact.id }, data: { company, segment } });
      updatedContacts++;
    }
    if (contact.sourceCompany && presentation.isCompanyNamePlaceholder(contact.sourceCompany.displayName)) companyIds.add(contact.sourceCompany.id);
  }
  let updatedCompanies = 0;
  for (const id of companyIds) {
    const company = await prisma.company.findUnique({ where: { id }, select: { legalName: true } });
    const displayName = presentation.publicCompanyName(company?.legalName);
    if (displayName) {
      await prisma.company.update({ where: { id }, data: { displayName } });
      updatedCompanies++;
    }
  }
  console.log(JSON.stringify({ scannedContacts: contacts.length, updatedContacts, updatedCompanies }));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
