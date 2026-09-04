"use client";

import { useEffect } from "react";

/**
 * Keeps the document's theme in step with the member's choice after a soft
 * navigation: the root layout stamps `data-theme` on the first load only, and
 * a save followed by a redirect never reloads the document.
 */
export function ThemeSync({ theme }: { theme: "light" | "dark" | null }) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme) {
      root.dataset.theme = theme;
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      if (media.matches) root.dataset.theme = "dark";
      else delete root.dataset.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return null;
}
