import "dotenv/config";
import { execSync } from "node:child_process";

/**
 * Проверка миграций на ЧИСТОЙ базе — та же идея, что и шаг в ci.yml, но
 * локально, до пуша. Ловит именно тот класс багов, который не видно на
 * рабочей локальной БД (она могла накопить констрейнты/данные, которых на
 * проде нет): например, `ON CONFLICT (a, b)` в миграции при отсутствии
 * уникального констрейнта на (a, b) — работает локально, падает на чистой
 * схеме прод.
 *
 * Использование: npm run db:migration-check
 * (не входит в обычный `npm run check` / pre-push — гоняется вручную перед
 * пушем, если менял prisma/schema.prisma или добавлял миграцию: полный цикл
 * дольше, чем обычный пуш без изменений схемы).
 */

const SCRATCH_DB = "smailee_migration_check";

function parseDbUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

function psql(sql: string, host: string, port: string, user: string, password: string) {
  execSync(`psql -h ${host} -p ${port} -U ${user} -d postgres -c "${sql}"`, {
    env: { ...process.env, PGPASSWORD: password },
    stdio: "inherit",
  });
}

async function main() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    console.error("DATABASE_URL не задан в .env");
    process.exit(1);
  }
  const { host, port, user, password } = parseDbUrl(rawUrl);
  const scratchUrl = `postgresql://${user}:${password}@${host}:${port}/${SCRATCH_DB}`;

  console.log(`→ Пересоздаю чистую БД "${SCRATCH_DB}"...`);
  try {
    psql(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`, host, port, user, password);
    psql(`CREATE DATABASE ${SCRATCH_DB}`, host, port, user, password);
  } catch (err) {
    console.error("Не удалось создать тестовую БД:", err);
    process.exit(1);
  }

  console.log(`→ Прогоняю prisma migrate deploy на чистой схеме...`);
  let failed = false;
  try {
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: scratchUrl },
      stdio: "inherit",
    });
    console.log("\n✓ Все миграции применились на чистой БД без ошибок.");
  } catch {
    failed = true;
    console.error("\n✗ Миграция упала на чистой схеме — на проде будет то же самое.");
    console.error("  Именно это словил бы ci.yml, но теперь ты видишь это ДО пуша.");
  }

  console.log(`→ Удаляю тестовую БД "${SCRATCH_DB}"...`);
  try {
    psql(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`, host, port, user, password);
  } catch {
    console.warn(`  (не удалось удалить ${SCRATCH_DB} — удали вручную: dropdb ${SCRATCH_DB})`);
  }

  process.exit(failed ? 1 : 0);
}

main();
