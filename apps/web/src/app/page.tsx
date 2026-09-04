import { redirect } from "next/navigation";
import { requireTenant } from "@/lib/tenant";

export default async function Home() {
  // Before bouncing to the workspace: an invented subdomain must stop here with
  // a 404, not be forwarded into the app (see requireTenant).
  await requireTenant();
  redirect("/app/incidents");
}
