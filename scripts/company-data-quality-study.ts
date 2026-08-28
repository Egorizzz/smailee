import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { CheckoProvider, DataNewtonProvider, HunterProvider, type ProviderCompany } from "../src/lib/company-data";

loadEnvConfig(process.cwd());

const SAMPLE_PER_PROVIDER = 3;
const segments = [
  { key: "it_moscow", label: "ИТ · Москва", okved: "62.01", region: "77" },
  { key: "advertising_moscow", label: "Реклама · Москва", okved: "73.11", region: "77" },
  { key: "manufacturing_sverdlovsk", label: "Металлоконструкции · Свердловская область", okved: "25.11", region: "66" },
];

type StudyRow = {
  selector: "checko" | "datanewton";
  segment: string;
  inn?: string;
  name?: string;
  status?: string;
  region?: string;
  okved?: string;
  domain?: string;
  sourceEmails: string[];
  alignedSourceEmails: string[];
  leader?: string;
  employees?: number;
  revenue?: number;
  availableFields: number;
  hunterEmails: Array<{ email: string; confidence?: number; type?: string; position?: string }>;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function numeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
}
function domainOf(value?: string) {
  if (!value) return undefined;
  try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return undefined; }
}
function emailDomain(email: string) { return email.toLowerCase().split("@")[1]; }
function aligned(email: string, domain?: string) {
  const candidate = emailDomain(email);
  return Boolean(candidate && domain && (candidate === domain || candidate.endsWith(`.${domain}`) || domain.endsWith(`.${candidate}`)));
}
function rowFrom(selector: StudyRow["selector"], segment: string, item: ProviderCompany): StudyRow {
  const domain = domainOf(item.identity?.domain ?? item.website);
  const sourceEmails = [...new Set(strings(item.fields?.company_emails).map((email) => email.toLowerCase()))];
  return {
    selector, segment, inn: item.identity?.inn, name: item.displayName ?? item.legalName, status: item.status,
    region: typeof item.fields?.region === "string" ? item.fields.region : undefined,
    okved: typeof item.fields?.primary_okved === "string" ? item.fields.primary_okved : undefined,
    domain, sourceEmails, alignedSourceEmails: sourceEmails.filter((email) => aligned(email, domain)),
    leader: typeof item.fields?.leader_name === "string" ? item.fields.leader_name : undefined,
    employees: numeric(item.fields?.employee_count), revenue: numeric(item.fields?.revenue),
    availableFields: Object.values(item.fields ?? {}).filter((value) => value !== null && value !== "" && (!Array.isArray(value) || value.length)).length,
    hunterEmails: [],
  };
}

function summarize(rows: StudyRow[]) {
  const emails = rows.flatMap((row) => row.sourceEmails);
  const alignedEmails = rows.flatMap((row) => row.alignedSourceEmails);
  const hunter = rows.flatMap((row) => row.hunterEmails);
  const completenessFields: Array<keyof StudyRow> = ["inn", "name", "status", "region", "okved", "domain", "leader", "employees", "revenue"];
  return {
    companies: rows.length,
    withDomain: rows.filter((row) => row.domain).length,
    withSourceEmail: rows.filter((row) => row.sourceEmails.length).length,
    sourceEmails: new Set(emails).size,
    alignedSourceEmails: new Set(alignedEmails).size,
    sourceEmailDomainAlignment: emails.length ? alignedEmails.length / emails.length : 0,
    withHunterEmail: rows.filter((row) => row.hunterEmails.length).length,
    hunterEmails: new Set(hunter.map((item) => item.email)).size,
    hunterIncrementalEmails: new Set(hunter.filter((item) => !emails.includes(item.email)).map((item) => item.email)).size,
    hunterPersonalEmails: hunter.filter((item) => item.type === "personal").length,
    averageHunterConfidence: hunter.length ? hunter.reduce((sum, item) => sum + (item.confidence ?? 0), 0) / hunter.length : 0,
    canonicalFieldCompleteness: rows.length ? rows.reduce((sum, row) => sum + completenessFields.filter((field) => row[field] !== undefined).length, 0) / (rows.length * completenessFields.length) : 0,
    averageAvailableFields: rows.length ? rows.reduce((sum, row) => sum + row.availableFields, 0) / rows.length : 0,
  };
}

async function main() {
  const reuseChecko = process.env.STUDY_REUSE_CHECKO === "true";
  const previous = reuseChecko && fs.existsSync(path.resolve("company-data-quality-study.json"))
    ? JSON.parse(fs.readFileSync(path.resolve("company-data-quality-study.json"), "utf8")) as { rows: StudyRow[] }
    : undefined;
  const checko = new CheckoProvider(process.env.CHECKO_API_KEY ?? "");
  const datanewton = new DataNewtonProvider({
    apiKey: process.env.DATANEWTON_API_KEY ?? "", baseUrl: process.env.DATANEWTON_BASE_URL ?? "https://api.datanewton.ru",
    searchPath: process.env.DATANEWTON_SEARCH_PATH ?? "/v1/batchCardsByFilters", authMode: "query",
  });
  const rows: StudyRow[] = previous?.rows.filter((row) => row.selector === "checko") ?? [];
  for (const segment of segments) {
    const checkoPage = reuseChecko ? undefined : await checko.search({ by: "okved", query: segment.okved, obj: "org", active: true, region: segment.region, limit: SAMPLE_PER_PROVIDER });
    const dnPage = await datanewton.search({
      okveds: [segment.okved], region_codes: [segment.region], only_active: true,
      only_with_websites: true, only_with_emails: true, contact_conditions_operator: "AND",
      limit: SAMPLE_PER_PROVIDER,
    });
    if (checkoPage) rows.push(...checkoPage.items.map((item) => rowFrom("checko", segment.key, item)));
    rows.push(...dnPage.items.map((item) => rowFrom("datanewton", segment.key, item)));
  }
  const domains = [...new Set(rows.filter((row) => !reuseChecko || row.selector === "datanewton").map((row) => row.domain).filter((value): value is string => Boolean(value)))];
  const hunter = new HunterProvider(process.env.HUNTER_API_KEY ?? "");
  const hunterPage = await hunter.search({ domains, limitPerDomain: 1 });
  const hunterByDomain = new Map(hunterPage.items.map((item) => {
    const details = item.fields?.hunter_emails;
    const contacts = Array.isArray(details) ? details.flatMap((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.email === "string" ? [{
      email: entry.email.toLowerCase(), confidence: numeric(entry.confidence),
      type: typeof entry.type === "string" ? entry.type : undefined,
      position: typeof entry.position === "string" ? entry.position : undefined,
    }] : []) : [];
    return [domainOf(item.identity?.domain), contacts] as const;
  }));
  for (const row of rows) if (!reuseChecko || row.selector === "datanewton") row.hunterEmails = row.domain ? hunterByDomain.get(row.domain) ?? [] : [];
  const byProvider = Object.fromEntries((["checko", "datanewton"] as const).map((provider) => [provider, summarize(rows.filter((row) => row.selector === provider))]));
  const bySegment = Object.fromEntries(segments.map((segment) => [segment.key, Object.fromEntries((["checko", "datanewton"] as const).map((provider) => [provider, summarize(rows.filter((row) => row.selector === provider && row.segment === segment.key))]))]));
  const overlap = Object.fromEntries(segments.map((segment) => {
    const a = new Set(rows.filter((row) => row.segment === segment.key && row.selector === "checko").map((row) => row.inn));
    const b = new Set(rows.filter((row) => row.segment === segment.key && row.selector === "datanewton").map((row) => row.inn));
    return [segment.key, [...a].filter((inn) => b.has(inn)).length];
  }));
  const report = {
    generatedAt: new Date().toISOString(), samplePerProvider: SAMPLE_PER_PROVIDER, segments,
    usage: { checkoRequestsEstimated: reuseChecko ? 0 : segments.length * (SAMPLE_PER_PROVIDER + 1), dataNewtonRecords: segments.length * SAMPLE_PER_PROVIDER, hunter: hunterPage.usage, uniqueHunterDomains: domains.length },
    byProvider, bySegment, overlap, rows,
  };
  const output = path.resolve("company-data-quality-study.json");
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output, usage: report.usage, byProvider, bySegment, overlap }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
