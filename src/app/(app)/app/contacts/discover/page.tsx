import { can, requireCapability } from "@/lib/organization";
import { ProspectingWorkspace } from "@/components/ProspectingWorkspace";
import { isDemoWorkspaceActive } from "@/lib/demoWorkspace";
import { redirect } from "next/navigation";

export default async function DiscoverContactsPage() {
  const workspace = await requireCapability("CONTACTS_VIEW");
  if (await isDemoWorkspaceActive(workspace.organizationId)) redirect("/app/contacts");
  return <ProspectingWorkspace isAdmin={workspace.actor.role === "ADMIN"} canManage={can(workspace, "CONTACTS_MANAGE")} />;
}
