import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { hasAcceptedCurrentUserAgreement } from "@/lib/legal";
import { ChangeTemporaryPasswordForm } from "../PasswordForms";

export default async function ChangePasswordPage() {
  const user = await requireUser();
  if (!user.mustChangePassword) redirect("/app");
  return <ChangeTemporaryPasswordForm requireTerms={!hasAcceptedCurrentUserAgreement(user)} />;
}
