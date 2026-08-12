import { hashPassword } from "@/lib/passwords";
import { prisma } from "@/lib/prisma";
import { DEMO_DURATION_DAYS } from "@/server/billing";

export type ProvisionClientInput = {
  email: string;
  name: string | null;
  companyName: string | null;
  initialPassword: string;
};

export async function provisionDemoClient(input: ProvisionClientInput) {
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + DEMO_DURATION_DAYS);
  const passwordHash = await hashPassword(input.initialPassword);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        mustChangePassword: false,
        name: input.name,
        companyName: input.companyName,
        role: "CLIENT",
        organizationRole: "ORG_ADMIN",
        plan: "START",
        planExpiresAt: expiresAt,
        demoUsedAt: now,
        isDemo: true,
      },
    });
    const organization = await tx.organization.create({
      data: {
        name: input.companyName || input.name || input.email,
        ownerId: user.id,
      },
    });
    return tx.user.update({
      where: { id: user.id },
      data: { organizationId: organization.id },
      include: { ownedOrganization: true },
    });
  });
}

export async function replaceWithTemporaryPassword(userId: string, temporaryPassword: string) {
  const passwordHash = await hashPassword(temporaryPassword);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: userId, role: "CLIENT" },
      data: { passwordHash, mustChangePassword: true },
    });
    if (updated.count !== 1) return false;
    await tx.authToken.deleteMany({ where: { userId, usedAt: null } });
    return true;
  });
}
