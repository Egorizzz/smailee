const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "mail.ru", "inbox.ru", "list.ru", "bk.ru",
  "yandex.ru", "ya.ru", "rambler.ru", "outlook.com", "hotmail.com", "icloud.com",
]);

/** Returns a business domain only when all usable addresses agree on one domain. */
export function businessDomainFromEmails(emails: string[]) {
  const domains = new Set(emails.flatMap((email) => {
    const domain = email.trim().toLowerCase().split("@")[1];
    return domain && !PUBLIC_EMAIL_DOMAINS.has(domain) && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)
      ? [domain]
      : [];
  }));
  return domains.size === 1 ? [...domains][0] : undefined;
}

export function isPublicEmailDomain(domain: string) {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}
