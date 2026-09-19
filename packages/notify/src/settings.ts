/**
 * Which operator this instance pages through.
 *
 * One transport per channel, from the environment, exactly like the mail
 * package: an incident platform's deliverability belongs to whoever runs the
 * instance, not to each workspace. A channel whose operator is incomplete is
 * simply not offered — the screens draw a dead row that names what is missing,
 * and nothing anywhere pretends a phone can be rung.
 *
 * SMS and voice are resolved separately, and that is the point of the split:
 * Brevo sends the texts (it is already the mail provider, so it is one key for
 * both, and it is a European operator) while Twilio places the calls, being the
 * only one of the candidates that hands the keypress back to us. An instance
 * configured for Brevo alone therefore has SMS and no voice, and says so.
 *
 * When both are configured, Brevo wins the SMS: it is the cheaper of the two
 * per message, and an operator that is already sending the invitations is one
 * less account to hold. Whoever wants Twilio for both simply leaves
 * `BREVO_SMS_SENDER` unset.
 */
import { brevoSms, twilioSms, twilioVoice } from "./providers";
import type { SmsProvider, SmsTransport, VoiceProvider, VoiceTransport } from "./types";

type Env = Record<string, string | undefined>;

/** The SMS operator the environment selects, or null when none is complete. */
export function smsProvider(env: Env = process.env): SmsProvider | null {
  if (env.BREVO_API_KEY && env.BREVO_SMS_SENDER) return "brevo";
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) return "twilio";
  return null;
}

/** The voice operator. Only Twilio today — see `VoiceTransport` for why. */
export function voiceProvider(env: Env = process.env): VoiceProvider | null {
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) return "twilio";
  return null;
}

export function smsTransport(env: Env = process.env): SmsTransport | null {
  switch (smsProvider(env)) {
    case "brevo":
      return brevoSms({ apiKey: env.BREVO_API_KEY!, sender: env.BREVO_SMS_SENDER! });
    case "twilio":
      return twilioSms({
        accountSid: env.TWILIO_ACCOUNT_SID!,
        authToken: env.TWILIO_AUTH_TOKEN!,
        from: env.TWILIO_FROM!,
      });
    default:
      return null;
  }
}

export function voiceTransport(env: Env = process.env): VoiceTransport | null {
  switch (voiceProvider(env)) {
    case "twilio":
      return twilioVoice({
        accountSid: env.TWILIO_ACCOUNT_SID!,
        authToken: env.TWILIO_AUTH_TOKEN!,
        from: env.TWILIO_FROM!,
      });
    default:
      return null;
  }
}

export function smsConfigured(env: Env = process.env): boolean {
  return smsProvider(env) !== null;
}

export function voiceConfigured(env: Env = process.env): boolean {
  return voiceProvider(env) !== null;
}
