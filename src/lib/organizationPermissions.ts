import type { OrganizationPermission, OrganizationRole } from "@prisma/client";

export const ORGANIZATION_PERMISSIONS = [
  "CONTACTS_VIEW", "CONTACTS_MANAGE", "CAMPAIGNS_VIEW_ALL", "CAMPAIGNS_CREATE",
  "CAMPAIGNS_MANAGE_OWN", "CAMPAIGNS_MANAGE_ALL", "CAMPAIGN_RECIPIENTS_VIEW",
  "STATS_VIEW_ALL", "LEADS_VIEW_ALL", "LEADS_REPLY_OWN", "LEADS_REPLY_ALL",
  "INFRASTRUCTURE_MANAGE", "BILLING_MANAGE",
] as const satisfies readonly OrganizationPermission[];

const implied: Partial<Record<OrganizationPermission, OrganizationPermission[]>> = {
  CONTACTS_MANAGE: ["CONTACTS_VIEW"],
  CAMPAIGNS_MANAGE_ALL: ["CAMPAIGNS_VIEW_ALL", "CAMPAIGNS_MANAGE_OWN"],
  LEADS_REPLY_ALL: ["LEADS_VIEW_ALL", "LEADS_REPLY_OWN"],
};

export function effectivePermissions(permissions: readonly OrganizationPermission[]) {
  const result = new Set<OrganizationPermission>(permissions);
  for (const permission of result) {
    for (const extra of implied[permission] ?? []) result.add(extra);
  }
  return result;
}

export function hasOrganizationPermission(
  role: OrganizationRole,
  permissions: readonly OrganizationPermission[],
  capability: OrganizationPermission,
) {
  return role === "ORG_ADMIN" || effectivePermissions(permissions).has(capability);
}

export function defaultWorkspacePath(role: OrganizationRole, permissions: readonly OrganizationPermission[]) {
  const can = (capability: OrganizationPermission) => hasOrganizationPermission(role, permissions, capability);
  if (can("LEADS_VIEW_ALL") || can("LEADS_REPLY_OWN")) return "/app/inbox";
  if (can("STATS_VIEW_ALL")) return "/app/analytics";
  if (can("CAMPAIGNS_VIEW_ALL") || can("CAMPAIGNS_CREATE") || can("CAMPAIGNS_MANAGE_OWN")) return "/app/campaigns";
  if (can("CONTACTS_VIEW")) return "/app/contacts";
  if (can("INFRASTRUCTURE_MANAGE")) return "/app/mailboxes";
  if (can("BILLING_MANAGE")) return "/app/billing";
  return "/app/no-access";
}
