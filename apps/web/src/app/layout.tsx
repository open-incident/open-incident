import type { Metadata } from "next";
import { getLocale } from "@/i18n/server";
import { currentMember } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Incident",
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
};

/**
 * `lang` and `dir` come from the workspace's language (and the member's
 * override), not from a constant: they drive word breaking, speech synthesis
 * and the spell checking of input fields.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // The member's theme, when they chose one; the device's otherwise — decided
  // before paint by a one-line script so the page never flashes light.
  const theme = await currentMember()
    .then((c) => c?.member.theme ?? null)
    .catch(() => null);
  return (
    <html
      lang={locale.code}
      dir={locale.dir}
      data-theme={theme ?? undefined}
      suppressHydrationWarning
    >
      <head>
        {!theme && (
          <script
            dangerouslySetInnerHTML={{
              __html:
                "if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.dataset.theme='dark'",
            }}
          />
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
