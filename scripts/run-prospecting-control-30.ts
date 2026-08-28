import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const COMPANY_COUNT = 30;

async function main() {
  const [{ prisma }, { createProspectingRun, executeProspectingRun }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/company-data/prospectingRuns"),
  ]);
  const required = [
    "DATANEWTON_API_KEY",
    "DATANEWTON_BASE_URL",
    "DATANEWTON_SEARCH_PATH",
    "CHECKO_API_KEY",
    "FIRECRAWL_API_KEY",
    "HUNTER_API_KEY",
    "REOON_API_KEY",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Не настроены переменные: ${missing.join(", ")}`);

  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, ownerId: true },
  });
  if (!organization) throw new Error("В локальной базе нет организации для контрольного запуска");

  // An unreachable target makes the pipeline process all 30 selected companies.
  const run = await createProspectingRun(prisma, {
    organizationId: organization.id,
    createdById: organization.ownerId,
    query: {
      okveds: ["62.01"],
      region_codes: ["77"],
      only_active: true,
      only_with_websites: true,
      contact_conditions_operator: "AND",
    },
    targetContacts: 10_000,
    targetCompanies: COMPANY_COUNT,
    maxCandidates: COMPANY_COUNT,
    allowAcceptAll: false,
    budgets: {
      maxDataNewtonRecords: COMPANY_COUNT,
      maxCheckoRequests: COMPANY_COUNT,
      maxFirecrawlPages: COMPANY_COUNT * 3,
      maxHunterCredits: 60,
      maxReoonCredits: 80,
    },
  });
  const running = await prisma.prospectingRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  try {
    const result = await executeProspectingRun(prisma, running);
    const saved = await prisma.prospectingRun.findUniqueOrThrow({
      where: { id: run.id },
      include: {
        contacts: {
          include: {
            company: { select: { displayName: true, legalName: true, inn: true, domain: true, website: true } },
            contact: { include: { sources: true } },
          },
        },
        candidates: {
          orderBy: { position: "asc" },
          include: {
            company: { select: { displayName: true, legalName: true, inn: true, domain: true, website: true } },
          },
        },
      },
    });
    const contactsByCompany = new Map<string, number>();
    for (const item of saved.contacts) contactsByCompany.set(item.companyId, (contactsByCompany.get(item.companyId) ?? 0) + 1);
    const contactedCompanies = contactsByCompany.size;
    const report = {
      generatedAt: new Date().toISOString(),
      segment: { okved: "62.01", region: "77", label: "ИТ · Москва · действующие · с сайтом" },
      runId: run.id,
      status: saved.status,
      selectedCompanies: result.selected,
      processedCompanies: result.processed,
      companiesWithAcceptedContacts: contactedCompanies,
      companiesWithoutAcceptedContacts: result.processed - contactedCompanies,
      acceptedContacts: saved.contacts.length,
      averageAcceptedContactsPerCoveredCompany: contactedCompanies ? saved.contacts.length / contactedCompanies : 0,
      coveragePercent: result.processed ? (contactedCompanies / result.processed) * 100 : 0,
      usage: result.usage,
      budgets: saved.budgets,
      candidates: saved.candidates.map((candidate) => ({
        position: candidate.position,
        status: candidate.status,
        rejectionReason: candidate.rejectionReason,
        company: candidate.company,
        acceptedContacts: contactsByCompany.get(candidate.companyId) ?? 0,
      })),
      contacts: saved.contacts.map((item) => ({ company: item.company, contact: item.contact })),
    };
    const output = path.resolve("prospecting-control-30.json");
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      output,
      runId: run.id,
      selectedCompanies: report.selectedCompanies,
      processedCompanies: report.processedCompanies,
      companiesWithAcceptedContacts: report.companiesWithAcceptedContacts,
      acceptedContacts: report.acceptedContacts,
      coveragePercent: report.coveragePercent,
      usage: report.usage,
    }, null, 2));
  } catch (error) {
    await prisma.prospectingRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000) },
    });
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
