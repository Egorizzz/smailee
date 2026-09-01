import { Logo } from "@/components/Logo";
import { inspectAuthToken } from "@/lib/authTokens";
import { prisma } from "@/lib/prisma";
import { confirmCredentialChange } from "./actions";

export default async function ConfirmCredentialsPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token = "", error } = await searchParams;
  const inspected = token ? await inspectAuthToken(token) : null;
  const request = inspected?.type === "CREDENTIAL_CHANGE"
    ? await prisma.accountCredentialChange.findUnique({ where: { userId: inspected.userId } })
    : null;
  const valid = Boolean(inspected && request && request.expiresAt > new Date());
  const errorText = error === "login-taken" ? "Этот логин уже занят. Вернитесь в настройки и выберите другой." : "Ссылка уже использована или больше не действует.";

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12 text-center">
      <div className="flex justify-center"><Logo /></div>
      <h1 className="mt-6 text-2xl font-bold text-slate-900">Подтверждение доступа</h1>
      <p className="mt-2 text-sm leading-6 text-ink-500">{valid ? "Подтвердите изменение логина или пароля для кабинета Smailee." : errorText}</p>
      {valid ? (
        <form action={confirmCredentialChange} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <button className="w-full rounded-lg brand-gradient px-4 py-3 text-sm font-semibold text-white">Подтвердить изменение</button>
        </form>
      ) : (
        <a href="/login" className="mt-6 rounded-lg border border-line px-4 py-3 text-sm font-semibold text-slate-900">Перейти ко входу</a>
      )}
    </div>
  );
}
