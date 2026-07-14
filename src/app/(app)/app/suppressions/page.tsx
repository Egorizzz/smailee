import { redirect } from "next/navigation";

// R1: «Отписки» — редкий сценарий, живёт табом внутри «Контактов».
export default function SuppressionsRedirect() {
  redirect("/app/contacts?tab=suppressions");
}
