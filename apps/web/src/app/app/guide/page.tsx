import { redirect } from "next/navigation";

/**
 * The old entrance to the guide, kept as a door.
 *
 * It used to be a page of its own: four cards saying what the product is, the
 * words it uses, where things live and what to read next, and under them a
 * link to the chapters. Every one of those is the first chapter's job, and a
 * reader who clicks "Guide" wants the guide — so the rail goes there directly
 * now and this address follows, because links to it exist in the wild.
 */
export default function GuideRedirect() {
  redirect("/app/docs");
}
