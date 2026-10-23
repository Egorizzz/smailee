import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deliveryIssueLabel } from "@/lib/mail/deliverySignals";

export async function deliveryIssueCounts(where: Prisma.MessageWhereInput) {
  const { sentAt, ...scope } = where;
  const rows = await prisma.message.groupBy({
    by: ["deliveryIssue"],
    where: {
      AND: [
        scope,
        { deliveryIssue: { not: null } },
        ...(sentAt ? [{ OR: [{ sentAt }, { deliveryIssueAt: sentAt }] }] : []),
      ],
    },
    _count: true,
  });
  return rows.map((r) => ({
    label: deliveryIssueLabel(r.deliveryIssue),
    count: r._count,
  }));
}
