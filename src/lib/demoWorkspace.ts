import "server-only";
import { prisma } from "@/lib/prisma";

export type DemoCampaignStats = {
  audience: number;
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  warm: number;
  generatedExamples: number;
  replyExamples: number;
};

export function parseDemoCampaignStats(value: unknown): DemoCampaignStats | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const number = (key: keyof DemoCampaignStats) => {
    const candidate = data[key];
    return typeof candidate === "number" && Number.isFinite(candidate) ? Math.max(0, Math.trunc(candidate)) : 0;
  };
  return {
    audience: number("audience"),
    sent: number("sent"),
    delivered: number("delivered"),
    opened: number("opened"),
    replied: number("replied"),
    warm: number("warm"),
    generatedExamples: number("generatedExamples"),
    replyExamples: number("replyExamples"),
  };
}

export async function getDemoWorkspace(organizationId: string | null) {
  if (!organizationId) return null;
  return prisma.demoWorkspace.findUnique({
    where: { organizationId },
    include: { mailboxes: { orderBy: { email: "asc" } } },
  });
}

export async function isDemoWorkspaceActive(organizationId: string | null) {
  if (!organizationId) return false;
  const workspace = await prisma.demoWorkspace.findUnique({
    where: { organizationId },
    select: { status: true },
  });
  return workspace?.status === "ACTIVE";
}

export const DEMO_EXAMPLE_EMAILS_MIN = 5;
export const DEMO_EXAMPLE_EMAILS_MAX = 7;
