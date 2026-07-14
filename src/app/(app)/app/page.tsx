import { redirect } from "next/navigation";

// TO BE (R1): «Обзор» упразднён — главная продукта = «Лиды» (ключевые
// метрики теперь строкой там). R2 сделает этот роут setup-aware: если
// первичная настройка не завершена и не закрыта — поведёт в /app/setup.
export default function AppHome() {
  redirect("/app/leads");
}
