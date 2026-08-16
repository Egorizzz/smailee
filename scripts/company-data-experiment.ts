import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const [configPath, outArg] = process.argv.slice(2);
  if (!configPath) throw new Error("Usage: npm run data:test -- <config.json> [output.json]");
  const config = JSON.parse(fs.readFileSync(path.resolve(configPath), "utf8")) as {
    checko?: Record<string, unknown>;
    datanewton?: Record<string, unknown>;
    hunterLimitPerDomain?: number;
  };
  if (!config.checko && !config.datanewton) throw new Error("Config must contain checko and/or datanewton query");
  const { prisma } = await import("../src/lib/prisma");
  const {
    checkoFromEnv, dataNewtonFromEnv, hunterFromEnv, runProviderExperiment,
  } = await import("../src/lib/company-data");
  const hunter = hunterFromEnv();
  const results = [];
  try {
    if (config.checko) results.push(await runProviderExperiment({
      prisma, companyProvider: checkoFromEnv(), hunterProvider: hunter,
      query: config.checko as never, hunterLimitPerDomain: config.hunterLimitPerDomain,
    }));
    if (config.datanewton) results.push(await runProviderExperiment({
      prisma, companyProvider: dataNewtonFromEnv(), hunterProvider: hunter,
      query: config.datanewton as never, hunterLimitPerDomain: config.hunterLimitPerDomain,
    }));
    const report = { generatedAt: new Date().toISOString(), results };
    const output = path.resolve(outArg ?? `company-data-comparison-${Date.now()}.json`);
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Saved ${results.length} pipeline result(s) to ${output}`);
    for (const result of results) console.log(result.provider, result.summary, result.usage);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
