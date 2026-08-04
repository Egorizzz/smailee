import { redirect } from "next/navigation";

// HTML-шаблоны и оформление писем заморожены. Старые ссылки ведут к кампаниям,
// а не к архивной функциональности.
export default function TemplatesRedirect() {
  redirect("/app/campaigns");
}
