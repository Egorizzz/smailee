export const demoCopy = {
  sentMessages: [
    { company: "Northstar Labs", subject: "Идея для роста outbound-продаж", time: "10:42", status: "Доставлено" },
    { company: "Vektor Cloud", subject: "Как не терять ответы из холодной базы", time: "10:38", status: "Открыто" },
    { company: "Forma Tech", subject: "Персональная кампания для вашей команды", time: "10:31", status: "Доставлено" },
    { company: "Atlas Group", subject: "Покажем новый канал привлечения", time: "10:24", status: "Ответили" },
  ],
  clientReplies: [
    { name: "Анна Лебедева", company: "Northstar Labs", message: "Интересно. Давайте созвонимся на следующей неделе?", time: "10:47", status: "Встреча" },
    { name: "Илья Орлов", company: "Vektor Cloud", message: "Да, задача актуальна. Пришлите расчёт на нашу команду.", time: "10:41", status: "Запрос цены" },
    { name: "Мария Соколова", company: "Forma Tech", message: "Готова обсудить. Есть свободное время в четверг после 15:00.", time: "10:33", status: "Тёплый лид" },
  ],
  nav: ["Исходящие", "Диалоги", "Лиды"],
  title: "Из отправленных писем — в интерес и встречи",
  description:
    "Smailee запускает персональные письма, замечает заинтересованные ответы и помогает продолжить разговор.",
  transitionAria: "Письма превращаются в ответы",
  prompt: "Покажем Smailee на вашей задаче",
  button: "Записаться на демо",
  testimonial: {
    imageAlt: "Клим, CEO ТвойЗонт",
    name: "Клим",
    role: "CEO · ТвойЗонт",
    quote: "«Благодаря Smailee открыли для себя новый стабильный канал работы с партнерами: первые лиды из email пришли спустя всего месяц после старта»",
  },
  dialogAria: "Запись на демо Smailee",
  form: {
    error: "Не удалось отправить заявку",
    successTitle: "Заявка отправлена",
    successText: "Свяжемся по указанному контакту и подберём удобное время для короткого демо.",
    done: "Готово",
    title: "Покажем на вашей задаче",
    closeAria: "Закрыть форму",
    fields: [
      { name: "name", label: "Имя", placeholder: "Как к вам обращаться", autoComplete: "name" },
      { name: "company", label: "Сайт или компания", placeholder: "company.ru или название", autoComplete: "organization" },
      { name: "contact", label: "Любой удобный контакт", placeholder: "Email, Telegram или телефон", autoComplete: "email" },
    ],
    loading: "Отправляем…",
    submit: "Записаться на демо",
    note: "Покажем продукт и ответим на вопросы.",
  },
} as const;
