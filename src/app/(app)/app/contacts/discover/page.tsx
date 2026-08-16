import { can, requireCapability } from "@/lib/organization";
import { ProspectingWorkspace } from "@/components/ProspectingWorkspace";

export default async function DiscoverContactsPage() {
  const workspace = await requireCapability("CONTACTS_VIEW");
  return <ProspectingWorkspace isAdmin={workspace.actor.role === "ADMIN"} canManage={can(workspace, "CONTACTS_MANAGE")} />;
}
