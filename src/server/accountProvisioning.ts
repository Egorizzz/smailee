import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { hashPassword } from "@/lib/passwords";
import { prisma } from "@/lib/prisma";
import { emptyBusinessProfile } from "@/lib/businessProfile/types";

export type ProvisionClientInput = {
  email: string | null;
  name: string | null;
  companyName: string | null;
  initialPassword: string;
};

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya",
};

function loginStem(name: string | null) {
  const transliterated = (name || "guest").toLowerCase().split("").map((char) => CYRILLIC_TO_LATIN[char] ?? char).join("");
  return transliterated.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "guest";
}

async function generateUniqueLogin(name: string | null) {
  const stem = loginStem(name);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(3).toString("hex").slice(0, 5);
    const login = `${stem}-${suffix}`;
    if (!(await prisma.user.findUnique({ where: { login }, select: { id: true } }))) return login;
  }
  return `${stem}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function provisionTrialClient(input: ProvisionClientInput) {
  const passwordHash = await hashPassword(input.initialPassword);
  const login = input.email ? null : await generateUniqueLogin(input.name);
  const email = input.email ?? `${login}@pending.smailee.invalid`;

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        login,
        emailPending: !input.email,
        passwordHash,
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
        name: input.companyName || input.name || input.email || login!,
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
