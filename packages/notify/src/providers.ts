/**
 * The operators, one function each, no shared state.
 *
 * Every transport is built from an explicit config rather than reading the
 * environment: that is what makes them testable without a global, and what
 * lets `settings.ts` be the single place that decides which one an instance
 * uses.
 */
import type { SendResult, SmsTransport, VoiceTransport } from "./types";

const TIMEOUT_MS = 10_000;

function failure(err: unknown): SendResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/* ---------- Brevo, transactional SMS v3 ---------- */

export type BrevoSmsConfig = {
  apiKey: string;
  /** Up to 11 alphanumeric characters, or 15 digits. Longer is refused by Brevo. */
  sender: string;
};

export function brevoSms(cfg: BrevoSmsConfig): SmsTransport {
  return {
    provider: "brevo",
    sender: cfg.sender,
    async send({ to, text }) {
      try {
        const res = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
          method: "POST",
          headers: {
            "api-key": cfg.apiKey,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            sender: cfg.sender,
            // Brevo wants the country code without the plus; our targets are
            // stored in E.164, so the plus is dropped here rather than in the
            // database, where it belongs.
            recipient: to.replace(/^\+/, ""),
            content: text,
            // Not "marketing": a page must ignore quiet hours and opt-outs, and
            // saying so is the operator's own condition for delivering it.
            type: "transactional",
            // `unicodeEnabled` stays off on purpose. It would keep the accents
            // but cut a segment from 160 characters to 70 — a page would cost
            // twice as much to say the same thing, and a transliterated accent
            // has never stopped anyone from waking up.
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = (await res.json().catch(() => ({}))) as {
          messageId?: number | string;
          message?: string;
        };
        if (!res.ok) return { ok: false, error: body.message ?? `HTTP ${res.status}` };
        return { ok: true, ref: body.messageId == null ? undefined : String(body.messageId) };
      } catch (err) {
        return failure(err);
      }
    },
  };
}

/* ---------- Twilio, API 2010-04-01 ---------- */

export type TwilioConfig = { accountSid: string; authToken: string; from: string };

async function twilio(
  cfg: TwilioConfig,
  resource: "Messages" | "Calls",
  form: Record<string, string>,
): Promise<SendResult> {
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/${resource}.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    return res.ok
      ? { ok: true, ref: body.sid }
      : { ok: false, error: body.message ?? `HTTP ${res.status}` };
  } catch (err) {
    return failure(err);
  }
}

export function twilioSms(cfg: TwilioConfig): SmsTransport {
  return {
    provider: "twilio",
    sender: cfg.from,
    send: ({ to, text }) => twilio(cfg, "Messages", { To: to, From: cfg.from, Body: text }),
  };
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );
}

export function twilioVoice(cfg: TwilioConfig): VoiceTransport {
  return {
    provider: "twilio",
    caller: cfg.from,
    call({ to, say, ack }) {
      // `<Gather>` is what closes the loop: Twilio waits for one key and POSTs
      // it to our route, which acknowledges the escalation. Without a token to
      // come back to, the call still says its piece — it just cannot be
      // answered, and the sentence the caller composed already says so.
      const spoken = `<Say>${escapeXml(say)}</Say>`;
      const twiml = ack
        ? `<Response><Gather numDigits="1" action="${escapeXml(ack.url)}" method="POST">${spoken}</Gather><Say>No answer recorded. Goodbye.</Say></Response>`
        : `<Response>${spoken}</Response>`;
      return twilio(cfg, "Calls", { To: to, From: cfg.from, Twiml: twiml });
    },
  };
}
