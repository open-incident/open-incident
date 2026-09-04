/**
 * Metadata of the sending providers — pure data, without any dependency.
 *
 * A deliberately separate module: the configuration screen is a client component, it must
 * not bundle the transports (nodemailer, BullMQ, database access) into the browser bundle.
 *
 * The labels and hints below are displayed on the settings screen and stay in English: a package
 * has no access to the i18n dictionaries (apps/web/src/i18n), so they are not
 * localizable today. Provider names and key formats (re_…, xkeysib-…) never translate.
 */

export type MailProvider = "console" | "smtp" | "resend" | "brevo" | "mailjet";

export const PROVIDER_META: Record<
  MailProvider,
  { label: string; hint: string; secretLabel?: string; docsHost?: string }
> = {
  console: {
    label: "Development mode",
    hint: "Nothing is actually sent: the emails are written to the server logs.",
  },
  smtp: {
    label: "SMTP server",
    hint: "Your own server, or the SMTP relay of any provider.",
    secretLabel: "SMTP password",
  },
  resend: {
    label: "Resend",
    hint: "HTTP API. Key in the re_… format, from resend.com/api-keys.",
    secretLabel: "API key",
    docsHost: "resend.com",
  },
  brevo: {
    label: "Brevo",
    hint: "HTTP API v3. xkeysib-… key, from Brevo → SMTP & API.",
    secretLabel: "API key",
    docsHost: "brevo.com",
  },
  mailjet: {
    label: "Mailjet",
    hint: "HTTP API v3.1. Public key and secret key, from Mailjet → API Keys.",
    secretLabel: "API key (public)",
    docsHost: "mailjet.com",
  },
};

/** Prefilled SMTP relays offered on the configuration screen. */
export const SMTP_PRESETS: {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
}[] = [
  { id: "custom", label: "Custom server", host: "", port: 587, secure: false },
  {
    id: "brevo",
    label: "Brevo (SMTP relay)",
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false,
  },
  {
    id: "mailjet",
    label: "Mailjet (SMTP relay)",
    host: "in-v3.mailjet.com",
    port: 587,
    secure: false,
  },
  { id: "mailgun", label: "Mailgun", host: "smtp.mailgun.org", port: 587, secure: false },
  { id: "postmark", label: "Postmark", host: "smtp.postmarkapp.com", port: 587, secure: false },
  {
    id: "ses-eu-west-1",
    label: "Amazon SES (eu-west-1)",
    host: "email-smtp.eu-west-1.amazonaws.com",
    port: 587,
    secure: false,
  },
  { id: "scaleway", label: "Scaleway TEM", host: "smtp.tem.scw.cloud", port: 587, secure: false },
  {
    id: "gmail",
    label: "Gmail / Google Workspace",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
  },
  {
    id: "mailpit",
    label: "Mailpit (local development)",
    host: "localhost",
    port: 1027,
    secure: false,
  },
];
