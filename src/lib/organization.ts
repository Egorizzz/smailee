import "server-only";
import { redirect } from "next/navigation";
import type { OrganizationPermission, OrganizationRole, User } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type OrganizationCapability = OrganizationPermission;

export type Workspace = {
  actor: User;
  owner: User;
  organizationId: string | null;
  organizationName: string;
  role: OrganizationRole;
};

/**
 * Returns the current operator and the user id that owns the organization's
 * existing data. The latter intentionally stays the same after the migration:
 * legacy rows do not need to be copied to become shared by the team.
 */
export async function requireWorkspace(): Promise<Workspace> {
  const actor = await requireUser();
  if (!actor.organizationId) {
    // Only possible before the migration is deployed. It preserves access to
    // old accounts during a rolling deployment.
    return {
      actor,
      owner: actor,
      organizationId: null,
      organizationName: actor.companyName || actor.email,
      role: "ORG_ADMIN",
    };
  }

  const organization = await prisma.organization.findUnique({
    where: { id: actor.organizationId },
    include: { owner: true },
  });
  if (!organization) redirect("/login");

  return {
    actor,
    owner: organization.owner,
    organizationId: organization.id,
    organizationName: organization.name,
    role: actor.organizationRole,
  };
}

export function can(workspace: Workspace, capability: OrganizationCapability) {
  return workspace.role === "ORG_ADMIN" || workspace.actor.organizationPermissions.includes(capability);
}

export async function requireCapability(capability: OrganizationCapability) {
  const workspace = await requireWorkspace();
  if (!can(workspace, capability)) redirect("/app");
  return workspace;
}

export async function requireOrganizationAdmin() {
  const workspace = await requireWorkspace();
  if (workspace.role !== "ORG_ADMIN") redirect("/app");
  return workspace;
}

export function campaignScope(workspace: Workspace) {
  return can(workspace, "CAMPAIGNS_VIEW_ALL") || can(workspace, "CAMPAIGNS_MANAGE_ALL")
    ? {}
    : { createdById: workspace.actor.id };
}

export function canAccessCampaign(workspace: Workspace, campaign: { createdById: string | null }) {
  return can(workspace, "CAMPAIGNS_MANAGE_ALL") || campaign.createdById === workspace.actor.id;
}
