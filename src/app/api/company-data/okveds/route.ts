import { getCurrentUser } from "@/lib/auth";
import { hasOrganizationPermission } from "@/lib/organizationPermissions";
import { okvedCatalogSize, okvedChildren, okvedRootSections, searchOkvedCatalog } from "@/lib/company-data/okvedCatalog";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.organizationId) return Response.json({ error: "Требуется организация", code: "AUTH-1001" }, { status: 401 });
  if (!hasOrganizationPermission(user.organizationRole, user.organizationPermissions, "CONTACTS_VIEW")) {
    return Response.json({ error: "Недостаточно прав", code: "AUTH-1003" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "";
  const parent = params.get("parent")?.trim() ?? "";
  const items = query ? searchOkvedCatalog(query) : parent ? okvedChildren(parent) : okvedRootSections();
  return Response.json({ items, total: okvedCatalogSize(), mode: query ? "search" : "tree" });
}
