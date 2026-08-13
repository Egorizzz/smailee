export const painsCopy = {
  collageAria:
    "Несвязанные каналы холодных продаж: сообщения, мероприятия и рекламные расходы",
  telegram: {
    contact: "Новый контакт",
    presence: "был недавно",
    firstMessage: "Добрый день! Увидели моё сообщение?",
    secondMessage: "Подниму переписку",
    firstTime: "10:42 ✓",
    secondTime: "вчера ✓",
    result: "без ответа",
  },
  templateToken: "{{имя}}",
  meetup: {
    eyebrow: "Business meetup",
    title: "Нетворкинг ради нетворкинга",
    time: "6 часов",
    result: "2 визитки",
  },
  marketing: {
    eyebrow: "Маркетинг / месяц",
    spend: "₽240 000",
    spendLabel: "потрачено на охваты",
    resultLabel: "сделок",
    result: "0",
  },
  title: "Холодный маркетинг в B2B не работает?",
  description:
    "Сообщения в Telegram остаются без ответа, рассылки неэффективны, а деловые мероприятия съедают целый день. Лиды обходятся дорого, их не хватает.",
  conclusion:
    "Дело не в продукте и не в каналах, а в отсутствии системы продвижения.",
  punchline: "Мы сделали email рассылки в B2B простыми и эффективными благодаря автоматизации и технологиям",
} as const;

export const notForYouCopy = {
  titleStart: "Вам",
  titleAccent: "не нужен",
  titleEnd: "Smailee, если…",
  cards: [
    { label: "Маркетинг работает как часы", text: "Вы уже используете все доступные каналы и email вам точно не нужен.", tone: "bg-[#edf6f1]", visual: "inbox" },
    { label: "Клиент сам вас найдет", text: "О вас знает каждый прохожий и лишняя реклама ни к чему.", tone: "bg-[#f1f5ff]", visual: "template" },
    { label: "Конкурентов нет", text: "Клиенту некуда больше пойти, если менеджер ему не ответит.", tone: "bg-[#eff7f1]", visual: "funnel" },
    { label: "У вас слишком много клиентов", text: "Запись к вам расписана на год вперед, а вы не успеваете обслуживать.", tone: "bg-[#f7f8e9]", visual: "calendar" },
  ],
} as const;
