import { redirect } from "next/navigation";

// R1: «Инбокс» слит с «Лидами» в один экран (диалоги + квалификация +
// модерация). Роут сохранён редиректом — на него могли остаться ссылки.
export default function InboxRedirect() {
  redirect("/app/leads");
}
