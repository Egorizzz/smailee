import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="flex flex-col justify-between gap-8 md:flex-row">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-sm text-ink-500">
              AI-сотрудник, который приводит тёплых лидов из холодной базы —
              без найма менеджера по продажам.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
            <div>
              <div className="font-semibold text-slate-900">Продукт</div>
              <ul className="mt-3 space-y-2 text-ink-500">
                <li><a href="#how" className="hover:text-slate-900">Как работает</a></li>
                <li><a href="#features" className="hover:text-slate-900">Возможности</a></li>
                <li><a href="#pricing" className="hover:text-slate-900">Цена</a></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold text-slate-900">Контакты</div>
              <ul className="mt-3 space-y-2 text-ink-500">
                <li><a href="mailto:hello@smailee.ru" className="hover:text-slate-900">hello@smailee.ru</a></li>
                <li><a href="https://t.me/smailee" className="hover:text-slate-900">Telegram @smailee</a></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold text-slate-900">Компания</div>
              <ul className="mt-3 space-y-2 text-ink-500">
                <li><a href="#cta" className="hover:text-slate-900">Записаться на демо</a></li>
                <li><a href="/login" className="hover:text-slate-900">Вход для клиентов</a></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-10 border-t border-line pt-6 text-xs text-ink-500">
          © {new Date().getFullYear()} Smailee. Все права защищены.
        </div>
      </div>
    </footer>
  );
}
