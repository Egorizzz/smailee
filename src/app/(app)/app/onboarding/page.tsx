import { redirect } from "next/navigation";

// R1: форма «Мой бизнес» переехала в Настройки (а первичное заполнение —
// шаг онбординг-визарда /app/setup, R2). Роут сохранён редиректом.
export default function OnboardingRedirect() {
  redirect("/app/settings");
}
