export type PersonName = { firstName: string; lastName: string };

const TRANSLIT: Record<string, string> = {
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
};

export function transliterateName(value: string) {
  return value.toLocaleLowerCase("ru-RU").split("").map((letter) => TRANSLIT[letter] ?? letter).join("")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]/g, "");
}

export function renderEmailPattern(pattern: string, person: PersonName, domain: string): string | undefined {
  const first = transliterateName(person.firstName);
  const last = transliterateName(person.lastName);
  if (!first || !last) return undefined;
  const replacements: Record<string, string> = {
    "{first}": first, "{last}": last, "{f}": first[0], "{l}": last[0],
    "{first_name}": first, "{last_name}": last,
  };
  let local = pattern.toLowerCase();
  for (const [token, value] of Object.entries(replacements)) local = local.split(token).join(value);
  local = local.replace(/@.*$/, "").replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "");
  return local ? `${local}@${domain.toLowerCase()}` : undefined;
}

export function inferEmailPatterns(contacts: Array<{ email: string; firstName?: string; lastName?: string }>) {
  const candidates = ["{first}.{last}", "{first}{last}", "{f}.{last}", "{f}{last}", "{first}", "{last}.{first}", "{last}{f}"];
  const scores = new Map<string, number>();
  for (const contact of contacts) {
    if (!contact.firstName || !contact.lastName) continue;
    const domain = contact.email.split("@")[1];
    if (!domain) continue;
    for (const pattern of candidates) {
      if (renderEmailPattern(pattern, { firstName: contact.firstName, lastName: contact.lastName }, domain) === contact.email.toLowerCase()) {
        scores.set(pattern, (scores.get(pattern) ?? 0) + 1);
      }
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([pattern]) => pattern);
}

export function candidateEmailsForPerson(input: {
  person: PersonName;
  domain: string;
  providerPattern?: string;
  knownContacts?: Array<{ email: string; firstName?: string; lastName?: string }>;
}) {
  const patterns = [input.providerPattern, ...inferEmailPatterns(input.knownContacts ?? [])].filter((item): item is string => Boolean(item));
  return [...new Set(patterns.flatMap((pattern) => renderEmailPattern(pattern, input.person, input.domain) ?? []))];
}
