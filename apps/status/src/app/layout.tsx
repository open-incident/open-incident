import type { Metadata } from "next";
import "./globals.css";
import { currentSnapshot } from "@/lib/snapshot";

export async function generateMetadata(): Promise<Metadata> {
  const cur = await currentSnapshot();
  return {
    // The operator named the page; most names already end in "Status" and
    // "Skylark Status Status" is what appending it blindly produced.
    title: cur?.snap.page.name || "Status",
    robots:
      cur?.snap.page.noindex === false
        ? { index: true, follow: true }
        : { index: false, follow: false },
    icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cur = await currentSnapshot();
  const lang = cur?.snap.page.locale ?? "en";
  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
