import { Prisma } from "@prisma/client";
import { hashPassword } from "@/lib/passwords";
import { prisma } from "@/lib/prisma";
import { emptyBusinessProfile } from "@/lib/businessProfile/types";

export type ProvisionClientInput = {
  email: string;
  name: string | null;
  companyName: string | null;
  initialPassword: string;
};

export async function provisionTrialClient(input: ProvisionClientInput) {
  const passwordHash = await hashPassword(input.initialPassword);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        passwordEnabled: false,
        emailVerifiedAt: null,
        mustChangePassword: false,
        name: input.name,
        companyName: input.companyName,
        role: "CLIENT",
        organizationRole: "ORG_ADMIN",
        plan: "TRIAL",
        planExpiresAt: null,
        demoUsedAt: null,
        isDemo: false,
      },
    });
    const organization = await tx.organization.create({
      data: {
        name: input.companyName || input.name || input.email,
        ownerId: user.id,
      },
    });
    const initialProfile = emptyBusinessProfile({ companyName: input.companyName });
    await tx.organizationProfile.create({
      data: {
        organizationId: organization.id,
        manualData: initialProfile as Prisma.InputJsonValue,
        draftData: initialProfile as Prisma.InputJsonValue,
      },
    });
    return tx.user.update({
      where: { id: user.id },
      data: { organizationId: organization.id },
      include: { ownedOrganization: true },
    });
  });
}
