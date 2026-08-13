-- Старый Bitrix-адаптер в mock-режиме мог поставить pushedToCrm=true, хотя
-- реальной сущности в CRM не существовало. Возвращаем такие лиды в честное
-- состояние: после подключения CRM их можно передать вручную.
UPDATE "Lead"
SET
    "pushedToCrm" = false,
    "handedOffAt" = NULL,
    "handoffTrigger" = NULL
WHERE "pushedToCrm" = true
  AND "crmEntityId" IS NULL;

-- «Передан в CRM» отныне всегда означает подтверждённый crm.lead.add и
-- сохранённый идентификатор сущности Битрикс24.
ALTER TABLE "Lead"
ADD CONSTRAINT "Lead_pushedToCrm_requires_crmEntityId"
CHECK ("pushedToCrm" = false OR "crmEntityId" IS NOT NULL);
