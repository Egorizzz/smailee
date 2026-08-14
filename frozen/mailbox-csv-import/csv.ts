/** Архивный парсер CSV пула ящиков со старым форматом двух паролей. */
export type MailboxCsvRow = {
  email: string;
  senderName: string;
  smtpPassword: string;
  imapPassword: string;
};

export function parseMailboxCsv(text: string): MailboxCsvRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0]
    .split(delimiter)
    .map((header) => header.trim().toLowerCase().replace(/^["']|["']$/g, ""));
  const indexOf = (names: string[]) => headers.findIndex((header) => names.includes(header));
  const emailIndex = indexOf(["email", "e-mail", "почта", "адрес"]);
  const nameIndex = indexOf(["sender name", "sendername", "name", "имя", "отправитель", "от кого"]);
  const smtpIndex = indexOf(["smtp", "smtp-пароль", "smtp пароль", "smtppassword", "smtp_password", "пароль smtp"]);
  const imapIndex = indexOf(["imap", "imap-пароль", "imap пароль", "imappassword", "imap_password", "пароль imap"]);
  if (emailIndex === -1) return [];

  const rows: MailboxCsvRow[] = [];
  for (let index = 1; index < lines.length; index++) {
    const cells = lines[index].split(delimiter).map((cell) => cell.trim().replace(/^["']|["']$/g, ""));
    const email = cells[emailIndex]?.toLowerCase();
    if (!email || !email.includes("@")) continue;
    rows.push({
      email,
      senderName: nameIndex > -1 ? cells[nameIndex] ?? "" : "",
      smtpPassword: smtpIndex > -1 ? cells[smtpIndex] ?? "" : "",
      imapPassword: imapIndex > -1 ? cells[imapIndex] ?? "" : "",
    });
  }
  return rows;
}
