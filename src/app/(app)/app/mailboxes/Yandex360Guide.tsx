"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type GuidePage = {
  label: string;
  title: string;
  bullets: string[];
  image: string;
  width: number;
  height: number;
  alt: string;
  note?: string;
};

const guidePages: GuidePage[] = [
  {
    label: "Сотрудники",
    title: "Откройте список сотрудников",
    bullets: [
      "Войдите в админку с аккаунта, на который оформлен Яндекс 360.",
      "Убедитесь, что домен подключён, а тариф оплачен на нужное число сотрудников.",
      "Откройте «Сотрудники» → «Добавить» → «Создать вручную».",
    ],
    image: "/guides/yandex360/01-employees.png",
    width: 1917,
    height: 605,
    alt: "Раздел Сотрудники в админке Яндекс 360 и пункт Создать вручную",
    note: "Для одного рассылочного домена рекомендуем не более 4 сотрудников.",
  },
  {
    label: "Новый сотрудник",
    title: "Создайте почтовый ящик",
    bullets: [
      "Заполните фамилию и имя. Лучше использовать ФИО реальных сотрудников.",
      "ФИО могут повторяться — логины должны быть разными.",
      "Придумайте логин и временный пароль для первого входа в почту.",
    ],
    image: "/guides/yandex360/02-new-employee.png",
    width: 676,
    height: 945,
    alt: "Форма создания нового сотрудника в Яндекс 360",
    note: "Например: Иванов Иван с логинами ivanovivan@company.ru и ivanivanov@company.ru.",
  },
  {
    label: "Первый вход",
    title: "Отключите обязательную смену пароля",
    bullets: [
      "Снимите флажок «Сотрудник должен изменить пароль при первом входе».",
      "Нажмите «Добавить».",
    ],
    image: "/guides/yandex360/03-disable-password-change.png",
    width: 655,
    height: 49,
    alt: "Флажок обязательной смены пароля при первом входе",
    note: "Повторите создание для остальных ящиков — до 4 сотрудников в организации.",
  },
  {
    label: "Протоколы",
    title: "Разрешите подключение к почте",
    bullets: [
      "В админке откройте «Почта» → «Настройки».",
      "В блоке «Использовать протоколы» включите POP3 и IMAP.",
      "Сохраните настройки, если Яндекс показывает кнопку сохранения.",
    ],
    image: "/guides/yandex360/04-mail-protocols.png",
    width: 1810,
    height: 559,
    alt: "Настройки POP3 и IMAP в админке Яндекс 360",
  },
  {
    label: "Вход в почту",
    title: "Войдите как сотрудник",
    bullets: [
      "Войдите в почту под созданным логином и временным паролем.",
      "Примите пользовательское соглашение при первом входе.",
      "Откройте настройки и нажмите «Все настройки».",
    ],
    image: "/guides/yandex360/05-mail-settings.png",
    width: 812,
    height: 941,
    alt: "Меню настроек в почте Яндекс 360",
  },
  {
    label: "Безопасность",
    title: "Перейдите к паролям приложений",
    bullets: [
      "В «Настройках» откройте раздел «Безопасность».",
      "Нажмите ссылку «Пароли приложений».",
    ],
    image: "/guides/yandex360/06-security.png",
    width: 1826,
    height: 455,
    alt: "Раздел Безопасность в настройках Яндекс Почты",
  },
  {
    label: "Доступ",
    title: "Включите пароли приложений",
    bullets: [
      "Включите переключатель «Использовать пароли приложений».",
      "После включения станет доступно создание отдельного пароля для почты.",
    ],
    image: "/guides/yandex360/07-enable-app-passwords.png",
    width: 916,
    height: 132,
    alt: "Переключатель Использовать пароли приложений",
  },
  {
    label: "Подключение",
    title: "Создайте пароль и подключите ящик",
    bullets: [
      "Выберите приложение «Почта» и задайте имя пароля, например Smailee.",
      "Скопируйте пароль сразу — повторно Яндекс его не покажет.",
      "В Smailee укажите email сотрудника, имя отправителя и этот пароль приложения.",
    ],
    image: "/guides/yandex360/08-create-app-password.png",
    width: 813,
    height: 672,
    alt: "Создание нового пароля приложения для почты",
    note: "После подключения ящик автоматически начнёт прогрев. Повторите для всех рассылочных доменов.",
  },
];

export function Yandex360Guide() {
  const [open, setOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const page = guidePages[pageIndex];

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeGuide();
      if (event.key === "ArrowRight" && pageIndex < guidePages.length - 1) setPageIndex((index) => index + 1);
      if (event.key === "ArrowLeft" && pageIndex > 0) setPageIndex((index) => index - 1);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, pageIndex]);

  function openGuide() {
    setPageIndex(0);
    setOpen(true);
  }

  function closeGuide() {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openGuide}
        className="self-start rounded-lg border border-line bg-white px-3 py-2 text-left hover:border-mint-300"
      >
        <span className="block text-sm font-semibold text-ink-700">Инструкция Яндекс 360</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeGuide();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="yandex-guide-title"
            className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl"
          >
            <header className="border-b border-line px-4 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-mint-700">Подключение Яндекс 360</div>
                  <h2 id="yandex-guide-title" className="mt-1 text-xl font-bold text-slate-900 sm:text-2xl">Подготовьте и подключите почтовый ящик</h2>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={closeGuide}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-xl text-ink-500 hover:bg-surface hover:text-slate-900"
                  aria-label="Закрыть инструкцию"
                >
                  ×
                </button>
              </div>

              <div className="mt-4 grid grid-cols-8 gap-1" aria-hidden="true">
                {guidePages.map((_, index) => (
                  <span key={index} className={`h-1 rounded-full ${index <= pageIndex ? "bg-mint-500" : "bg-surface"}`} />
                ))}
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
              <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.72fr)_minmax(0,1.5fr)] lg:items-center">
                <div>
                  <div className="text-xs font-semibold text-ink-500">
                    Экран {pageIndex + 1} из {guidePages.length} · {page.label}
                  </div>
                  <h3 className="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">{page.title}</h3>
                  <ol className="mt-4 space-y-3">
                    {page.bullets.map((bullet, index) => (
                      <li key={bullet} className="flex gap-3 text-sm leading-relaxed text-ink-700">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-mint-50 text-xs font-bold text-mint-700">{index + 1}</span>
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ol>
                  {page.note && (
                    <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-800">
                      {page.note}
                    </p>
                  )}
                </div>

                <figure className="overflow-hidden rounded-xl border border-line bg-surface p-2 sm:p-3">
                  <Image
                    key={page.image}
                    src={page.image}
                    width={page.width}
                    height={page.height}
                    alt={page.alt}
                    className="max-h-[54vh] w-full rounded-lg object-contain"
                    priority={pageIndex === 0}
                  />
                  <figcaption className="px-1 pt-2 text-xs text-ink-500">{page.alt}</figcaption>
                </figure>
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-line bg-white px-4 py-3 sm:px-6">
              <button
                type="button"
                onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
                disabled={pageIndex === 0}
                className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← Назад
              </button>
              {pageIndex === guidePages.length - 1 ? (
                <button type="button" onClick={closeGuide} className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white">
                  Перейти к форме
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setPageIndex((index) => Math.min(guidePages.length - 1, index + 1))}
                  className="rounded-lg brand-gradient px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Далее →
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
