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
import { plainTextToHtml } from "../src/lib/mail/textToHtml";

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
