import "dotenv/config";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

function resolvePsql() {
  const configured = process.env.PSQL_BIN?.trim();
  if (configured) {
    if (!existsSync(configured)) throw new Error(`PSQL_BIN указывает на несуществующий файл: ${configured}`);
    return configured;
  }

  const lookup = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["psql"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const fromPath = lookup.status === 0 ? lookup.stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean) : undefined;
  if (fromPath) return fromPath;

  if (process.platform === "win32") {
    const root = join(process.env.ProgramFiles ?? "C:\\Program Files", "PostgreSQL");
    if (existsSync(root)) {
      const versions = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+)?$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => Number(b) - Number(a));
      for (const version of versions) {
        const candidate = join(root, version, "bin", "psql.exe");
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  throw new Error("psql не найден. Установите PostgreSQL client tools или задайте полный путь в PSQL_BIN.");
}

function parseDbUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

function psql(executable: string, sql: string, host: string, port: string, user: string, password: string) {
  execFileSync(executable, ["-h", host, "-p", port, "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: { ...process.env, PGPASSWORD: password },
    stdio: "inherit",
    windowsHide: true,
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
  let psqlExecutable: string;
  try {
    psqlExecutable = resolvePsql();
  } catch (err) {
    console.error(err instanceof Error ? err.message : "psql не найден");
    process.exit(1);
  }

  console.log(`→ Пересоздаю чистую БД "${SCRATCH_DB}"...`);
  try {
    psql(psqlExecutable, `DROP DATABASE IF EXISTS ${SCRATCH_DB}`, host, port, user, password);
    psql(psqlExecutable, `CREATE DATABASE ${SCRATCH_DB}`, host, port, user, password);
  } catch (err) {
    console.error("Не удалось создать тестовую БД:", err);
    process.exit(1);
  }

  console.log(`→ Прогоняю prisma migrate deploy на чистой схеме...`);
  let failed = false;
  try {
    const prismaCli = join(process.cwd(), "node_modules", "prisma", "build", "index.js");
    if (!existsSync(prismaCli)) throw new Error("Prisma CLI не найден. Выполните npm install.");
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: scratchUrl },
      stdio: "inherit",
      windowsHide: true,
    });
    console.log("\n✓ Все миграции применились на чистой БД без ошибок.");

    console.log("→ Сравниваю итоговую структуру БД с prisma/schema.prisma...");
    execFileSync(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "diff",
        "--from-url",
        scratchUrl,
        "--to-schema-datamodel",
        join(process.cwd(), "prisma", "schema.prisma"),
        "--exit-code",
      ],
      {
        env: { ...process.env, DATABASE_URL: scratchUrl },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    console.log("✓ Миграции и Prisma-схема синхронны.");
  } catch {
    failed = true;
    console.error("\n✗ Миграции не применяются на чистой БД или расходятся с Prisma-схемой.");
    console.error("  CI остановил бы развёртывание по той же причине.");
  }

  console.log(`→ Удаляю тестовую БД "${SCRATCH_DB}"...`);
  try {
    psql(psqlExecutable, `DROP DATABASE IF EXISTS ${SCRATCH_DB}`, host, port, user, password);
  } catch {
    console.warn(`  (не удалось удалить ${SCRATCH_DB} — удали вручную: dropdb ${SCRATCH_DB})`);
  }

  process.exit(failed ? 1 : 0);
}

main();
