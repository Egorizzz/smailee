import { inspectAuthToken } from "@/lib/authTokens";
import { InvalidPasswordLink, SetPasswordForm } from "../PasswordForms";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const record = token ? await inspectAuthToken(token) : null;
  return record
    ? <SetPasswordForm token={token!} requireTerms={!record.user.acceptedTermsAt} />
    : <InvalidPasswordLink />;
}
