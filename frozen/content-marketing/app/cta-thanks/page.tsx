// Публичная страница-подтверждение после клика "Оставить заявку" в письме.
export default function CtaThanksPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5 text-center">
      <div className="w-full rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full brand-gradient text-xl text-white">
          ✓
        </div>
        <h1 className="text-xl font-bold text-slate-900">Заявка принята</h1>
        <p className="mt-2 text-sm text-ink-500">
          Спасибо! Мы получили ваш интерес и скоро свяжемся с вами.
        </p>
      </div>
      <p className="mt-6 text-xs text-ink-500">Smailee</p>
    </div>
  );
}
