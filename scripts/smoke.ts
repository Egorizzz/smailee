/**
 * Smoke-тесты критичных чистых функций (без БД и сети).
 * Запуск: npm run smoke. Выполняются в CI перед сборкой.
 */
import assert from "node:assert";
import { PLANS, effectivePlan, isPlanActive, limitsFor } from "../src/lib/plans";
import { rateLimit } from "../src/lib/rateLimit";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}:`, e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}

// ── тарифы ──
test("PLANS: три плана с возрастающими лимитами", () => {
  assert.ok(PLANS.TRIAL.maxContacts < PLANS.START.maxContacts);
  assert.ok(PLANS.START.maxContacts < PLANS.PRO.maxContacts);
  assert.equal(PLANS.START.priceRub, 7999);
});

test("effectivePlan: TRIAL всегда активен", () => {
  assert.equal(effectivePlan("TRIAL", null), "TRIAL");
});

test("effectivePlan: активный START остаётся START", () => {
  const future = new Date(Date.now() + 24 * 3600 * 1000);
  assert.equal(effectivePlan("START", future), "START");
});

test("effectivePlan: истёкший PRO откатывается на TRIAL (автопереключение)", () => {
  const past = new Date(Date.now() - 24 * 3600 * 1000);
  assert.equal(effectivePlan("PRO", past), "TRIAL");
  assert.equal(limitsFor("PRO", past).maxContacts, PLANS.TRIAL.maxContacts);
});

test("isPlanActive: платный план без даты — неактивен", () => {
  assert.equal(isPlanActive("START", null), false);
});

// ── rate limiter ──
test("rateLimit: пропускает до лимита и блокирует сверх", () => {
  const key = `test-${Date.now()}`;
  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimit(key, { limit: 5, windowMs: 60_000 }), true);
  }
  assert.equal(rateLimit(key, { limit: 5, windowMs: 60_000 }), false);
});

test("rateLimit: разные ключи независимы", () => {
  const a = `a-${Date.now()}`;
  const b = `b-${Date.now()}`;
  assert.equal(rateLimit(a, { limit: 1 }), true);
  assert.equal(rateLimit(b, { limit: 1 }), true);
});

// ── подстановка переменных (как в sendEngine.render) ──
function render(template: string, vars: Record<string, string | null | undefined>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? "");
}
test("render: подставляет переменные и молча пропускает отсутствующие", () => {
  assert.equal(render("Привет, {{name}} из {{company}}!", { name: "Пётр" }), "Привет, Пётр из !");
  assert.equal(render("без переменных", {}), "без переменных");
});

console.log(`\n${passed} тестов пройдено${process.exitCode ? ", ЕСТЬ ОШИБКИ" : ""}`);
