import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

type Case = {
  name: string;
  description?: string;
  expectedCodes: string[];
  expectedRegions?: string[];
};

const genericSellerProfile = {
  summary: "Smailee помогает B2B-компаниям улучшать продажи и коммуникации.",
  targetAudiences: ["Руководители и команды B2B-компаний"],
  offers: ["Поиск лидов и автоматизация коммуникаций"],
};

const cases: Case[] = [
  { name: "общий профиль продавца не задаёт отрасль получателя", expectedCodes: [] },
  { name: "юридические компании Москвы", description: "Небольшие юридические компании Москвы, которые работают с бизнесом", expectedCodes: ["69.10"], expectedRegions: ["77"] },
  { name: "частные стоматологии", description: "Частные стоматологические клиники в Санкт-Петербурге", expectedCodes: ["86.23"], expectedRegions: ["78"] },
  { name: "производители металлических дверей", description: "Российские производители металлических дверей", expectedCodes: ["25.12"] },
  { name: "грузоперевозчики", description: "Компании, которые занимаются автомобильными грузоперевозками", expectedCodes: ["49.41"] },
];

async function main() {
  const { suggestProspectingFilters } = await import("../src/lib/services/deepseek");
  let passed = 0;
  for (const testCase of cases) {
    const result = await suggestProspectingFilters({
      description: testCase.description,
      profile: genericSellerProfile,
      exclusions: [],
    });
    const codes = result.okveds.map((item) => item.code);
    const codeMatch = testCase.expectedCodes.length === 0
      ? codes.length === 0
      : testCase.expectedCodes.some((expected) => codes.includes(expected));
    const regionMatch = !testCase.expectedRegions?.length
      || testCase.expectedRegions.every((expected) => result.regions.includes(expected));
    const ok = codeMatch && regionMatch;
    if (ok) passed++;
    console.log(JSON.stringify({
      case: testCase.name,
      ok,
      expectedCodes: testCase.expectedCodes,
      actualCodes: codes,
      expectedRegions: testCase.expectedRegions ?? [],
      actualRegions: result.regions,
      summary: result.summary,
    }, null, 2));
  }
  console.log(`OKVED quality: ${passed}/${cases.length}`);
  if (passed !== cases.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
