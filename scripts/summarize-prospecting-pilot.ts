import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const reportPath = path.resolve(process.argv[2] ?? "prospecting-pilot-5.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as { runId: string };
  const { prisma } = await import("@/lib/prisma");
  const run = await prisma.prospectingRun.findUniqueOrThrow({
    where: { id: report.runId },
    include: {
      candidates: {
        orderBy: { position: "asc" },
        include: {
          company: { select: { displayName: true, inn: true, domain: true } },
          selectedContact: true,
        },
      },
    },
  });
  const companyIds = run.candidates.map((candidate) => candidate.companyId);
  const contacts = await prisma.companyProspectContact.findMany({
    where: { companyId: { in: companyIds } },
    select: { companyId: true, email: true, source: true, kind: true, verificationState: true, verificationScore: true },
    orderBy: [{ companyId: "asc" }, { confidence: "desc" }],
  });
  const byCompany = new Map<string, typeof contacts>();
  for (const contact of contacts) byCompany.set(contact.companyId, [...(byCompany.get(contact.companyId) ?? []), contact]);
  const rows = run.candidates.map((candidate) => ({
    position: candidate.position,
    company: candidate.company.displayName,
    inn: candidate.company.inn,
    domain: candidate.company.domain,
    status: candidate.status,
    rejectionReason: candidate.rejectionReason,
    selectedEmail: candidate.selectedContact?.email,
    contacts: (byCompany.get(candidate.companyId) ?? []).map(({ email, source, kind, verificationState, verificationScore }) => ({ email, source, kind, verificationState, verificationScore })),
    hooks: Array.isArray(candidate.personalizationHooks) ? candidate.personalizationHooks.length : 0,
  }));
  console.log(JSON.stringify({ runId: run.id, status: run.status, rows }, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => { console.error(error); process.exit(1); });
