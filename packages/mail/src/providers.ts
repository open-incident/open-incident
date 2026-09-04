/**
 * Sending transports — one per provider.
 *
 * SMTP covers self-hosting AND most of the players on the market through their relay
 * (Brevo, Mailjet, Mailgun, SES, Postmark, Scaleway…). The native API transports
 * additionally bring the providers' message identifiers and better error
 * messages.
 *
 * The `detail` strings returned by verify() are displayed to the user (ST-03
 * "Test the connection" and the ST-01 diagnostics card). They stay in English:
 * a package has no access to the i18n dictionaries, which live in
 * apps/web/src/i18n — so nothing here is localizable today.
 */
import type { MailTransport, OutgoingEmail } from "./types";

export type { MailProvider } from "./provider-meta";
export { PROVIDER_META, SMTP_PRESETS } from "./provider-meta";

export type SmtpConfig = {
  host: string;
  port: number;
  /** true = implicit TLS (465); false = STARTTLS (587/25). */
  secure: boolean;
  user?: string;
  password?: string;
};

/* ---------- Console ---------- */

export const consoleTransport: MailTransport = {
  async send(mail) {
    const messageId = `<dev-${Date.now()}-${Math.random().toString(36).slice(2)}@open-incident.local>`;
    console.log(
      `[mail:console] to: ${mail.to} | from: ${mail.from} | subject: ${mail.subject} | id: ${messageId}\n${mail.text.slice(0, 800)}`,
    );
    return { messageId };
  },
  async verify() {
    return { ok: true, detail: "Development transport: nothing is actually sent." };
  },
};

/* ---------- SMTP (nodemailer) ---------- */

export function smtpTransport(config: SmtpConfig): MailTransport {
  // Lazy import: the worker and the web app do not need nodemailer on the paths
  // that do not send email.
  async function createTransporter() {
    const nodemailer = await import("nodemailer");
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password ?? "" } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  return {
    async send(mail: OutgoingEmail) {
      const transporter = await createTransporter();
      const info = await transporter.sendMail({
        from: mail.from,
        to: mail.to,
        replyTo: mail.replyTo,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        headers: mail.headers,
      });
      return { messageId: info.messageId };
    },
    async verify() {
      try {
        const transporter = await createTransporter();
        await transporter.verify();
        return {
          ok: true,
          detail: `Connection established on ${config.host}:${config.port} (${config.secure ? "TLS" : "STARTTLS"}).`,
        };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/* ---------- Resend ---------- */

export function resendTransport(apiKey: string): MailTransport {
  return {
    async send(mail: OutgoingEmail) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: mail.from,
          to: [mail.to],
          reply_to: mail.replyTo,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          headers: mail.headers,
        }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { id?: string };
      return { messageId: data.id };
    },
    async verify() {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) return { ok: true, detail: "Resend API key is valid." };
      if (res.status === 401) return { ok: false, detail: "API key rejected by Resend (401)." };
      return { ok: false, detail: `Resend answered ${res.status}.` };
    },
  };
}

/* ---------- Brevo (ex-Sendinblue), API v3 ---------- */

function splitAddress(value: string): { email: string; name?: string } {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match)
    return { email: match[2]!.trim(), name: match[1]!.replace(/^"|"$/g, "").trim() || undefined };
  return { email: value.trim() };
}

export function brevoTransport(apiKey: string): MailTransport {
  return {
    async send(mail: OutgoingEmail) {
      const from = splitAddress(mail.from);
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: from.email, name: from.name },
          to: [{ email: mail.to }],
          replyTo: mail.replyTo ? { email: splitAddress(mail.replyTo).email } : undefined,
          subject: mail.subject,
          textContent: mail.text,
          htmlContent: mail.html,
          headers: mail.headers,
        }),
      });
      if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { messageId?: string };
      return { messageId: data.messageId };
    },
    async verify() {
      const res = await fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": apiKey, Accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as { email?: string; companyName?: string };
        return {
          ok: true,
          detail: `Brevo account recognized${data.email ? ` (${data.email})` : ""}.`,
        };
      }
      if (res.status === 401) return { ok: false, detail: "API key rejected by Brevo (401)." };
      return { ok: false, detail: `Brevo answered ${res.status}.` };
    },
  };
}

/* ---------- Mailjet, API v3.1 ---------- */

export function mailjetTransport(apiKey: string, apiSecret: string): MailTransport {
  const basic = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
  return {
    async send(mail: OutgoingEmail) {
      const from = splitAddress(mail.from);
      const res = await fetch("https://api.mailjet.com/v3.1/send", {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          Messages: [
            {
              From: { Email: from.email, Name: from.name },
              To: [{ Email: mail.to }],
              ReplyTo: mail.replyTo ? { Email: splitAddress(mail.replyTo).email } : undefined,
              Subject: mail.subject,
              TextPart: mail.text,
              HTMLPart: mail.html,
              Headers: mail.headers,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Mailjet ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        Messages?: { Status?: string; To?: { MessageID?: string; MessageUUID?: string }[] }[];
      };
      const first = data.Messages?.[0];
      if (first?.Status && first.Status !== "success") {
        throw new Error(`Mailjet refused the send: ${JSON.stringify(first)}`);
      }
      return { messageId: first?.To?.[0]?.MessageUUID ?? first?.To?.[0]?.MessageID };
    },
    async verify() {
      const res = await fetch("https://api.mailjet.com/v3/REST/sender?Limit=1", {
        headers: { Authorization: `Basic ${basic}` },
      });
      if (res.ok) return { ok: true, detail: "Mailjet keys are valid." };
      if (res.status === 401) return { ok: false, detail: "Keys rejected by Mailjet (401)." };
      return { ok: false, detail: `Mailjet answered ${res.status}.` };
    },
  };
}
