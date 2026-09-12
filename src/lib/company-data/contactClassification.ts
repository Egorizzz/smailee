import { roleMatchesPreference } from "./prospectingCatalog";

export type ContactForClassification = {
  email: string;
  kind?: string;
  name?: string;
  role?: string;
  confidence?: number;
  verificationStatus?: string;
};

export type ContactClassification = {
  category: "personal" | "department" | "general" | "service" | "system";
  bucket: "personal" | "shared" | "reject";
  score: number;
  reason: string;
};

const SYSTEM_WORDS = /(?:^|[._+-])(?:no.?reply|do.?not.?reply|mailer.?daemon|bounce|bounces|postmaster|abuse|daemon|robot|bot|notification|notifications|notify|autoresponder|unsubscribe)(?:$|[._+-])/i;
const GENERAL_WORDS = /(?:^|[._+-])(?:info|hello|contact|office|mail|team|welcome|reception|sekretar|secretary|priemnaya|general)(?:$|[._+-])/i;
const DEPARTMENT_WORDS = /(?:^|[._+-])(?:sales|sale|marketing|market|pr|hr|career|jobs|recruit|partner|partners|business|commercial|director|ceo|manager|development|b2b|opt|wholesale)(?:$|[._+-])/i;
const SERVICE_WORDS = /(?:^|[._+-])(?:order|orders|support|help|billing|invoice|accounting|bookkeeping|delivery|booking|reserve|claims|security|privacy|legal|documents|doc|warehouse|logistics|service|tech)(?:$|[._+-])/i;
const PERSON_SHAPE = /^[\p{L}]{2,}[._-][\p{L}]{2,}$/u;

/**
 * A semantic, metadata-aware classifier. The regexes identify concepts rather
 * than an exhaustive allow-list: provider type/name/role and address shape are
 * weighted together, while desired roles can promote a useful department.
 */
export function classifyProspectingContact(
  contact: ContactForClassification,
  desiredRoles: readonly string[] = [],
): ContactClassification {
  const local = contact.email.trim().toLowerCase().split("@")[0] ?? "";
  const kind = contact.kind?.toLowerCase() ?? "";
  const base = Math.round((contact.confidence ?? 0.5) * 100);
  const verified = contact.verificationStatus?.toLowerCase() === "valid" ? 25 : 0;
  const preferredRole = roleMatchesPreference(contact.role, [...desiredRoles]) ? 45 : 0;

  if (!local || SYSTEM_WORDS.test(local)) {
    return { category: "system", bucket: "reject", score: -1_000, reason: "machine_mailbox" };
  }

  const namedPerson = Boolean(contact.name?.trim().match(/^[\p{L}'’-]{2,}\s+[\p{L}'’-]{2,}(?:\s+[\p{L}'’-]{2,})?$/u));
  const personalMetadata = kind === "person" || kind === "personal" || namedPerson;
  if (personalMetadata || (PERSON_SHAPE.test(local) && !GENERAL_WORDS.test(local) && !DEPARTMENT_WORDS.test(local) && !SERVICE_WORDS.test(local))) {
    return { category: "personal", bucket: "personal", score: base + verified + preferredRole + 30, reason: personalMetadata ? "person_metadata" : "person_address_shape" };
  }

  if (DEPARTMENT_WORDS.test(local) || preferredRole > 0 || /(?:отдел|директор|продаж|маркет|персонал|развити)/i.test(contact.role ?? "")) {
    return { category: "department", bucket: "shared", score: base + verified + preferredRole + 15, reason: "business_department" };
  }

  if (GENERAL_WORDS.test(local)) {
    return { category: "general", bucket: "shared", score: base + verified + 5, reason: "general_business_mailbox" };
  }

  if (SERVICE_WORDS.test(local) || /(?:поддерж|бухгал|достав|заказ|склад|юрист|технич)/i.test(contact.role ?? "")) {
    return { category: "service", bucket: "reject", score: -100 + base, reason: "operational_mailbox" };
  }

  // Unknown aliases are retained as low-priority shared contacts. This keeps
  // the classifier useful for brand-specific mailboxes without pretending that
  // every unfamiliar local part is a person.
  return { category: "general", bucket: "shared", score: base + verified, reason: "unknown_business_alias" };
}

export function rankProspectingContacts<T extends ContactForClassification>(
  contacts: readonly T[],
  desiredRoles: readonly string[] = [],
) {
  return contacts
    .map((contact) => ({ contact, classification: classifyProspectingContact(contact, desiredRoles) }))
    .filter((item) => item.classification.bucket !== "reject")
    .sort((a, b) => b.classification.score - a.classification.score);
}

export function contactCapacityAvailable(
  bucket: ContactClassification["bucket"],
  counts: { personal: number; shared: number },
) {
  return bucket === "personal" ? counts.personal < 5 : bucket === "shared" ? counts.shared < 3 : false;
}
