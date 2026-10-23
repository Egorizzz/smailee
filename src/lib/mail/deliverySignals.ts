export type DeliveryIssue =
  | "SPAM_REJECTED"
  | "INVALID_RECIPIENT"
  | "REJECTED"
  | "BOUNCED"
  | "DELAYED";

export function classifyDeliveryIssue(
  text: string,
  status?: string,
): DeliveryIssue {
  if (/spam|спам/i.test(text)) return "SPAM_REJECTED";
  if (
    /5\.1\.[13]|user unknown|no such (?:user|mailbox)|recipient.*(?:not found|does not exist)|mailbox.*(?:not found|does not exist)/i.test(
      `${status ?? ""} ${text}`,
    )
  )
    return "INVALID_RECIPIENT";
  if (/^4\./.test(status ?? "")) return "DELAYED";
  return "BOUNCED";
}

export function deliveryIssueLabel(issue: string | null): string {
  return (
    (
      {
        SPAM_REJECTED: "Отклонено антиспамом",
        INVALID_RECIPIENT: "Адрес не существует",
        REJECTED: "Отправка отклонена",
        BOUNCED: "Возврат письма",
        DELAYED: "Доставка задерживается",
      } as Record<string, string>
    )[issue ?? ""] ?? "Требуется проверка отправки"
  );
}

export type DeliveryReport = {
  recipient: string;
  action: string;
  status: string;
  diagnostic: string;
  originalIds: string[];
};

/** RFC 3464 machine-readable recipient sections, never LLM classification. */
export function parseDeliveryReports(source: string): DeliveryReport[] {
  const unfolded = source.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ");
  const ids = [
    ...unfolded.matchAll(/(?:Original-Message-ID|Original-Envelope-Id|Message-ID):\s*(<[^>\n]+>)/gi),
  ].map((m) => m[1]);
  const reports = unfolded
    .split(/(?=^Final-Recipient:)/im)
    .slice(1)
    .flatMap((block) => {
      const recipient = block
        .match(/^Final-Recipient:\s*[^;\n]+;\s*([^\s\n]+)/im)?.[1]
        ?.replace(/[<>]/g, "")
        .toLowerCase();
      const action = block.match(/^Action:\s*(\w+)/im)?.[1]?.toLowerCase();
      const status = block.match(/^Status:\s*([245]\.\d+\.\d+)/im)?.[1];
      if (!recipient || !action || !status) return [];
      const diagnostic = block.match(/^Diagnostic-Code:\s*(.+)/im)?.[1] ?? "";
      return [
        {
          recipient,
          action,
          status,
          diagnostic: diagnostic.slice(0, 2000),
          originalIds: [...new Set(ids)],
        },
      ];
    });
  return [
    ...new Map(
      reports.map((r) => [
        `${r.recipient}:${r.action}:${r.status}:${r.diagnostic}`,
        r,
      ]),
    ).values(),
  ];
}
