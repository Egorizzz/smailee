import { redirect } from "next/navigation";

export default async function NotificationsPage() {
  redirect("/app/settings/notifications");
}
