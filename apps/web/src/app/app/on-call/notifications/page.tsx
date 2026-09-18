import { redirect } from "next/navigation";

/**
 * The old address of "My notifications", kept alive.
 *
 * The three On-call screens became four tabs of one page; the links, the
 * bookmarks and the e-mails already sent still point here, so this route
 * answers by sending the reader to the tab that replaced it.
 */
export default async function NotificationsRedirect() {
  redirect("/app/on-call?tab=notifications");
}
