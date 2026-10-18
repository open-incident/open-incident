"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { flash } from "@/components/settings/controls";

/**
 * Says what a redirect just did — "Saved.", "Rule deleted." — once, then
 * drops the query string so a reload does not say it again.
 */
export function FlashOnMount({ message }: { message: string }) {
  const router = useRouter();
  const path = usePathname();
  const said = useRef(false);
  useEffect(() => {
    if (said.current) return;
    said.current = true;
    flash(message);
    router.replace(path, { scroll: false });
  }, [message, path, router]);
  return null;
}
