import crypto from "node:crypto";
import type { AuthTokenType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24;

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function issueAuthToken(
  userId: string,
  type: AuthTokenType,
  ttlMs = TOKEN_TTL_MS,
  options: { replaceExisting?: boolean; verifiesEmail?: boolean } = {},
) {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  if (options.replaceExisting !== false) {
    await prisma.authToken.deleteMany({ where: { userId, type, usedAt: null } });
  }
  await prisma.authToken.create({
    data: {
      userId,
      type,
      tokenHash: hash(rawToken),
      expiresAt: new Date(Date.now() + ttlMs),
      verifiesEmail: options.verifiesEmail ?? false,
    },
  });
  return rawToken;
}

export async function inspectAuthToken(rawToken: string) {
  if (!rawToken) return null;
  const token = await prisma.authToken.findUnique({
    where: { tokenHash: hash(rawToken) },
    include: { user: true },
  });
  if (!token || token.usedAt || token.expiresAt <= new Date()) return null;
  return token;
}

export async function consumeAuthToken(rawToken: string) {
  const token = await inspectAuthToken(rawToken);
  if (!token) return null;

  const used = await prisma.authToken.updateMany({
    where: { id: token.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  return used.count === 1 ? token : null;
}
