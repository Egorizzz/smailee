import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { requireUser } from "@/lib/auth";
import { acceptTermsAction } from "../actions";

export default async function AcceptTermsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");
  if (user.acceptedTermsAt) redirect("/app");
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8 text-center">
        <div className="flex justify-center"><Logo /></div>
        <h1 className="mt-6 text-2xl font-bold text-slate-900">Перед началом работы</h1>
        <p className="mt-2 text-sm text-ink-500">Подтвердите пользовательское соглашение. Менять пароль не требуется.</p>
      </div>
      <form action={acceptTermsAction} className="space-y-4">
        <label className="flex items-start gap-2 rounded-lg border border-line bg-white p-4 text-sm leading-6 text-ink-700">
          <input type="checkbox" name="acceptTerms" required className="mt-1" />
          <span>
            Я принимаю{" "}
            <Link href="/terms" target="_blank" className="text-indigo-600 underline">
              пользовательское соглашение
            </Link>
          </span>
        </label>
        {error === "required" && (
          <p aria-live="polite" className="text-sm text-red-600">Необходимо принять пользовательское соглашение.</p>
        )}
        <button className="w-full rounded-lg brand-gradient px-4 py-3 text-sm font-semibold text-white">
          Принять и перейти в кабинет
        </button>
      </form>
    </div>
  );
}
