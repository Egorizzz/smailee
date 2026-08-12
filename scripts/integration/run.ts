import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { FakeSmtp } from "./fakeSmtp";
import type { FakeBitrix } from "./fakeBitrix";

/**
 * Точка входа интеграционных тестов: `npm run test:integration`.
 *
 * Зачем они есть. Smoke-тесты покрывают только чистые функции, а CI — миграции
 * и сборку. Логика движков (лимиты отправки, ramp прогрева, скоринг флота,
 * сроки тарифов) живёт в накопленном состоянии БД, и два реальных бага прогрева
 * (9f5f155, bf36866) прошли мимо всех проверок именно поэтому.
 *
 * Как устроено. Тесты идут в ОТДЕЛЬНУЮ базу (…_test), а не в smailee_dev:
 * они чистят таблицы между кейсами, и рабочие данные им доверять нельзя.
 * Схема накатывается через `prisma migrate deploy` — он же и создаёт базу,
 * если её нет, поэтому psql в PATH не нужен (в отличие от db:migration-check).
 *
 * Порядок важен: DATABASE_URL подменяется ДО первого импорта чего-либо, что
 * тянет @/lib/prisma, поэтому все тестовые модули грузятся динамически.
 *
 * Два прогона одновременно запускать нельзя: база одна на прогон, и очистка
 * между кейсами снесёт данные соседнего процесса — получится каша из падений
 * без внятной причины. Для pre-push и CI это не проблема (там строго один
 * прогон), но при ручном запуске стоит дождаться конца предыдущего.
 */

const TEST_DB_NAME = "smailee_test";
// Фиксированный ключ шифрования для тестов: к проду отношения не имеет,
// нужен только чтобы encryptSecret/decryptSecret отработали на фикстурах.
const TEST_ENC_KEY = "0".repeat(64);

/** Минимальный разбор .env — dotenv в проде не нужен, тащить его сюда незачем. */
function loadDotEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue; // окружение важнее файла
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/**
 * URL тестовой БД: берём рабочий и подменяем имя базы. Явный TEST_DATABASE_URL
 * перекрывает эту логику (например, если тестовый Postgres — вообще другой).
 */
function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  if (explicit) return explicit;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      "Не задан ни TEST_DATABASE_URL, ни DATABASE_URL — неоткуда взять параметры подключения."
    );
  }
  const url = new URL(base);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

/** Страховка от запуска по рабочей базе: тесты стирают данные. */
function assertLooksLikeTestDb(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) {
    throw new Error(
      `Отказываюсь работать с базой «${name}»: интеграционные тесты чистят таблицы, ` +
        `в имени базы должно быть «test». Проверь TEST_DATABASE_URL.`
    );
  }
}

async function main() {
  loadDotEnv();

  const databaseUrl = resolveTestDatabaseUrl();
  assertLooksLikeTestDb(databaseUrl);

  // Подмена окружения ДО динамических импортов движков и harness.
  process.env.DATABASE_URL = databaseUrl;
  process.env.MAILBOX_ENC_KEY = TEST_ENC_KEY;
  // троттлинг отправки в тестах не нужен — он только замедляет прогон
  process.env.SEND_THROTTLE_MS = "0";
  process.env.WARMUP_THROTTLE_MS = "0";
  // Окно отправки (§5.3) по умолчанию выключено: большинство тестов проверяют
  // ДРУГУЮ логику и не должны случайно падать ночью/в выходные на машине, где
  // идёт прогон. Тесты самого окна передают SendWindow явным аргументом в
  // processCampaign/processWarmupSendRound — это не зависит от этой переменной.
  process.env.SEND_WINDOW_ENABLED = "false";
  // Внешние сервисы — строго в mock-режим: без ключей адаптеры отдают
  // детерминированные ответы и не ходят в сеть. Иначе прогон тестов лез бы в
  // платный DeepSeek и зависел от его доступности (а pre-push — от интернета).
  //
  // Именно пустая строка, а не delete: PrismaClient при инициализации сам
  // подгружает .env, и удалённая переменная возвращается обратно — тесты тихо
  // начинают ходить в живой API. Уже заданное значение dotenv не перезаписывает,
  // а Boolean("") === false, то есть адаптеры видят «ключа нет».
  process.env.DEEPSEEK_API_KEY = "";
  process.env.ANTHROPIC_API_KEY = "";
  process.env.LLM_TEST_MOCKS = "true";
  process.env.BITRIX24_WEBHOOK_URL = "";
  process.env.ADMIN_EMAIL = "service-admin@test.local";

  const shownUrl = databaseUrl.replace(/\/\/[^@]*@/, "//***@");
  console.log(`Интеграционные тесты, база: ${shownUrl}`);

  try {
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    console.error("Не удалось накатить схему на тестовую базу:");
    console.error(e.stdout?.toString() ?? "");
    console.error(e.stderr?.toString() ?? "");
    console.error(
      "\nПроверь, что Postgres запущен и DATABASE_URL в .env указывает на рабочий кластер."
    );
    process.exit(1);
  }

  const { prisma, report, resetDb } = await import("./harness");
  const { startFakeSmtp } = await import("./fakeSmtp");
  const { startFakeBitrix } = await import("./fakeBitrix");

  const smtp = await startFakeSmtp();
  const bitrix = await startFakeBitrix();
  let exitCode = 1;
  try {
    // наборы, которым фейковые сервисы не нужны, просто игнорируют аргументы
    const suites: ((smtp: FakeSmtp, bitrix: FakeBitrix) => Promise<void>)[] = [
      (await import("./tests/sendEngine")).default,
      (await import("./tests/warmup")).default,
      (await import("./tests/inbound")).default,
      (await import("./tests/fleetHealth")).default,
      (await import("./tests/billing")).default,
      (await import("./tests/accounts")).default,
      (await import("./tests/limits")).default,
    ];
    for (const suite of suites) await suite(smtp, bitrix);
    exitCode = report();
  } finally {
    await smtp.close();
    await bitrix.close();
    await resetDb().catch(() => {});
    await prisma.$disconnect();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
