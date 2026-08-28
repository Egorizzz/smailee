# Тестирование поставщиков компаний и контактов

## Переменные окружения

```env
CHECKO_API_KEY=
HUNTER_API_KEY=

DATANEWTON_API_KEY=
DATANEWTON_BASE_URL=
DATANEWTON_SEARCH_PATH=
DATANEWTON_COUNTERPARTY_PATH=/v1/counterparty
# bearer | x-api-key | query
DATANEWTON_AUTH_MODE=bearer

# Локальный предохранитель бесплатных квот
COMPANY_DATA_SAFE_MODE=true
COMPANY_DATA_SAFE_SEARCH_LIMIT=3
COMPANY_DATA_SAFE_HUNTER_LIMIT=1
```

Значения `DATANEWTON_BASE_URL`, `DATANEWTON_SEARCH_PATH` и способ авторизации нужно взять из документации к выданному продукту «Датаньютон.Фильтры API». Они намеренно не зафиксированы в коде.

## CLI-выгрузка

Создайте локальный JSON, не добавляя ключи API в файл:

```json
{
  "hunterLimitPerDomain": 10,
  "checko": {
    "by": "okved",
    "query": "62.01",
    "obj": "org",
    "active": true,
    "limit": 20
  },
  "datanewton": {
    "limit": 20,
    "filters": {
      "okved": ["62.01"],
      "status": ["ACTIVE"]
    }
  }
}
```

Поля запроса DataNewton замените на точные поля из выданной документации. Запуск:

```bash
npm run data:test -- experiment.local.json comparison.json
```

В отчёте для каждого pipeline сохраняются нормализованные компании, исходные email и телефоны, результаты Hunter, число доступных полей и оценка расхода запросов/кредитов.

## Административный API

`POST /api/admin/company-data/experiment` принимает тот же объект после входа администратором. Лимит одной тестовой выдачи следует держать небольшим: Checko выполняет один поисковый запрос и затем один запрос карточки на каждую компанию; Hunter выполняет один Domain Search на каждый уникальный домен.

## Управляемый pipeline

Пользовательский pipeline не запускает платные API при создании. Последовательность:

1. `POST /api/company-data/prospecting-runs` создаёт `DRAFT` и возвращает рассчитанные бюджеты.
2. `POST /api/company-data/prospecting-runs/:id/queue` с `{ "confirmed": true }` явно разрешает расход и переводит задание в `QUEUED`.
3. DataNewton выполняет основной поиск. Checko запрашивается только для карточек без однозначного статуса, домена, руководителя или email, а также при конфликте доменов или несоответствии найденных email домену.
4. Worker забирает не более одного задания за цикл. `GET /api/company-data/prospecting-runs/:id` возвращает прогресс, выбранный контакт, источники и статусы проверки.
5. `POST /api/company-data/prospecting-runs/:id/cancel` отменяет черновик/очередь или просит выполняющийся pipeline остановиться между компаниями.

Пример создания безопасного малого теста:

```json
{
  "query": { "filters": { "okved": ["62.01"], "only_active": true } },
  "targetCompanies": 5,
  "maxCandidates": 10,
  "allowAcceptAll": false,
  "budgets": {
    "maxDataNewtonRecords": 10,
    "maxCheckoRequests": 10,
    "maxFirecrawlPages": 15,
    "maxHunterCredits": 6
  }
}
```

Email сначала дедуплицируются и ранжируются. Свежий `valid` от Hunter повторно не проверяется. Адрес из сайта или другого поставщика проходит `GET /v2/email-verifier`; `valid` и `accept_all` принимаются, `invalid`, `disposable`, `webmail` и `claimed` отклоняются, `unknown`/`pending` можно повторить позднее. `accept_all` расходует тариф как обычный контакт, но хранится и показывается с пониженной уверенностью: сервер принимает почту, однако существование конкретного ящика подтвердить нельзя.

## Будущий собственный парсер

ScrapeGraphAI зафиксирован как возможная open-source основа будущего self-hosted parser worker. В текущий runtime он намеренно не добавлен: на старте используется уже реализованный Firecrawl с коротким анализом до трёх страниц и кэшем. Интерфейс анализа сайта остаётся заменяемым.
