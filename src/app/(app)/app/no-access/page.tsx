import { requireWorkspace } from "@/lib/organization";

export default async function NoAccessPage() {
  await requireWorkspace();
  return <div className="mx-auto max-w-xl rounded-xl border border-line bg-white p-8 text-center"><h1 className="text-xl font-semibold text-slate-900">Нет назначенных доступов</h1><p className="mt-2 text-ink-500">Обратитесь к администратору организации, чтобы он включил нужные разделы кабинета.</p></div>;
}
