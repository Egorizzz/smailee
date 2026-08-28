import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { HunterProvider } from "../src/lib/company-data";

loadEnvConfig(process.cwd());

type SourceRow = {
  selector: string; segment: string; inn?: string; name?: string; status?: string; domain?: string;
  leader?: string; sourceEmails: string[];
};

const report = JSON.parse(fs.readFileSync(path.resolve("company-data-quality-study.json"), "utf8")) as { rows: SourceRow[] };
const candidates = report.rows.filter((row) => row.selector === "datanewton" && row.status === "Действует" && row.domain && row.leader);
const hunter = new HunterProvider(process.env.HUNTER_API_KEY ?? "");

function titleCase(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/(^|[-\s])\p{L}/gu, (letter) => letter.toLocaleUpperCase("ru-RU"));
}
function parseName(fio: string) {
  const parts = fio.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return undefined;
  return { lastName: titleCase(parts[0]), firstName: titleCase(parts[1]) };
}
const translitMap: Record<string, string> = {
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
};
function transliterate(value: string) {
  return value.toLocaleLowerCase("ru-RU").split("").map((letter) => translitMap[letter] ?? letter).join("")
    .replace(/(^|[-\s])\p{L}/gu, (letter) => letter.toUpperCase());
}

type Attempt = { firstName: string; lastName: string; found: boolean; error?: string };

async function main() {
const results = [];
let requests = 0;
let credits = 0;
for (const candidate of candidates) {
  const name = parseName(candidate.leader!);
  if (!name) continue;
  const attempts: Attempt[] = [];
  let found;
  for (const variant of [name, { firstName: transliterate(name.firstName), lastName: transliterate(name.lastName) }]) {
    if (attempts.some((item) => item.firstName === variant.firstName && item.lastName === variant.lastName)) continue;
    try {
      const result = await hunter.findPerson({ domain: candidate.domain!, ...variant });
      requests += result.usage.requests; credits += result.usage.credits;
      attempts.push({ ...variant, found: Boolean(result.email) });
      if (result.email) { found = result; break; }
    } catch (error) {
      requests++;
      attempts.push({ ...variant, found: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  results.push({
    segment: candidate.segment, inn: candidate.inn, company: candidate.name, domain: candidate.domain,
    leader: candidate.leader, attempts, result: found,
    alreadyInDataNewton: Boolean(found?.email && candidate.sourceEmails.includes(found.email)),
  });
}

const found = results.filter((item) => item.result?.email);
const output = {
  generatedAt: new Date().toISOString(), methodology: "DataNewton legal manager + canonical domain; Cyrillic then transliteration; no website parsing",
  sample: { eligible: candidates.length, processed: results.length, requests, estimatedCredits: credits },
  metrics: {
    found: found.length,
    hitRate: results.length ? found.length / results.length : 0,
    incrementalToDataNewton: found.filter((item) => !item.alreadyInDataNewton).length,
    alreadyKnown: found.filter((item) => item.alreadyInDataNewton).length,
    averageScore: found.length ? found.reduce((sum, item) => sum + (item.result?.score ?? 0), 0) / found.length : 0,
    verified: found.filter((item) => item.result?.verificationStatus === "valid").length,
    withPosition: found.filter((item) => item.result?.position).length,
    cyrillicHits: found.filter((item) => item.attempts[0]?.found).length,
    transliterationHits: found.filter((item) => !item.attempts[0]?.found && item.attempts[1]?.found).length,
  },
  results,
};
fs.writeFileSync(path.resolve("lpr-quality-study.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ output: path.resolve("lpr-quality-study.json"), ...output }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
