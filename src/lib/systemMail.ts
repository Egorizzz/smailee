import nodemailer from "nodemailer";
import { config } from "@/lib/config";

export type SystemMail = {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
  /** Разрешённый продуктом альтернативный From при тех же SMTP-реквизитах. */
  from?: string;
  replyTo?: string;
};

/** Sends product emails independently from customer mailing boxes. */
export async function sendSystemMail(mail: SystemMail) {
  const from = mail.from ?? config.systemMail.from;
  if (!config.systemMail.host || !config.systemMail.user || !config.systemMail.password || !from) {
    console.warn("[system-mail] SMTP is not configured; email was not sent", { to: mail.to, subject: mail.subject });
    return { ok: false as const, error: "SYSTEM_SMTP is not configured" };
  }
  const transporter = nodemailer.createTransport({
    host: config.systemMail.host,
    port: config.systemMail.port,
    secure: config.systemMail.secure,
    auth: { user: config.systemMail.user, pass: config.systemMail.password },
  });
  try {
    await transporter.sendMail({ ...mail, from });
    return { ok: true as const };
  } catch (error) {
    console.error("[system-mail] send failed", error);
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  } finally {
    transporter.close();
  }
}
