import { redirect } from "next/navigation";

// R3: отдельной вкладки «Шаблоны» больше нет — галерея шаблонов и брендинг
// живут в панели «Оформление» мастера кампании (шаг «Письмо»).
export default function TemplatesRedirect() {
  redirect("/app/campaigns/new");
}
