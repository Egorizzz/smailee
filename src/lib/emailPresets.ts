/**
 * Готовые HTML-шаблоны писем (пресеты).
 *
 * Это реальные, чистые HTML-письма (inline-стили — обязательно для почтовых
 * клиентов). Показываются в галерее на лендинге и доступны в библиотеке ЛК.
 * Поддерживают переменные {{name}}, {{company}}.
 *
 * ВАЖНО: почтовые клиенты игнорируют внешний CSS и многие свойства — поэтому
 * вёрстка на таблицах + inline-стили. Это норма для email.
 */

export type EmailPreset = {
  key: string;
  name: string;
  category: "outreach" | "announce" | "digest" | "promo";
  subject: string;
  html: string;
};

const MINT = "#22a88d";
const INDIGO = "#4f46e5";
const INK = "#334155";
const MUTED = "#64748b";
const LINE = "#e6e9ef";

// Обёртка-каркас письма (шапка с логотипом + контент + футер с отпиской)
function shell(inner: string) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f6fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${LINE};font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
<tr><td style="background:linear-gradient(135deg,${MINT},${INDIGO});padding:20px 28px;">
<span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.02em;">Smailee</span>
</td></tr>
${inner}
<tr><td style="padding:20px 28px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;line-height:1.6;">
Вы получили это письмо, потому что оставили контакт.
<a href="{{unsubscribe_url}}" style="color:${MUTED};text-decoration:underline;">Отписаться</a>.
</td></tr>
</table>
</td></tr></table></body></html>`;
}

export const EMAIL_PRESETS: EmailPreset[] = [
  {
    key: "outreach",
    name: "Холодное письмо (outreach)",
    category: "outreach",
    subject: "Быстрый вопрос про {{company}}",
    html: shell(`<tr><td style="padding:28px;color:${INK};font-size:15px;line-height:1.65;">
<p style="margin:0 0 14px;">Здравствуйте, {{name}}!</p>
<p style="margin:0 0 14px;">Заметил, что {{company}} активно развивается. Мы помогаем компаниям вашего профиля получать больше ответов из холодных email-рассылок — без найма отдельного маркетолога.</p>
<p style="margin:0 0 20px;">Уместно показать за 10 минут, как это может сработать у вас?</p>
<a href="{{cta_url}}" style="display:inline-block;background:${INDIGO};color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;font-size:14px;">Обсудить</a>
<p style="margin:20px 0 0;color:${MUTED};font-size:13px;">С уважением,<br>команда Smailee</p>
</td></tr>`),
  },
  {
    key: "announce",
    name: "Анонс продукта / новости",
    category: "announce",
    subject: "{{company}}: у нас важное обновление",
    html: shell(`<tr><td style="padding:0;">
<div style="background:linear-gradient(135deg,#eef1ff,#f0fdf9);padding:32px 28px;text-align:center;">
<div style="font-size:22px;font-weight:700;color:#0f172a;">Мы запустили новинку 🚀</div>
<div style="margin-top:8px;color:${MUTED};font-size:14px;">Специально для клиентов вроде {{company}}</div>
</div>
<div style="padding:28px;color:${INK};font-size:15px;line-height:1.65;">
<p style="margin:0 0 14px;">Здравствуйте, {{name}}!</p>
<p style="margin:0 0 20px;">Рассказываем коротко о том, что изменилось и почему это сэкономит вам время уже на этой неделе.</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
<td style="padding:14px;background:#f7f9fc;border-radius:12px;color:${INK};font-size:14px;">✓ Быстрее запуск&nbsp;&nbsp;✓ Больше ответов&nbsp;&nbsp;✓ Меньше рутины</td>
</tr></table>
<div style="text-align:center;margin-top:22px;">
<a href="{{cta_url}}" style="display:inline-block;background:${MINT};color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;font-size:14px;">Узнать подробнее</a>
</div>
</div></td></tr>`),
  },
  {
    key: "digest",
    name: "Дайджест / подборка",
    category: "digest",
    subject: "Полезная подборка для {{company}}",
    html: shell(`<tr><td style="padding:28px;color:${INK};font-size:15px;line-height:1.65;">
<p style="margin:0 0 18px;">Здравствуйте, {{name}}! Собрали для вас три материала:</p>
${[1, 2, 3]
  .map(
    (i) => `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:12px;"><tr>
<td style="padding:16px;border:1px solid ${LINE};border-radius:12px;">
<div style="font-weight:600;color:#0f172a;font-size:15px;">Материал №${i}</div>
<div style="color:${MUTED};font-size:13px;margin-top:4px;">Короткое описание, зачем это читать и какую пользу принесёт.</div>
<a href="{{cta_url}}" style="color:${INDIGO};text-decoration:none;font-size:13px;font-weight:600;">Читать →</a>
</td></tr></table>`
  )
  .join("")}
</td></tr>`),
  },
  {
    key: "promo",
    name: "Промо / спецпредложение",
    category: "promo",
    subject: "🎁 Специальное предложение для {{company}}",
    html: shell(`<tr><td style="padding:0;">
<div style="background:linear-gradient(135deg,${INDIGO},${MINT});padding:40px 28px;text-align:center;">
<div style="color:#fff;font-size:26px;font-weight:800;letter-spacing:-.02em;">−30% до конца недели</div>
<div style="color:#e0e7ff;margin-top:6px;font-size:14px;">Только для {{company}}</div>
</div>
<div style="padding:28px;color:${INK};font-size:15px;line-height:1.65;text-align:center;">
<p style="margin:0 0 20px;">Здравствуйте, {{name}}! Дарим скидку на первый месяц — успейте активировать.</p>
<a href="{{cta_url}}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:14px 30px;border-radius:12px;font-weight:700;font-size:15px;">Активировать скидку</a>
<p style="margin:18px 0 0;color:${MUTED};font-size:12px;">Предложение действует ограниченное время.</p>
</div></td></tr>`),
  },
];

export function getPresetByKey(key: string): EmailPreset | undefined {
  return EMAIL_PRESETS.find((p) => p.key === key);
}
