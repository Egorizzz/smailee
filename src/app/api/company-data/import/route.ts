import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { checkUploadedContactLimit } from "@/server/limits";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { isDemoWorkspaceActive } from "@/lib/demoWorkspace";
import { productErrorResponse } from "@/lib/productErrors";
import { processUploadedContact, quotaKey } from "@/lib/contacts/processing";

const schema = z.object({
  segment: z.string().trim().min(1).max(100),
  contacts: z.array(z.object({
    email: z.string().email(),
    company: z.string().max(300).optional(),
    inn: z.string().trim().regex(/^\d{10}(?:\d{2})?$/, "ИНН должен содержать 10 или 12 цифр").optional(),
  })).min(1).max(500),
});

export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ error: "Требуется авторизация" }, { status: 401 });
  if (!hasOrganizationPermission(actor.organizationRole, actor.organizationPermissions, "CONTACTS_MANAGE")) {
    return Response.json({ error: "Недостаточно прав для добавления контактов" }, { status: 403 });
  }
  if (await isDemoWorkspaceActive(actor.organizationId)) {
    return Response.json({ error: "Импорт рабочих контактов недоступен в демо-режиме" }, { status: 409 });
  }
  try {
    const body = schema.parse(await request.json());
    const owner = actor.organizationId
      ? (await prisma.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, include: { owner: true } })).owner
      : actor;
    const unique = [...new Map(body.contacts.map((item) => [item.email.toLowerCase(), item])).values()];
    const organizationId = actor.organizationId ?? `user:${owner.id}`;
    const keys = unique.map((item) => quotaKey(organizationId, item.email));
    const existing = await prisma.contactQuotaEvent.count({ where: { operationKey: { in: keys } } });
    const limit = await checkUploadedContactLimit(owner, Math.max(0, unique.length - existing));
    if (!limit.ok) return Response.json({ error: limit.error }, { status: 400 });
    const suppressed = new Set((await prisma.suppression.findMany({ where: { userId: owner.id, releasedAt: null }, select: { email: true } })).map((x) => x.email.toLowerCase()));
    const processed = [];
    for (const item of unique) processed.push(await processUploadedContact(prisma, { organizationId, userId: owner.id, email: item.email, company: item.company, inn: item.inn, segment: body.segment, suppressed: suppressed.has(item.email.toLowerCase()) }));
    revalidatePath("/app/contacts");
    return Response.json({ imported: unique.length, invalidEmails: processed.filter((item) => item.invalid).map((item) => item.email), segment: body.segment });
  } catch (error) {
    return productErrorResponse(error, "CNT-1102");
  }
}
