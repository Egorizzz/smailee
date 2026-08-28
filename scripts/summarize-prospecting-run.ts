import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const runId = process.argv[2];
  if (!runId) throw new Error("Передайте id запуска");
  const { prisma } = await import("@/lib/prisma");
  try {
    const run = await prisma.prospectingRun.findUniqueOrThrow({
      where: { id: runId },
      include: { candidates: { select: { companyId: true } }, contacts: { select: { contactId: true } } },
    });
    const companyIds = run.candidates.map((item) => item.companyId);
    const allContacts = await prisma.companyProspectContact.findMany({
      where: { companyId: { in: companyIds } },
      select: { companyId: true, kind: true, source: true, verificationState: true, verificationStatus: true },
    });
    const acceptedIds = new Set(run.contacts.map((item) => item.contactId));
    const companiesByState = (state: string) => new Set(
      allContacts.filter((item) => item.verificationState === state).map((item) => item.companyId),
    ).size;
    const companiesWithDeliverableOrAcceptAll = new Set(
      allContacts.filter((item) => item.verificationState === "VALID" || item.verificationState === "ACCEPT_ALL").map((item) => item.companyId),
    ).size;
    const group = (values: Array<string | null>) => Object.fromEntries(
      [...new Set(values.map((value) => value ?? "unset"))].map((key) => [key, values.filter((value) => (value ?? "unset") === key).length]),
    );
    console.log(JSON.stringify({
      runId,
      candidateCompanies: companyIds.length,
      companiesWithAnyDiscoveredEmail: new Set(allContacts.map((item) => item.companyId)).size,
      companiesWithValidOrAcceptAll: companiesWithDeliverableOrAcceptAll,
      allDiscoveredEmails: allContacts.length,
      acceptedEmails: acceptedIds.size,
      rejectedOrUnverifiedEmailsRetained: allContacts.length - acceptedIds.size,
      verificationStates: group(allContacts.map((item) => item.verificationState)),
      companiesByVerificationState: {
        valid: companiesByState("VALID"),
        acceptAll: companiesByState("ACCEPT_ALL"),
        invalid: companiesByState("INVALID"),
      },
      verificationStatuses: group(allContacts.map((item) => item.verificationStatus)),
      kinds: group(allContacts.map((item) => item.kind)),
      primarySources: group(allContacts.map((item) => item.source)),
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
