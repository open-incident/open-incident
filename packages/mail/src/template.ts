/**
 * Branded HTML shell for the emails the product sends about itself — welcome,
 * address confirmation, and anything else addressed to a person rather than to
 * a ticket.
 *
 * Why it looks like 2005 HTML: an email client is not a browser. Outlook renders
 * through Word, Gmail strips <style> blocks and anything it does not know, and
 * several clients ignore flexbox and grid entirely. So: tables for layout,
 * inline styles only, no external CSS, no web font, no JavaScript. Widths in
 * pixels, because percentages collapse in Outlook.
 *
 * The wordmark is a hosted PNG when the caller supplies one (`logoUrl`), since
 * the real logo is an SVG and no client renders SVG. It degrades on purpose:
 * with no URL — a self-hosted instance has no public host — the header falls
 * back to the mark drawn in HTML, which survives the image blocking most
 * clients apply by default.
 *
 * Everything here is plain data in, string out: no database, no request, so the
 * same function serves the product and the control plane.
 */

/*
 * The product palette in hex — email clients understand nothing else. Keep
 * these in step with packages/ui/src/tokens.css if the brand moves.
 */
const BRAND = "#1f4b99"; // --brand
const DEEP = "#0b1220"; // near-black of the mark
const INK = "#111827";
const INK_2 = "#4b5563";
const LINE = "#e3e6eb";
const CANVAS = "#f4f5f7"; // --canvas

/*
 * Naming the product face is worth doing and worth being honest about: email
 * clients strip @font-face — Gmail, Outlook and Yahoo all do — so the family
 * applies only where the reader already has it installed. Everyone else gets
 * the fallback, which is why the fallback is a real stack and not an afterthought.
 */
const FONT = "Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

export type EmailButton = { label: string; url: string };

/** One "label : value" line of the credentials block. */
export type EmailFact = { label: string; value: string };

export type BrandedEmail = {
  /** Big line at the top of the card. */
  title: string;
  /** Sentences under the title. Each becomes its own paragraph. */
  intro: string[];
  /** Optional bullet list — what the product does for them. */
  bullets?: string[];
  /** Optional "your sign-in details" block. */
  factsTitle?: string;
  facts?: EmailFact[];
  button?: EmailButton;
  /** Small print under the button. */
  footnote?: string;
  /** Sender name shown in the footer, usually the workspace or the product. */
  signature: string;
  /**
   * Absolute URL of the wordmark, ~340 px wide. Optional on purpose: a
   * self-hosted instance has no public host to serve it from, and most clients
   * block remote images anyway — without it the header falls back to the mark
   * drawn in HTML, which survives that blocking.
   */
  logoUrl?: string;
};

/** Escapes text interpolated into the HTML — a workspace name is user input. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The plain-text twin of the same message. Never a stripped tag soup: it is
 * written from the same data, so a text-only reader gets a real letter.
 */
export function brandedText(mail: BrandedEmail): string {
  const parts: string[] = [mail.title, "", ...mail.intro];
  if (mail.bullets?.length) parts.push("", ...mail.bullets.map((b) => `- ${b}`));
  if (mail.facts?.length) {
    parts.push("", mail.factsTitle ?? "");
    parts.push(...mail.facts.map((f) => `${f.label} : ${f.value}`));
  }
  if (mail.button) parts.push("", `${mail.button.label} : ${mail.button.url}`);
  if (mail.footnote) parts.push("", mail.footnote);
  parts.push("", `— ${mail.signature}`);
  return parts.filter((p) => p !== undefined).join("\n");
}

export function brandedHtml(mail: BrandedEmail): string {
  const bullets = mail.bullets?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">${mail.bullets
        .map(
          (b) => `<tr>
            <td style="padding:0 10px 10px 0;vertical-align:top;color:${BRAND};font-size:15px;line-height:22px">&#10003;</td>
            <td style="padding:0 0 10px;color:${INK_2};font-size:15px;line-height:22px">${esc(b)}</td>
          </tr>`,
        )
        .join("")}</table>`
    : "";

  const facts = mail.facts?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="background:${CANVAS};border:1px solid ${LINE};border-radius:10px;margin:0 0 24px">
         <tr><td style="padding:18px 20px">
           ${
             mail.factsTitle
               ? `<div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${INK_2};padding-bottom:12px">${esc(
                   mail.factsTitle,
                 )}</div>`
               : ""
           }
           <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
             ${mail.facts
               .map(
                 (f) => `<tr>
                   <td style="padding:3px 12px 3px 0;color:${INK_2};font-size:14px;line-height:21px;white-space:nowrap">${esc(f.label)}</td>
                   <td style="padding:3px 0;color:${INK};font-size:14px;line-height:21px;font-weight:600;word-break:break-all">${esc(f.value)}</td>
                 </tr>`,
               )
               .join("")}
           </table>
         </td></tr>
       </table>`
    : "";

  // A bulletproof button: the padded <a> is what every client can render, and
  // the surrounding table keeps it from stretching in Outlook.
  const button = mail.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">
         <tr><td style="background:${BRAND};border-radius:9px">
           <a href="${esc(mail.button.url)}"
              style="display:inline-block;padding:13px 26px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">${esc(
                mail.button.label,
              )}</a>
         </td></tr>
       </table>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(mail.title)}</title></head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-font-smoothing:antialiased">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CANVAS}">
    <tr><td align="center" style="padding:32px 16px">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560"
             style="width:560px;max-width:100%">

        <tr><td style="padding:0 0 22px">
          ${
            mail.logoUrl
              ? `<img src="${esc(mail.logoUrl)}" alt="Open Incident" width="170"
                      style="display:block;width:170px;height:auto;border:0;outline:none;text-decoration:none">`
              : `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
                   <tr>
                     <td style="background:${DEEP};border-radius:8px;width:32px;height:32px;text-align:center;
                                vertical-align:middle;color:#ffffff;font-size:20px;font-family:${FONT};
                                font-weight:700;line-height:32px">&#9650;</td>
                     <td style="padding-left:10px;color:${INK};font-size:17px;font-weight:700;
                                font-family:${FONT}">Open Incident</td>
                   </tr>
                 </table>`
          }
        </td></tr>

        <tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:14px;padding:32px 32px 26px;
                       font-family:${FONT}">
          <h1 style="margin:0 0 18px;color:${INK};font-size:24px;line-height:31px;font-weight:700">${esc(mail.title)}</h1>
          ${mail.intro
            .map(
              (p) =>
                `<p style="margin:0 0 15px;color:${INK_2};font-size:15px;line-height:23px">${esc(p)}</p>`,
            )
            .join("")}
          ${bullets}
          ${facts}
          ${button}
          ${
            mail.footnote
              ? `<p style="margin:0;color:${INK_2};font-size:13px;line-height:20px">${esc(mail.footnote)}</p>`
              : ""
          }
        </td></tr>

        <tr><td style="padding:18px 8px 0;color:${INK_2};font-size:12px;line-height:18px;
                       font-family:${FONT}">
          ${esc(mail.signature)}
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}
