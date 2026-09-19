export type { MailKind, MailTransport, OutgoingEmail } from "./types";
export {
  PROVIDER_META,
  SMTP_PRESETS,
  brevoTransport,
  consoleTransport,
  mailjetTransport,
  resendTransport,
  smtpTransport,
  type MailProvider,
  type SmtpConfig,
} from "./providers";
export {
  instanceConfig,
  instanceFrom,
  resolveMailConfig,
  sendInstanceEmail,
  type ResolvedMailConfig,
} from "./settings";
export {
  MAIL_BULK_QUEUE,
  MAIL_SEND_QUEUE,
  deliverEmail,
  mailQueueForClass,
  sendTenantEmail,
  type MailClass,
  type MailSendJob,
  type SendTenantEmailInput,
  type SendTenantEmailResult,
} from "./outbox";
export {
  brandedHtml,
  brandedText,
  type BrandedEmail,
  type EmailButton,
  type EmailFact,
} from "./template";
