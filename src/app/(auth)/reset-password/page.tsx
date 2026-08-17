import { inspectAuthToken } from "@/lib/authTokens";
import { hasAcceptedCurrentUserAgreement } from "@/lib/legal";
import { InvalidPasswordLink, SetPasswordForm } from "../PasswordForms";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const record = token ? await inspectAuthToken(token) : null;
  return record
    ? <SetPasswordForm token={token!} requireTerms={!hasAcceptedCurrentUserAgreement(record.user)} />
    : <InvalidPasswordLink />;
}
