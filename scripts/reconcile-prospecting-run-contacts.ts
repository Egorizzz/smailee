import { loadEnvConfig } from "@next/env";
import fs from "node:fs";
import path from "node:path";

loadEnvConfig(process.cwd());

async function main() {
  const runId = process.argv[2];
  if (!runId) throw new Error("Передайте id запуска");
  const { prisma } = await import("@/lib/prisma");
  try {
    const run = await prisma.prospectingRun.findUniqueOrThrow({
      where: { id: runId },
      include: { candidates: { select: { companyId: true } } },
    });
    const companyIds = run.candidates.map((candidate) => candidate.companyId);
    const contacts = await prisma.companyProspectContact.findMany({
      where: { companyId: { in: companyIds }, verificationState: { in: ["VALID", "ACCEPT_ALL"] } },
      orderBy: [{ verificationState: "desc" }, { confidence: "desc" }],
      select: { id: true, companyId: true },
    });
    for (const contact of contacts) {
      await prisma.prospectingRunContact.upsert({
        where: { runId_contactId: { runId, contactId: contact.id } },
        create: { runId, companyId: contact.companyId, contactId: contact.id },
        update: {},
      });
    }
    const byCompany = new Map<string, string[]>();
    for (const contact of contacts) byCompany.set(contact.companyId, [...(byCompany.get(contact.companyId) ?? []), contact.id]);
    for (const candidate of run.candidates) {
      const accepted = byCompany.get(candidate.companyId) ?? [];
      await prisma.prospectingRunCompany.update({
        where: { runId_companyId: { runId, companyId: candidate.companyId } },
        data: accepted.length
          ? { status: "ACCEPTED", rejectionReason: null, selectedContactId: accepted[0] }
          : { status: "REJECTED" },
      });
    }
    const acceptedCompanies = byCompany.size;
    await prisma.prospectingRun.update({
      where: { id: runId },
      data: {
        allowAcceptAll: true,
        minAcceptAllScore: 0,
        acceptedCount: contacts.length,
        rejectedCount: run.candidates.length - acceptedCompanies,
        error: null,
      },
    });
    const reconciled = await prisma.prospectingRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        candidates: { orderBy: { position: "asc" }, include: { company: true } },
        contacts: { include: { company: true, contact: { include: { sources: true } } } },
      },
    });
    const output = path.resolve("prospecting-control-30-reconciled.json");
    fs.writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), run: reconciled }, null, 2)}\n`);
    console.log(JSON.stringify({ runId, contacts: contacts.length, companies: acceptedCompanies, output }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
