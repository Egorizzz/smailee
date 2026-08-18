import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { checkContactLimit } from "@/server/limits";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { isDemoWorkspaceActive } from "@/lib/demoWorkspace";

const schema = z.object({
  segment: z.string().trim().min(1).max(100),
  contacts: z.array(z.object({ email: z.string().email(), company: z.string().max(300).optional() })).min(1).max(500),
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
    const limit = await checkContactLimit(owner, unique.length);
    if (!limit.ok) return Response.json({ error: limit.error }, { status: 400 });
    const suppressed = new Set((await prisma.suppression.findMany({ where: { userId: owner.id, releasedAt: null }, select: { email: true } })).map((x) => x.email.toLowerCase()));
    for (const item of unique) {
      const email = item.email.toLowerCase();
      await prisma.contact.upsert({
        where: { userId_email: { userId: owner.id, email } },
        create: { userId: owner.id, email, company: item.company, segment: body.segment, emailValid: true, status: suppressed.has(email) ? "UNSUBSCRIBED" : "ACTIVE" },
        update: { company: item.company, segment: body.segment },
      });
    }
    revalidatePath("/app/contacts");
    return Response.json({ imported: unique.length, segment: body.segment });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось добавить контакты" }, { status: 400 });
  }
}
