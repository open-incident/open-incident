import { redirect } from "next/navigation";

/**
 * The post-incident flow is a phase of the lifecycle, and lives on the
 * lifecycle sheet now (Types & lifecycle, "Post-incident"). Bookmarks and the
 * guide's older editions land where it went.
 */
export default function PostIncidentMoved() {
  redirect("/app/settings/types#post-incident");
}
