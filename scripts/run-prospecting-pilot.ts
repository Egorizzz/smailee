import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const [{ prisma }, { createProspectingRun, executeProspectingRun }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/company-data/prospectingRuns"),
  ]);
  const required = ["DATANEWTON_API_KEY", "DATANEWTON_BASE_URL", "DATANEWTON_SEARCH_PATH", "CHECKO_API_KEY", "FIRECRAWL_API_KEY", "HUNTER_API_KEY"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Не настроены переменные: ${missing.join(", ")}`);

  const organization = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, ownerId: true } });
  if (!organization) throw new Error("В локальной базе нет организации для привязки тестового задания");

  const run = await createProspectingRun(prisma, {
    organizationId: organization.id,
    createdById: organization.ownerId,
    query: {
      okveds: ["62.01"],
      region_codes: ["77"],
      only_active: true,
      only_with_websites: true,
      only_with_emails: true,
      contact_conditions_operator: "AND",
    },
    targetCompanies: 5,
    maxCandidates: 10,
    allowAcceptAll: false,
    budgets: {
      maxDataNewtonRecords: 10,
      maxCheckoRequests: 10,
      maxFirecrawlPages: 15,
      maxHunterCredits: 6,
    },
  });
  const running = await prisma.prospectingRun.update({ where: { id: run.id }, data: { status: "RUNNING", startedAt: new Date() } });

  try {
    const result = await executeProspectingRun(prisma, running);
    const saved = await prisma.prospectingRun.findUniqueOrThrow({
      where: { id: run.id },
      include: {
        candidates: {
          orderBy: { position: "asc" },
          include: {
            company: { select: { displayName: true, legalName: true, inn: true, domain: true, website: true } },
            selectedContact: { include: { sources: true } },
          },
        },
      },
    });
    const report = {
      generatedAt: new Date().toISOString(),
      segment: { okved: "62.01", region: "77", label: "ИТ · Москва" },
      runId: run.id,
      status: saved.status,
      target: result.target,
      complete: result.complete,
      selected: result.selected,
      processed: result.processed,
      accepted: result.accepted,
      rejected: result.rejected,
      budgets: saved.budgets,
      usage: result.usage,
      candidates: saved.candidates,
    };
    const output = path.resolve("prospecting-pilot-5.json");
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ output, runId: run.id, complete: result.complete, selected: result.selected, processed: result.processed, accepted: result.accepted, rejected: result.rejected, usage: result.usage }, null, 2));
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
