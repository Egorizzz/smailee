/**
 * HTML-рендер письма контент-маркетинговой серии: картинка (от fal.ai) + текст
 * статьи (от LLM, обычный текст с абзацами через \n\n) + опциональная кнопка
 * CTA "Оставить заявку". Использует тот же брендовый каркас, что и статичные
 * пресеты (src/lib/emailPresets.ts).
 */

import { shell, INDIGO, INK, MUTED } from "./emailPresets";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphs(bodyText: string): string {
  return bodyText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
}

export function renderContentEmailHtml(input: {
  subject: string;
  bodyText: string;
  imageUrl?: string | null;
  includeCta: boolean;
  ctaLabel?: string | null;
}): string {
  const hero = input.imageUrl
    ? `<tr><td style="padding:0;"><img src="${input.imageUrl}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;"></td></tr>`
    : "";

  const cta = input.includeCta
    ? `<div style="text-align:center;margin-top:22px;">
<a href="{{lead_cta_url}}" style="display:inline-block;background:${INDIGO};color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;font-size:14px;">${escapeHtml(
        input.ctaLabel || "Оставить заявку"
      )}</a>
</div>`
    : "";

  return shell(`${hero}<tr><td style="padding:28px;color:${INK};font-size:15px;line-height:1.7;">
<div style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 16px;">${escapeHtml(input.subject)}</div>
${paragraphs(input.bodyText)}
${cta}
<p style="margin:20px 0 0;color:${MUTED};font-size:13px;">С уважением,<br>команда Smailee</p>
</td></tr>`);
}
