export type OutgoingEmail = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  /**
   * Always present, and never a stripped-down afterthought when `html` is set:
   * it is what a text-only client, a screen reader and most spam filters read.
   * A mail with no text part scores worse and is sometimes shown blank.
   */
  text: string;
  /** Optional rich part. When set, the mail goes out as multipart alternative. */
  html?: string;
  headers?: Record<string, string>;
};

export interface MailTransport {
  send(mail: OutgoingEmail): Promise<{ messageId?: string }>;
  /** Configuration test without sending an email (SMTP connection, key validity). */
  verify?(): Promise<{ ok: boolean; detail: string }>;
}

/**
 * Nature of the email, for the outbox log.
 *
 * `admin` is the workspace talking to its own people about itself — trial
 * ending, suspension. The only kind that survives a suspended workspace's
 * outbound cut-off, because it is how the suspension gets announced.
 */
export type MailKind =
  "invitation" | "account" | "incident" | "escalation" | "admin" | "test" | "other";
