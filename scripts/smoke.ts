/**
 * Smoke-тесты критичных чистых функций (без БД и сети).
 * Запуск: npm run smoke. Выполняются в CI перед сборкой.
 */
import assert from "node:assert";
import { PLANS, effectivePlan, isPlanActive, limitsFor } from "../src/lib/plans";
import { rateLimit } from "../src/lib/rateLimit";
import { renderSpintax, countVariants, hasSpintax, parseSpintax } from "../src/lib/uniqueness/spintax";
import { parseMailboxCsv } from "../src/lib/mail/csv";
import { calcInfraPlan } from "../src/lib/mail/planCalculator";
import { encryptSecret, decryptSecret } from "../src/lib/crypto";

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

// ── движок уникальности: spintax + переменные (M1.5, §5.9) ──
test("spintax: подставляет переменные и молча пропускает отсутствующие", () => {
  assert.equal(renderSpintax("Привет, {{name}} из {{company}}!", { name: "Пётр" }, "seed"), "Привет, Пётр из !");
  assert.equal(renderSpintax("без переменных", {}, "seed"), "без переменных");
});

test("spintax: детерминированный рендер (один seed -> один текст)", () => {
  const tpl = "{Привет|Здравствуйте|Добрый день}, {{name}}!";
  const a = renderSpintax(tpl, { name: "Иван" }, "contact-42");
  const b = renderSpintax(tpl, { name: "Иван" }, "contact-42");
  assert.equal(a, b);
  assert.ok(a.includes("Иван"));
});

test("spintax: разные seed -> достаточная вариативность", () => {
  const tpl = "{a|b|c|d|e}";
  const outputs = new Set(Array.from({ length: 30 }, (_, i) => renderSpintax(tpl, {}, `seed-${i}`)));
  assert.ok(outputs.size >= 3, `ожидалось >=3 уникальных вариантов, получено ${outputs.size}`);
});

test("spintax: вложенные альтернативы парсятся и рендерятся", () => {
  const tpl = "{привет|{добрый день|добрый вечер}}, {{name}}";
  const out = renderSpintax(tpl, { name: "Пётр" }, "x");
  assert.ok(/^(привет|добрый день|добрый вечер), Пётр$/.test(out), `неожиданный рендер: ${out}`);
});

test("spintax: countVariants считает произведение веток", () => {
  assert.equal(countVariants("{a|b} и {x|y|z}"), 6);
  assert.equal(countVariants("без альтернатив"), 1);
});

test("spintax: hasSpintax отличает шаблон с альтернативами от простого текста", () => {
  assert.equal(hasSpintax("{a|b}"), true);
  assert.equal(hasSpintax("просто текст {{name}}"), false);
});

test("spintax: parseSpintax строит дерево узлов", () => {
  const nodes = parseSpintax("привет {{name}}");
  assert.equal(nodes[0].t, "text");
  assert.equal(nodes[1].t, "var");
});

// ── CSV-парсер пула ящиков (§5.1) ──
test("mailbox CSV: парсит колонки email/Sender Name/SMTP/IMAP", () => {
  const csv = `email,Sender Name,SMTP-пароль,IMAP-пароль
i.ivanov@companytech.ru,Иван Иванов,smtp-pass-1,imap-pass-1
a.petrov@companytech.ru,Пётр Петров,smtp-pass-2,imap-pass-2`;
  const rows = parseMailboxCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].email, "i.ivanov@companytech.ru");
  assert.equal(rows[0].senderName, "Иван Иванов");
  assert.equal(rows[0].smtpPassword, "smtp-pass-1");
  assert.equal(rows[0].imapPassword, "imap-pass-1");
});

test("mailbox CSV: без колонки email возвращает пустой список", () => {
  assert.deepEqual(parseMailboxCsv("name,pass\nивана,123"), []);
});

test("mailbox CSV: пропускает строки без валидного email", () => {
  const csv = `email,Sender Name\nnot-an-email,Кто-то\nok@domain.ru,Ок`;
  const rows = parseMailboxCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, "ok@domain.ru");
});

// ── план-калькулятор инфраструктуры (§5.2) ──
test("план-калькулятор: соблюдает лимиты 30/ящик, 120/домен, 4 ящика/домен", () => {
  const plan = calcInfraPlan(10000, "Ромашка");
  const perMailboxDay = plan.perDayNeeded / plan.mailboxes;
  assert.ok(plan.mailboxesPerDomain <= 4, "не более 4 ящиков на домен");
  assert.ok(plan.mailboxes * 30 >= plan.perDayNeeded, "ящиков хватает на дневной объём при лимите 30/ящик");
  assert.ok(plan.domains * 120 >= plan.perDayNeeded, "доменов хватает на дневной объём при лимите 120/домен");
  assert.ok(perMailboxDay <= 30 + 1e-9);
});

test("план-калькулятор: маленький объём даёт минимум 1 домен и 1 ящик", () => {
  const plan = calcInfraPlan(50, "Тест");
  assert.equal(plan.domains, 1);
  assert.equal(plan.mailboxes, 1);
});

test("план-калькулятор: подсказки доменов не содержат цифр/дефисов", () => {
  const plan = calcInfraPlan(5000, "Ромашка");
  for (const d of plan.domainNameHints) {
    assert.ok(!/[0-9-]/.test(d), `домен "${d}" содержит цифры или дефис`);
  }
});

test("план-калькулятор: имя компании кириллицей транслитерируется в латиницу", () => {
  const plan = calcInfraPlan(5000, "Ромашка");
  for (const d of plan.domainNameHints) {
    assert.ok(/^[a-z.]+$/.test(d), `домен "${d}" должен быть латиницей (без punycode-кириллицы)`);
  }
});

// ── шифрование доступов к ящикам (§8.2) ──
test("crypto: encrypt/decrypt round-trip", () => {
  process.env.MAILBOX_ENC_KEY = "0".repeat(64); // тестовый ключ (32 байта hex)
  const secret = "app-password-super-secret";
  const enc = encryptSecret(secret);
  assert.notEqual(enc, secret);
  assert.ok(enc.startsWith("v1:"));
  assert.equal(decryptSecret(enc), secret);
});

test("crypto: разные вызовы дают разный ciphertext (случайный IV)", () => {
  process.env.MAILBOX_ENC_KEY = "0".repeat(64);
  const a = encryptSecret("same-secret");
  const b = encryptSecret("same-secret");
  assert.notEqual(a, b);
});

console.log(`\n${passed} тестов пройдено${process.exitCode ? ", ЕСТЬ ОШИБКИ" : ""}`);
