import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { inspectAuthToken } from "@/lib/authTokens";
import { initialAccessAction } from "../actions";

export default async function InitialAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token = "", error } = await searchParams;
  const access = token ? await inspectAuthToken(token) : null;
  if (access && !["INITIAL_ACCESS", "EMAIL_LOGIN", "INVITE"].includes(access.type)) redirect("/login");
  const expired = error === "expired" || !access;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8 text-center">
        <div className="flex justify-center"><Logo /></div>
        <h1 className="mt-6 text-2xl font-bold text-slate-900">Вход в Smailee</h1>
        <p className="mt-2 text-sm leading-6 text-ink-500">
          {expired ? "Ссылка уже использована или больше не действует." : "Мы уже узнали ваш кабинет. Подтвердите вход — вводить логин и пароль не нужно."}
        </p>
      </div>

      {expired ? (
        <a href="/login" className="rounded-lg brand-gradient px-4 py-3 text-center text-sm font-semibold text-white">Получить новую ссылку</a>
      ) : (
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <label className="text-sm font-medium text-slate-900">Email</label>
          <div className="mt-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink-700">
            {access.user.email}
          </div>
          <form action={initialAccessAction} className="mt-5">
            <input type="hidden" name="token" value={token} />
            <button className="w-full rounded-lg brand-gradient px-4 py-3 text-sm font-semibold text-white">Войти</button>
          </form>
          <p className="mt-3 text-center text-xs leading-5 text-ink-500">Ссылка одноразовая. Пароль можно добавить позже в разделе «Вход и безопасность».</p>
        </div>
      )}
    </div>
  );
}
