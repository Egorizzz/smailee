import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";
import { ReoonProvider } from "../src/lib/company-data/providers/reoon";

loadEnvConfig(process.cwd());

const OUTPUT = path.resolve("reoon-verification-study.json");
const TTL_MS = 180 * 24 * 60 * 60 * 1_000;
const SAMPLE_LIMIT = Math.min(Math.max(Number(process.env.REOON_STUDY_LIMIT ?? 12), 1), 25);
type CachedResult = Awaited<ReturnType<ReoonProvider["verifyEmail"]>> & { checkedAt: string };
type PreviousReport = { results?: Array<{ email: string; reoon: CachedResult }> };

async function main() {
  const prisma = new PrismaClient();
  try {
    const source = await prisma.companyProspectContact.findMany({
      where: { verificationSource: "hunter", verifiedAt: { not: null } },
      orderBy: { verifiedAt: "desc" },
      distinct: ["email"],
      take: SAMPLE_LIMIT,
      select: { email: true, verificationState: true, verificationScore: true, verifiedAt: true },
    });
    if (!source.length) throw new Error("No Hunter-verified contacts found in the local database");

    const previous = readPrevious();
    const cached = new Map((previous.results ?? []).map((item) => [item.email, item.reoon]));
    const reoon = new ReoonProvider(process.env.REOON_API_KEY ?? "");
    const results = [];
    let apiRequests = 0;
    let credits = 0;
    let cacheHits = 0;

    for (const item of source) {
      const existing = cached.get(item.email);
      let result: CachedResult;
      if (existing && Date.now() - Date.parse(existing.checkedAt) < TTL_MS) {
        result = existing;
        cacheHits++;
      } else {
        const verified = await reoon.verifyEmail(item.email);
        result = { ...verified, checkedAt: new Date().toISOString() };
        apiRequests += verified.usage.requests;
        credits += verified.usage.credits;
      }
      results.push({
        email: item.email,
        hunter: { state: item.verificationState, score: item.verificationScore, checkedAt: item.verifiedAt?.toISOString() },
        reoon: result,
        agreement: agrees(item.verificationState, result.status),
      });
    }

    const comparable = results.filter((item) => item.hunter.state !== "UNKNOWN" && item.reoon.status !== "unknown");
    const report = {
      generatedAt: new Date().toISOString(),
      cachePolicyDays: 180,
      sample: { contacts: results.length, apiRequests, estimatedCredits: credits, cacheHits },
      metrics: {
        comparable: comparable.length,
        agreements: comparable.filter((item) => item.agreement).length,
        agreementRate: comparable.length ? comparable.filter((item) => item.agreement).length / comparable.length : null,
        reoonValid: results.filter((item) => item.reoon.status === "valid").length,
        reoonAcceptAll: results.filter((item) => item.reoon.status === "accept_all").length,
        reoonInvalid: results.filter((item) => item.reoon.status === "invalid").length,
        reoonUnknown: results.filter((item) => item.reoon.status === "unknown").length,
      },
      results,
    };
    fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ output: OUTPUT, ...report }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

function readPrevious(): PreviousReport {
  if (!fs.existsSync(OUTPUT)) return {};
  try { return JSON.parse(fs.readFileSync(OUTPUT, "utf8")) as PreviousReport; }
  catch { return {}; }
}

function agrees(hunter: string, reoon: string) {
  if (hunter === "VALID") return reoon === "valid";
  if (hunter === "ACCEPT_ALL") return reoon === "accept_all";
  if (hunter === "INVALID") return reoon === "invalid";
  if (hunter === "DISPOSABLE") return reoon === "disposable";
  return false;
}

main().catch((error) => { console.error(error); process.exit(1); });
