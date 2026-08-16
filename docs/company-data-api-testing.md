# Тестирование поставщиков компаний и контактов

## Переменные окружения

```env
CHECKO_API_KEY=
HUNTER_API_KEY=

DATANEWTON_API_KEY=
DATANEWTON_BASE_URL=
DATANEWTON_SEARCH_PATH=
# bearer | x-api-key | query
DATANEWTON_AUTH_MODE=bearer
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
