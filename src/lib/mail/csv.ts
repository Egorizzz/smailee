/**
 * Парсер CSV пула ящиков (ТЗ §5.1). Ожидаемые колонки (в любом порядке,
 * регистронезависимо): email, Sender Name, SMTP-пароль, IMAP-пароль.
 * host/port подставляются по профилю провайдера (не из CSV).
 */

export type MailboxCsvRow = {
  email: string;
  senderName: string;
  smtpPassword: string;
  imapPassword: string;
};

export function parseMailboxCsv(text: string): MailboxCsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ""));

  const idx = (names: string[]) => headers.findIndex((h) => names.includes(h));
  const emailI = idx(["email", "e-mail", "почта", "адрес"]);
  const nameI = idx(["sender name", "sendername", "name", "имя", "отправитель", "от кого"]);
  const smtpI = idx(["smtp", "smtp-пароль", "smtp пароль", "smtppassword", "smtp_password", "пароль smtp"]);
  const imapI = idx(["imap", "imap-пароль", "imap пароль", "imappassword", "imap_password", "пароль imap"]);

  if (emailI === -1) return [];

  const rows: MailboxCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]
      .split(delimiter)
      .map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const email = cells[emailI]?.toLowerCase();
    if (!email || !email.includes("@")) continue;
    rows.push({
      email,
      senderName: nameI > -1 ? cells[nameI] ?? "" : "",
      smtpPassword: smtpI > -1 ? cells[smtpI] ?? "" : "",
      imapPassword: imapI > -1 ? cells[imapI] ?? "" : "",
    });
  }
  return rows;
}
