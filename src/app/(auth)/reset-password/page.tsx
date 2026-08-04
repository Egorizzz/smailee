import { SetPasswordForm } from "../PasswordForms";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return token ? <SetPasswordForm token={token} /> : <SetPasswordForm token="" />;
}
