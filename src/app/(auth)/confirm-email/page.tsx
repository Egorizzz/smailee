import { Logo } from "@/components/Logo";
import { inspectAuthToken } from "@/lib/authTokens";
import { prisma } from "@/lib/prisma";
import { confirmEmailChange } from "./actions";

export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token = "", error } = await searchParams;
  const inspected = token ? await inspectAuthToken(token) : null;
  const request = inspected?.type === "EMAIL_CHANGE" ? await prisma.accountEmailChange.findUnique({ where: { userId: inspected.userId } }) : null;
  const valid = Boolean(inspected && request && request.expiresAt > new Date());
  const errorText = error === "occupied" ? "Этот email уже используется другим аккаунтом." : "Ссылка уже использована или больше не действует.";
  return <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12 text-center"><div className="flex justify-center"><Logo /></div><h1 className="mt-6 text-2xl font-bold text-slate-900">Подтверждение email</h1><p className="mt-2 text-sm leading-6 text-ink-500">{valid ? `Новый адрес для входа: ${request!.newEmail}` : errorText}</p>{valid ? <form action={confirmEmailChange} className="mt-6"><input type="hidden" name="token" value={token} /><button className="w-full rounded-lg brand-gradient px-4 py-3 text-sm font-semibold text-white">Подтвердить новый email</button></form> : <a href="/app/settings/security" className="mt-6 rounded-lg border border-line px-4 py-3 text-sm font-semibold text-slate-900">Вернуться в настройки</a>}</div>;
}
