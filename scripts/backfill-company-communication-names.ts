import { prisma } from "../src/lib/prisma";
import {
  communicationNameFromIdentityFact,
  companySiteIntelligenceSchema,
  selectSiteCommunicationName,
} from "../src/lib/company-data/siteIntelligence";

const apply = process.argv.includes("--apply");

async function main() {
  const records = await prisma.companySiteIntelligence.findMany({
    where: { status: "READY", company: { communicationName: null } },
    include: { company: true },
  });
  let found = 0;
  let updated = 0;
  for (const record of records) {
    const parsed = companySiteIntelligenceSchema.safeParse(record.intelligence);
    if (!parsed.success) continue;
    const candidates = parsed.data.communicationName ? [parsed.data.communicationName] : parsed.data.facts
      .filter((fact) => fact.category === "identity")
      .flatMap((fact) => communicationNameFromIdentityFact(fact) ?? []);
    const candidate = selectSiteCommunicationName(candidates, record.company.domain);
    if (!candidate) continue;
    found++;
    console.log(`${record.company.domain ?? record.rootUrl}: ${candidate.value}`);
    if (!apply) continue;
    await prisma.$transaction([
      prisma.company.update({ where: { id: record.companyId }, data: {
        communicationName: candidate.value,
        communicationNameConfidence: candidate.confidence,
        communicationNameSource: candidate.sourceUrl,
        communicationNameEvidence: candidate.evidence,
        communicationNameUpdatedAt: record.analyzedAt ?? new Date(),
      } }),
      prisma.companySiteIntelligence.update({ where: { id: record.id }, data: {
        intelligence: { ...parsed.data, communicationName: candidate },
      } }),
    ]);
    updated++;
  }
  console.log(JSON.stringify({ scanned: records.length, found, updated, mode: apply ? "apply" : "dry-run" }));
}

main().finally(() => prisma.$disconnect());
