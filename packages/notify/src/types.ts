/**
 * What an operator has to be able to do before we route a page through it.
 *
 * Two contracts, not one, because the two channels are not the same product.
 * Sending a text message is a commodity that a dozen European vendors sell;
 * calling a phone, reading a sentence out loud and handing the keypress back to
 * us is not. Keeping them apart is what lets the instance text through one
 * operator and call through another — and it is what makes a vendor that only
 * sends texts a first-class SMS provider rather than a half-implemented voice
 * one.
 */

export type SendResult = { ok: true; ref?: string } | { ok: false; error: string };

export type SmsProvider = "brevo" | "twilio";
export type VoiceProvider = "twilio";

export type SmsTransport = {
  readonly provider: SmsProvider;
  /** What the recipient sees as the sender: a number, or a registered short name. */
  readonly sender: string;
  send(msg: { to: string; text: string }): Promise<SendResult>;
};

/**
 * Where the keypress goes. The provider must capture one digit from the callee
 * and POST it to `url`; our route reads it and acknowledges the escalation.
 * A provider that can read a sentence but cannot return the answer does not
 * implement this contract — an alert call nobody can acknowledge is a
 * notification, not a page.
 */
export type VoiceAck = { url: string };

export type VoiceTransport = {
  readonly provider: VoiceProvider;
  /** The number the call appears to come from. */
  readonly caller: string;
  call(msg: { to: string; say: string; ack: VoiceAck | null }): Promise<SendResult>;
};
