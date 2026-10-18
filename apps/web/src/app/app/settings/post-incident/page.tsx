import { redirect } from "next/navigation";

/**
 * The post-incident flow is a phase of the lifecycle, and lives on Types &
 * lifecycle now: its tasks open from the "Post-incident" phase. Bookmarks and
 * the guide's older editions land there, with the tasks open.
 */
export default function PostIncidentMoved() {
  redirect("/app/settings/types?open=post-incident");
}
