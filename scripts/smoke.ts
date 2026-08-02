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
import { parseReplyBody, htmlToText, looksLikeHtml } from "../src/lib/mail/quotedText";
import { wrapInBrandShell, brandForUser, fontStack } from "../src/lib/mail/brandShell";
import { parseDelimited, guessMapping, applyMapping } from "../src/lib/contacts/tableParse";
import { classifySmtpError } from "../src/lib/mail/transport";
import { classifyImapError, describeImapError } from "../src/lib/mail/imap";
import { normalizePlaceholders, tidyAfterSubstitution } from "../src/lib/mail/placeholders";
import { parseSegmentTexts } from "../src/lib/campaigns/segmentTexts";
import { parseFollowupSteps, MAX_FOLLOWUP_STEPS } from "../src/lib/campaigns/followupSteps";
import {
  sanitizeTriggerKeys,
  describeTriggersForPrompt,
  buildHandoffContext,
  triggerLabel,
  DEFAULT_HANDOFF_TRIGGERS,
  CUSTOM_TRIGGER_KEY,
  MANUAL_TRIGGER_KEY,
} from "../src/lib/crm/handoffTriggers";
import { sanitizeEmailVariants } from "../src/lib/services/emailVariants";
import { plainTextToHtml } from "../src/lib/mail/textToHtml";
import { warmupDailyTarget, unlockedWarmupTarget } from "../src/server/warmupEngine";
import { config } from "../src/lib/config";
import { isWithinSendWindow, sendWindowProgress } from "../src/lib/schedule";
import { countContentLinks } from "../src/lib/mail/linkCheck";

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

// ── разбор входящего письма для треда ──
test("письмо: цитата Яндекса отрезается от свежего ответа", () => {
  const raw = [
    "Да, интересно. Сколько стоит?",
    "",
    "19.07.2026, 12:30, Иван Иванов <i@x.ru> пишет:",
    "> Здравствуйте! Предлагаем услуги.",
    "> —",
    "> Отписаться от рассылки: https://x.ru/u/1",
  ].join("\n");
  const { visible, quoted } = parseReplyBody(raw);
  assert.equal(visible, "Да, интересно. Сколько стоит?");
  assert.ok(quoted.includes("Предлагаем услуги"), "цитата должна сохраниться");
});

test("письмо: цитата Gmail (On ... wrote:) отрезается", () => {
  const raw = "Спасибо, не надо.\n\nOn Mon, Jul 19, 2026 at 12:00, Ivan <i@x.ru> wrote:\n> Hello";
  assert.equal(parseReplyBody(raw).visible, "Спасибо, не надо.");
});

test("письмо: блок '>' без текстового маркера тоже считается цитатой", () => {
  const { visible, quoted } = parseReplyBody("Ок, давайте созвонимся\n\n> старое письмо\n> ещё строка");
  assert.equal(visible, "Ок, давайте созвонимся");
  assert.ok(quoted.includes("старое письмо"));
});

test("письмо: без цитаты возвращается целиком, quoted пуст", () => {
  const { visible, quoted } = parseReplyBody("Коротко: да, актуально.");
  assert.equal(visible, "Коротко: да, актуально.");
  assert.equal(quoted, "");
});

test("письмо: HTML приводится к тексту (теги и стили не попадают в тред)", () => {
  const raw = "<html><head><style>.a{color:red}</style></head><body><p>Привет</p><p>Как дела?</p></body></html>";
  assert.ok(looksLikeHtml(raw));
  const { visible } = parseReplyBody(raw);
  assert.ok(!visible.includes("<"), "теги не должны остаться");
  assert.ok(!visible.includes("color:red"), "CSS не должен попасть в текст");
  assert.ok(visible.includes("Привет") && visible.includes("Как дела?"));
});

test("письмо: htmlToText разворачивает <br> и сущности", () => {
  assert.equal(htmlToText("A&nbsp;&amp;&nbsp;B<br>C"), "A & B\nC");
});

test("письмо: маркер в самой первой строке не съедает всё письмо", () => {
  // если резать здесь, оператор увидит пустоту — показываем целиком
  const { visible } = parseReplyBody("> только цитата, своего текста нет");
  assert.ok(visible.length > 0);
});

// ── фирменный каркас письма ──
test("каркас: без настроек письмо нейтральное, БЕЗ цветов и лого Smailee", () => {
  const html = wrapInBrandShell("Привет", {});
  assert.ok(!/#22a88d/i.test(html), "не должно быть фирменного изумруда Smailee");
  assert.ok(!/smailee/i.test(html), "на платном тарифе упоминаний Smailee быть не должно");
  assert.ok(!/Ваша компания/.test(html), "не выдумываем название компании в шапке");
});

test("каркас: бесплатный тариф получает обязательную плашку Smailee", () => {
  const brand = brandForUser({ plan: "TRIAL", companyName: "Ромашка" });
  assert.equal(brand.poweredBy, true);
  assert.ok(/Отправлено с помощью сервиса рассылок Smailee/.test(wrapInBrandShell("Привет", brand)));
});

test("каркас: на платном тарифе плашки Smailee нет", () => {
  const brand = brandForUser({ plan: "START", companyName: "Ромашка" });
  assert.equal(brand.poweredBy, false);
  assert.ok(!/Smailee/.test(wrapInBrandShell("Привет", brand)));
});

test("каркас: подпись и логотип клиента попадают в письмо", () => {
  const html = wrapInBrandShell("Текст", {
    logoUrl: "https://x.ru/logo.png",
    signature: "Иван Иванов\nДиректор",
    color: "#ff0000",
  });
  assert.ok(html.includes("https://x.ru/logo.png"));
  assert.ok(html.includes("Иван Иванов<br>Директор"));
  assert.ok(html.includes("#ff0000"));
});

test("каркас: шрифт берётся только из белого списка (без инъекции CSS)", () => {
  assert.ok(fontStack("georgia").startsWith("Georgia"));
  // произвольное значение не должно протечь в стиль письма
  assert.equal(fontStack("}}}<script>"), fontStack("system"));
});

test("каркас: HTML-спецсимволы в подписи экранируются", () => {
  const html = wrapInBrandShell("Текст", { signature: "<script>alert(1)</script>" });
  assert.ok(!html.includes("<script>alert"), "тег не должен попасть в письмо сырым");
});

// ── импорт базы контактов ──
test("импорт: кавычки и запятые внутри значений не ломают разбор", () => {
  const csv = 'email,company\ni@x.ru,"ООО ""Ромашка"", Плюс"';
  const t = parseDelimited(csv);
  assert.deepEqual(t.headers, ["email", "company"]);
  assert.equal(t.rows[0][1], 'ООО "Ромашка", Плюс');
});

test("импорт: определяет разделитель (;, таб) и убирает BOM", () => {
  assert.deepEqual(parseDelimited("﻿email;имя\ni@x.ru;Пётр").headers, ["email", "имя"]);
  assert.deepEqual(parseDelimited("email\tимя\ni@x.ru\tПётр").headers, ["email", "имя"]);
});

test("импорт: маппинг по нестандартным названиям колонок", () => {
  const t = parseDelimited("Почта;Контактное лицо;Организация;Ниша\ni@x.ru;Пётр;Ромашка;Юристы");
  assert.deepEqual(guessMapping(t), ["email", "name", "company", "segment"]);
});

test("импорт: email находится по содержимому, если колонка названа непонятно", () => {
  const t = parseDelimited("col1,col2\nПётр,i@x.ru\nИван,a@y.ru");
  assert.deepEqual(guessMapping(t), ["skip", "email"]);
});

test("импорт: строки без валидного email и дубли отбрасываются", () => {
  const t = parseDelimited("email,имя\ni@x.ru,Пётр\nне-почта,Иван\ni@x.ru,Дубль\na@y.ru,Аня");
  const rows = applyMapping(t, guessMapping(t));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.email), ["i@x.ru", "a@y.ru"]);
});

test("импорт: без колонки email результат пустой (нечего слать)", () => {
  const t = parseDelimited("имя,компания\nПётр,Ромашка");
  assert.deepEqual(applyMapping(t, guessMapping(t)), []);
});

// ── Разбор ответа ИИ на запрос вариантов письма ──
// Регрессия на реальный случай 2026-08-01: DeepSeek вернул 2 объекта, но
// каждый — с лишним полем body_alt (похоже, спутал "N вариантов" с
// "вариант плюс альтернативная формулировка внутри"). Раньше код доверял
// форме ответа целиком (`if (Array.isArray(parsed)) return parsed`) — лишнее
// поле долетало до конца молча, то есть половина оплаченной генерации
// терялась без единого следа.

test("варианты письма: лишние поля модели отбрасываются, subject/body остаются", () => {
  // ровно то, что реально вернул DeepSeek — сокращено до сути
  const raw = [
    { subject: "Тема 1", body: "Текст 1", body_alt: "Альтернативный текст 1" },
    { subject: "Тема 2", body: "Текст 2", body_alt: "Альтернативный текст 2" },
  ];
  const out = sanitizeEmailVariants(raw);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { subject: "Тема 1", body: "Текст 1" });
  assert.ok(!("body_alt" in out[0]), "лишнее поле не просочилось дальше");
});

test("варианты письма: элемент без body отбрасывается, остальные выживают", () => {
  const out = sanitizeEmailVariants([
    { subject: "Норм", body: "Текст" },
    { subject: "Без текста" }, // модель забыла body
    { subject: "", body: "Пустая тема" }, // пустая строка — тоже брак
  ]);
  assert.equal(out.length, 1, "битые элементы не должны портить рабочие");
  assert.equal(out[0].subject, "Норм");
});

test("варианты письма: неверные типы полей отбрасываются, а не падают исключением", () => {
  const out = sanitizeEmailVariants([
    { subject: "Норм", body: "Текст" },
    { subject: 123, body: "Число вместо строки" },
    { subject: "Тема", body: null },
    "просто строка вместо объекта",
    null,
  ]);
  assert.equal(out.length, 1);
});

test("варианты письма: не массив — пустой результат, а не исключение", () => {
  assert.deepEqual(sanitizeEmailVariants({ subject: "не массив" }), []);
  assert.deepEqual(sanitizeEmailVariants(null), []);
  assert.deepEqual(sanitizeEmailVariants("текст"), []);
});

// ── Плейсхолдеры персонализации (§5.9) ──
// Регрессия на реальный инцидент 2026-07-29: ИИ сгенерировал письмо с «{Имя}»,
// одиночные скобки в нашем синтаксисе означают spintax-альтернативу, и в
// письмо реальному получателю ушло слово «Имя» вместо имени.

test("плейсхолдеры: выдуманные ИИ обозначения приводятся к каноническим", () => {
  assert.equal(normalizePlaceholders("Здравствуйте, {Имя}!"), "Здравствуйте, {{name}}!");
  assert.equal(normalizePlaceholders("Привет, [Name]"), "Привет, {{name}}");
  assert.equal(normalizePlaceholders("для %company%"), "для {{company}}");
  assert.equal(normalizePlaceholders("в {{Компания}}"), "в {{company}}");
});

test("плейсхолдеры: канонический вид не портится повторной нормализацией", () => {
  const once = normalizePlaceholders("Здравствуйте, {Имя} из {Компания}!");
  assert.equal(once, "Здравствуйте, {{name}} из {{company}}!");
  assert.equal(normalizePlaceholders(once), once, "функция идемпотентна");
});

test("плейсхолдеры: spintax-альтернативы не трогаем", () => {
  const spintax = "{Привет|Здравствуйте}, {Имя}!";
  // группа с вертикальной чертой — это разметка вариантов, а не переменная
  assert.equal(normalizePlaceholders(spintax), "{Привет|Здравствуйте}, {{name}}!");
});

test("плейсхолдеры: незнакомое слово в скобках остаётся как было", () => {
  assert.equal(normalizePlaceholders("скидка [до 31 мая]"), "скидка [до 31 мая]");
  assert.equal(normalizePlaceholders("{неизвестно}"), "{неизвестно}");
});

test("плейсхолдеры: после нормализации подстановка реально срабатывает", () => {
  // сквозная проверка: то, что вернул ИИ → нормализация → рендер письма
  const fromAi = "Здравствуйте, {Имя}! Вижу, что {Компания} растёт.";
  const rendered = renderSpintax(normalizePlaceholders(fromAi), {
    name: "Пётр",
    company: "Ромашка",
  });
  assert.equal(rendered, "Здравствуйте, Пётр! Вижу, что Ромашка растёт.");
});

test("плейсхолдеры: без нормализации письмо ушло бы со словом «Имя»", () => {
  // документируем исходный баг: одиночные скобки съедаются как группа выбора
  assert.equal(renderSpintax("Здравствуйте, {Имя}!", { name: "Пётр" }), "Здравствуйте, Имя!");
});

test("подстановка: пустое имя не оставляет «Здравствуйте, !»", () => {
  const rendered = renderSpintax("Здравствуйте, {{name}}!", { name: null });
  assert.equal(rendered, "Здравствуйте, !", "сырой рендер оставляет мусор");
  assert.equal(tidyAfterSubstitution(rendered), "Здравствуйте!");
});

test("подстановка: уборка не портит нормальный текст", () => {
  const ok = "Здравствуйте, Пётр! Как дела с проектом?";
  assert.equal(tidyAfterSubstitution(ok), ok);
});

// ── Окно отправки (§5.3, §5.6) ──
// Раньше отправка не смотрела на время суток вообще: счётчик дня прогрева
// сбрасывается по toDateString() в локальной таймзоне процесса, прод живёт в
// UTC — сброс приходился на 3 часа ночи по Москве, и первый же тик воркера
// после сброса высылал всю дневную квоту одним залпом ровно в этот момент.

const MSK_WINDOW = { enabled: true, timeZone: "Europe/Moscow", startHour: 9, endHour: 19, weekdays: [1, 2, 3, 4, 5] };

// Даты ниже подобраны в UTC так, чтобы после конвертации в MSK (+3) получить
// нужный день недели и час — тест не должен зависеть от локальной TZ машины,
// на которой запускается (dev-ноут, CI-раннер, что угодно).
test("окно: будний день в рабочие часы — внутри", () => {
  // 2026-08-04 — вторник; 10:00 UTC = 13:00 MSK
  assert.equal(isWithinSendWindow(new Date("2026-08-04T10:00:00Z"), MSK_WINDOW), true);
});

test("окно: рабочий день, но ночь — снаружи", () => {
  // 2026-08-04 00:30 UTC = 03:30 MSK — та самая точка, где раньше уходил залп
  assert.equal(isWithinSendWindow(new Date("2026-08-04T00:30:00Z"), MSK_WINDOW), false);
});

test("окно: суббота днём — снаружи (не рабочий день)", () => {
  // 2026-08-08 — суббота; 10:00 UTC = 13:00 MSK
  assert.equal(isWithinSendWindow(new Date("2026-08-08T10:00:00Z"), MSK_WINDOW), false);
});

test("окно: граница часа — конец окна не включён", () => {
  // 19:00:00 MSK ровно = окно уже закрыто (полуоткрытый интервал [9,19))
  assert.equal(isWithinSendWindow(new Date("2026-08-04T16:00:00Z"), MSK_WINDOW), false);
  // 18:59 MSK — ещё внутри
  assert.equal(isWithinSendWindow(new Date("2026-08-04T15:59:00Z"), MSK_WINDOW), true);
});

test("окно: enabled=false пропускает всегда, вне зависимости от времени", () => {
  const disabled = { ...MSK_WINDOW, enabled: false };
  assert.equal(isWithinSendWindow(new Date("2026-08-08T00:30:00Z"), disabled), true, "суббота, ночь — но выключено");
});

test("окно: прогресс дня растёт от 0 в начале окна до 1 в конце", () => {
  assert.equal(sendWindowProgress(new Date("2026-08-04T06:00:00Z"), MSK_WINDOW), 0, "9:00 MSK — старт");
  assert.equal(sendWindowProgress(new Date("2026-08-04T16:00:00Z"), MSK_WINDOW), 1, "19:00 MSK — конец");
  const midday = sendWindowProgress(new Date("2026-08-04T11:00:00Z"), MSK_WINDOW); // 14:00 MSK, середина
  assert.ok(midday > 0.4 && midday < 0.6, `ожидалась середина окна, получено ${midday}`);
  const before = sendWindowProgress(new Date("2026-08-04T00:00:00Z"), MSK_WINDOW); // глубокая ночь
  assert.equal(before, 0, "до открытия окна прогресс не уходит в отрицательные значения");
});

test("окно: enabled=false — прогресс всегда 1, размазывать нечем", () => {
  // Регрессия на реальный баг 2026-08-01: sendWindowProgress игнорировала
  // enabled и всегда считала по факту времени. SEND_WINDOW_ENABLED=false в
  // тестовом раннере (scripts/integration/run.ts) снимал только гейт
  // isWithinSendWindow, а дневная квота прогрева всё равно урезалась
  // пропорцией текущего часа МСК — интеграционные тесты стали зависеть от
  // того, в какой день недели и час их запускают. Обнаружено субботним утром:
  // тест на 5 раундов прогрева получил только ~1 отправку вместо 5.
  const disabled = { ...MSK_WINDOW, enabled: false };
  // глубокая ночь субботы — самый жёсткий случай, прогресс должен быть 1 всё равно
  assert.equal(sendWindowProgress(new Date("2026-08-08T00:30:00Z"), disabled), 1);
  assert.equal(sendWindowProgress(new Date("2026-08-04T06:00:00Z"), disabled), 1, "тот же момент, что дал бы 0 при включённом окне");
});

test("прогрев: unlockedWarmupTarget размазывает квоту, а не открывает её разом", () => {
  assert.equal(unlockedWarmupTarget(10, 0), 0, "в момент открытия окна ничего не разблокировано");
  assert.equal(unlockedWarmupTarget(10, 1), 10, "к закрытию окна доступна вся квота");
  assert.equal(unlockedWarmupTarget(10, 0.5), 5, "к середине окна — примерно половина");
  assert.equal(unlockedWarmupTarget(10, 0.05), 1, "округление вверх — иначе последнее письмо почти никогда не успеет уйти");
});

// ── Подсчёт ссылок в письме (§5.3, база знаний Trigga) ──

test("ссылки: пустой текст — 0", () => {
  assert.equal(countContentLinks(""), 0);
});

test("ссылки: только отписка — 0, она не в счёт", () => {
  const html = `<p>Текст</p><a href="{{unsubscribe_url}}">Отписаться</a>`;
  assert.equal(countContentLinks(html), 0);
});

test("ссылки: один CTA плюс отписка — 1", () => {
  // ровно то, что дают наши HTML-пресеты и фирменный каркас из коробки
  const html = `<a href="{{cta_url}}">Узнать больше</a><a href="{{unsubscribe_url}}">Отписаться</a>`;
  assert.equal(countContentLinks(html), 1);
});

test("ссылки: два разных URL — 2", () => {
  const html = `<a href="https://a.ru">A</a><a href="https://b.ru">B</a>`;
  assert.equal(countContentLinks(html), 2);
});

test("ссылки: одна и та же ссылка дважды в письме — 1, а не 2", () => {
  const html = `<a href="https://a.ru">Вверху</a>...<a href="https://a.ru">Внизу</a>`;
  assert.equal(countContentLinks(html), 1);
});

test("ссылки: голый URL в тексте без HTML засчитывается", () => {
  assert.equal(countContentLinks("Подробнее: https://example.com/page"), 1);
});

test("ссылки: {{cta_url}} вне href (режим «Просто текст») засчитывается", () => {
  assert.equal(countContentLinks("Подробнее тут: {{cta_url}}"), 1);
});

test("ссылки: пустой href декоративной кнопки не в счёт", () => {
  assert.equal(countContentLinks(`<a href="">Кнопка</a>`), 0);
});

// ── Ramp прогрева (§5.6) ──
// По базе знаний Trigga: старт 2/день, +1/день, потолок 10/день — суммарно с
// холодной рассылкой (30/день по умолчанию) не больше их рекомендованных
// 40/день с ящика. Раньше было 2-4 старт / +2-4 / потолок 20-30 — суммарно
// до 60/день, что для провайдера выглядит подозрительной активностью само
// по себе, вне зависимости от содержимого писем.

test("ramp: день 1 — dailyStart писем", () => {
  assert.equal(warmupDailyTarget("box-1", 1), config.warmup.dailyStart);
});

test("ramp: растёт на dailyIncrement в день и не превышает dailyMax", () => {
  const { dailyStart, dailyIncrement, dailyMax } = config.warmup;
  for (let day = 1; day <= 20; day++) {
    const target = warmupDailyTarget("box-1", day);
    assert.ok(target <= dailyMax, `день ${day}: ${target} превышает потолок ${dailyMax}`);
    if (day > 1) {
      const prev = warmupDailyTarget("box-1", day - 1);
      assert.ok(target - prev <= dailyIncrement, `день ${day}: прирост больше dailyIncrement`);
    }
  }
  assert.equal(warmupDailyTarget("box-1", dailyMax), dailyMax, "к этому дню достигнут потолок");
});

test("ramp: суммарно с холодным лимитом по умолчанию не превышает 40/день", () => {
  // Разработчик мог сдвинуть только один из параметров и не заметить, что
  // сумма разъехалась — обе константы держим в одном тесте, не порознь.
  assert.equal(config.warmup.dailyMax + 30, 40, "coldDailyLimit по умолчанию — 30");
});

// ── HTML-двойник текстового письма (трекинг в режиме «Просто текст») ──

test("текст→HTML: переносы строк становятся <br>, спецсимволы экранируются", () => {
  const html = plainTextToHtml("Привет!\nЭто <тест> & проверка");
  assert.ok(html.includes("<br>"));
  assert.ok(html.includes("&lt;тест&gt;"), "угловые скобки экранированы");
  assert.ok(html.includes("&amp;"));
});

test("текст→HTML: голые ссылки становятся кликабельными", () => {
  // без этого трекинг кликов их не увидит: instrumentHtml подменяет только href
  const html = plainTextToHtml("Подробнее: https://example.com/page?a=1");
  assert.ok(html.includes('<a href="https://example.com/page?a=1">'));
});

test("текст→HTML: обычный текст не превращается в разметку", () => {
  const html = plainTextToHtml("Здравствуйте, Пётр");
  assert.ok(html.includes("Здравствуйте, Пётр"));
  assert.ok(!html.includes("<a "), "ссылок нет — и появляться неоткуда");
});

// ── Триггеры передачи лида в CRM ──
// Ключи приходят из формы (браузер) и уходят в промпт ИИ и в БД — принимаем
// только известные, иначе туда доедет подложенный мусор.

test("триггеры: незнакомые ключи отбрасываются, дубли схлопываются", () => {
  const out = sanitizeTriggerKeys([
    "call_request",
    "выдуманный_ключ",
    "call_request",
    "meeting_request",
  ]);
  assert.deepEqual(out, ["call_request", "meeting_request"]);
});

test("триггеры: описание для промпта содержит только выбранные", () => {
  const prompt = describeTriggersForPrompt(["call_request", "мусор"]);
  assert.ok(prompt.includes("call_request"), "выбранный ключ на месте");
  assert.ok(!prompt.includes("meeting_request"), "невыбранные не попадают в промпт");
  assert.ok(!prompt.includes("мусор"));
});

test("триггеры: пустой выбор даёт пустой промпт, а не мусорную строку", () => {
  assert.equal(describeTriggersForPrompt([]), "");
  assert.equal(describeTriggersForPrompt(["ничего_не_значащий"]), "");
});

test("триггеры: запроса цены среди встроенных больше нет", () => {
  // регрессия: «спрашивает цену» — не признак готовности лида, убрано по
  // прямому запросу пользователя (интерес к цене есть почти у всех)
  assert.equal(sanitizeTriggerKeys(["pricing_request"]).length, 0);
  assert.equal(describeTriggersForPrompt(["pricing_request"]), "");
});

test("триггеры: дефолт для новых аккаунтов — все встроенные сразу включены", () => {
  assert.ok(DEFAULT_HANDOFF_TRIGGERS.length >= 1);
  assert.deepEqual(sanitizeTriggerKeys(DEFAULT_HANDOFF_TRIGGERS), DEFAULT_HANDOFF_TRIGGERS);
});

test("контекст квалификации: свой сценарий добавляется к встроенным, не заменяет их", () => {
  const { promptText, validKeys } = buildHandoffContext(["call_request"], "клиент прислал ТЗ");
  assert.ok(promptText.includes("call_request"), "встроенный триггер на месте");
  assert.ok(promptText.includes("клиент прислал ТЗ"), "свой текст добавлен");
  assert.ok(validKeys.includes("call_request"));
  assert.ok(validKeys.includes(CUSTOM_TRIGGER_KEY), "модели разрешено сослаться на custom_scenario");
});

test("контекст квалификации: пустой свой сценарий не добавляет пустую строку", () => {
  const { promptText, validKeys } = buildHandoffContext(["call_request"], "   ");
  assert.ok(!validKeys.includes(CUSTOM_TRIGGER_KEY), "пробелы не считаются сценарием");
  assert.equal(promptText, "- call_request: клиент просит созвониться, спрашивает про звонок или оставляет телефон");
});

test("контекст квалификации: только свой сценарий без единой встроенной галочки", () => {
  const { promptText, validKeys } = buildHandoffContext([], "клиент подписал бриф");
  assert.deepEqual(validKeys, [CUSTOM_TRIGGER_KEY]);
  assert.ok(promptText.includes("клиент подписал бриф"));
});

test("подписи триггеров: спецключи ручной передачи и своего сценария читаемы", () => {
  assert.equal(triggerLabel(MANUAL_TRIGGER_KEY), "Передано вручную");
  assert.equal(triggerLabel(CUSTOM_TRIGGER_KEY), "Пользовательский сценарий");
  assert.equal(triggerLabel("call_request"), "Просит позвонить");
});


// ── Цепочка follow-up (§5.3, по базе знаний Trigga) ──

test("follow-up: цепочка шагов разбирается по порядку", () => {
  const raw = JSON.stringify([
    { daysAfterPrevious: 3, subject: "Re: Тема", body: "Первое письмо" },
    { daysAfterPrevious: 4, subject: "Re: Тема", body: "Второе письмо" },
  ]);
  const steps = parseFollowupSteps(raw);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].daysAfterPrevious, 3);
  assert.equal(steps[1].body, "Второе письмо");
});

test("follow-up: битые данные не роняют создание кампании", () => {
  assert.deepEqual(parseFollowupSteps(""), []);
  assert.deepEqual(parseFollowupSteps("не json"), []);
  assert.deepEqual(parseFollowupSteps('{"не":"массив"}'), []);
});

test("follow-up: границы daysAfterPrevious и пустые поля отбрасывают шаг поштучно", () => {
  const steps = parseFollowupSteps(
    JSON.stringify([
      { daysAfterPrevious: 3, subject: "Норм", body: "Текст" },
      { daysAfterPrevious: 0, subject: "Ноль дней", body: "Текст" }, // < 1
      { daysAfterPrevious: 31, subject: "Слишком долго", body: "Текст" }, // > 30
      { daysAfterPrevious: 3.5, subject: "Не целое", body: "Текст" },
      { daysAfterPrevious: 3, subject: "", body: "Без темы" },
      { daysAfterPrevious: 3, subject: "Без текста" }, // body отсутствует
    ])
  );
  assert.equal(steps.length, 1, "выживает только валидный шаг");
  assert.equal(steps[0].subject, "Норм");
});

test("follow-up: длина цепочки ограничена потолком", () => {
  const oversized = Array.from({ length: MAX_FOLLOWUP_STEPS + 5 }, (_, i) => ({
    daysAfterPrevious: 3,
    subject: `Шаг ${i}`,
    body: "Текст",
  }));
  const steps = parseFollowupSteps(JSON.stringify(oversized));
  assert.equal(steps.length, MAX_FOLLOWUP_STEPS);
});

// ── Мультисегментные кампании ──
// Раньше во все кампании пачки уходил один текст, сгенерированный под первый
// сегмент: разделение было только в статистике, а письма у всех одинаковые.

test("сегменты: тексты разбираются по сегментам", () => {
  const raw = JSON.stringify({
    агентства: { subject: "Тема А", body: "Текст А" },
    подрядчики: { subject: "Тема Б", body: "Текст Б" },
  });
  const parsed = parseSegmentTexts(raw);
  assert.equal(Object.keys(parsed).length, 2);
  assert.equal(parsed["агентства"].subject, "Тема А");
  assert.equal(parsed["подрядчики"].body, "Текст Б");
});

test("сегменты: битые данные не роняют создание кампании", () => {
  // при любой проблеме откатываемся на общий текст, а не падаем
  assert.deepEqual(parseSegmentTexts(""), {});
  assert.deepEqual(parseSegmentTexts("не json"), {});
  assert.deepEqual(parseSegmentTexts("[1,2,3]"), {});
  assert.deepEqual(parseSegmentTexts('{"сегмент": null}'), {});
});

test("сегменты: записи неверной формы отбрасываются поштучно", () => {
  const raw = JSON.stringify({
    хороший: { subject: "Тема", body: "Текст" },
    безТекста: { subject: "Тема" },
    числа: { subject: 1, body: 2 },
  });
  const parsed = parseSegmentTexts(raw);
  assert.deepEqual(Object.keys(parsed), ["хороший"], "валидная запись выживает, мусор отсеивается");
});

// ── Классификация ошибок почты (§5.8) ──
// От неё зависит, пометит ли движок ящик сломанным или тот останется в
// ротации, молча роняя письма. Строки ниже — НЕ выдуманные: это то, что
// реально ответил Яндекс 360 на неверный пароль (проверено 2026-07-29).

test("SMTP: отказ логина Яндекса классифицируется как проблема с паролем", () => {
  const real = "Invalid login: 535 5.7.8 Error: authentication failed: Invalid user or password! 1785345481-1Iihxm0dIeA0";
  assert.equal(classifySmtpError(real), "auth");
});

test("SMTP: недоступный хост — это сеть, а не пароль", () => {
  assert.equal(classifySmtpError("connect ECONNREFUSED 127.0.0.1:465"), "network");
  assert.equal(classifySmtpError("getaddrinfo ENOTFOUND smtp.nowhere.test"), "network");
});

test("IMAP: отказ логина виден по флагу библиотеки, а не по тексту", () => {
  // imapflow всегда бросает generic Error("Command failed"), а причину кладёт
  // в отдельные поля. Пока смотрели только на message, отказ уезжал в "other",
  // и ящик со сброшенным паролем оставался зелёным и в ротации.
  const imapflowError = Object.assign(new Error("Command failed"), {
    authenticationFailed: true,
    serverResponseCode: "AUTHENTICATIONFAILED",
  });
  assert.equal(classifyImapError(imapflowError), "auth");
});

test("IMAP: причина отказа попадает в текст для интерфейса", () => {
  const imapflowError = Object.assign(new Error("Command failed"), {
    authenticationFailed: true,
    responseText: "Invalid user or password",
  });
  // иначе в карточке ящика оставалось бесполезное "Command failed"
  assert.ok(describeImapError(imapflowError).includes("Invalid user or password"));
});

test("IMAP: обрыв соединения — это сеть", () => {
  assert.equal(classifyImapError(new Error("Connection closed unexpectedly")), "network");
});

console.log(`\n${passed} тестов пройдено${process.exitCode ? ", ЕСТЬ ОШИБКИ" : ""}`);
