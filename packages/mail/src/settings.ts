/**
 * Resolution of the sending configuration.
 *
 * One transport per instance, from the environment: SMTP (which covers every
 * relay on the market) or a native API. Per-workspace transports are not a
 * feature of this product — an incident platform sends notifications and
 * invitations, not customer correspondence, and whoever runs the instance owns
 * its deliverability. Without any configuration the emails are written to the
 * server logs, which is the honest behaviour for a development machine and a
 * visible one for a misconfigured server.
 */
import {
  brevoTransport,
  consoleTransport,
  mailjetTransport,
  resendTransport,
  smtpTransport,
  type MailProvider,
} from "./providers";
import type { MailTransport } from "./types";

export type ResolvedMailConfig = {
  provider: MailProvider;
  transport: MailTransport;
  from: string;
  /** Where the configuration comes from — displayed on the settings screen. */
  source: "instance" | "default";
};

/** The instance's own sender — the one the provider has been told about. */
export function instanceFrom(): string {
  const domain = (process.env.BASE_DOMAIN ?? "open-incident.local").split(":")[0];
  return process.env.MAIL_FROM ?? `no-reply@${domain}`;
}

/** Instance configuration from the environment; null when nothing is set. */
export function instanceConfig(): { provider: MailProvider; transport: MailTransport } | null {
  if (process.env.RESEND_API_KEY) {
    return { provider: "resend", transport: resendTransport(process.env.RESEND_API_KEY) };
  }
  if (process.env.BREVO_API_KEY) {
    return { provider: "brevo", transport: brevoTransport(process.env.BREVO_API_KEY) };
  }
  if (process.env.MAILJET_API_KEY && process.env.MAILJET_API_SECRET) {
    return {
      provider: "mailjet",
      transport: mailjetTransport(process.env.MAILJET_API_KEY, process.env.MAILJET_API_SECRET),
    };
  }
  if (process.env.SMTP_HOST) {
    return {
      provider: "smtp",
      transport: smtpTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        user: process.env.SMTP_USER,
        password: process.env.SMTP_PASSWORD,
      }),
    };
  }
  return null;
}

export function resolveMailConfig(): ResolvedMailConfig {
  const instance = instanceConfig();
  if (instance) return { ...instance, from: instanceFrom(), source: "instance" };
  return {
    provider: "console",
    transport: consoleTransport,
    from: instanceFrom(),
    source: "default",
  };
}

/**
 * PRE-tenant transactional send (password reset, email verification, the
 * invitation of a workspace's first owner): instance transport, no outbox row —
 * there is no tenant to attach one to.
 */
export async function sendInstanceEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { transport, from } = resolveMailConfig();
  try {
    await transport.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
