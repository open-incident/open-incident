import { afterEach, describe, expect, it, vi } from "vitest";
import {
  brevoSms,
  smsProvider,
  smsTransport,
  twilioSms,
  twilioVoice,
  voiceProvider,
} from "../src/index";

/** The last request the transport made, so the body can be asserted on. */
type Seen = { url: string; init: RequestInit };

function stubFetch(response: { status?: number; body?: unknown }): () => Seen {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.status ?? 201,
      headers: { "content-type": "application/json" },
    });
  });
  return () => seen[seen.length - 1]!;
}

afterEach(() => vi.unstubAllGlobals());

describe("which operator an instance pages through", () => {
  const twilio = {
    TWILIO_ACCOUNT_SID: "AC1",
    TWILIO_AUTH_TOKEN: "tok",
    TWILIO_FROM: "+33100000000",
  };
  const brevo = { BREVO_API_KEY: "xkeysib-1", BREVO_SMS_SENDER: "OpenInc" };

  it("offers nothing without configuration", () => {
    expect(smsProvider({})).toBeNull();
    expect(voiceProvider({})).toBeNull();
    expect(smsTransport({})).toBeNull();
  });

  it("gives Brevo the texts and Twilio the calls when both are configured", () => {
    expect(smsProvider({ ...twilio, ...brevo })).toBe("brevo");
    expect(voiceProvider({ ...twilio, ...brevo })).toBe("twilio");
  });

  it("leaves an instance on Brevo alone with SMS and no voice, rather than a call nobody answers", () => {
    expect(smsProvider(brevo)).toBe("brevo");
    expect(voiceProvider(brevo)).toBeNull();
  });

  it("falls back to Twilio for SMS when Brevo has a key but no sender", () => {
    expect(smsProvider({ ...twilio, BREVO_API_KEY: "xkeysib-1" })).toBe("twilio");
    expect(smsProvider({ BREVO_API_KEY: "xkeysib-1" })).toBeNull();
  });
});

describe("Brevo", () => {
  it("posts a transactional SMS with the plus dropped from the number", async () => {
    const last = stubFetch({ body: { messageId: 1511882900100020 } });
    const r = await brevoSms({ apiKey: "xkeysib-1", sender: "OpenInc" }).send({
      to: "+33612345678",
      text: "SEV1 checkout-api",
    });
    expect(r).toEqual({ ok: true, ref: "1511882900100020" });
    const { url, init } = last();
    expect(url).toBe("https://api.brevo.com/v3/transactionalSMS/sms");
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-1");
    expect(JSON.parse(String(init.body))).toEqual({
      sender: "OpenInc",
      recipient: "33612345678",
      content: "SEV1 checkout-api",
      type: "transactional",
    });
  });

  it("reports the operator's own words when it refuses", async () => {
    stubFetch({ status: 400, body: { code: "invalid_parameter", message: "sender is invalid" } });
    const r = await brevoSms({ apiKey: "k", sender: "way too long a name" }).send({
      to: "+33612345678",
      text: "x",
    });
    expect(r).toEqual({ ok: false, error: "sender is invalid" });
  });
});

describe("Twilio", () => {
  const cfg = { accountSid: "AC1", authToken: "tok", from: "+33100000000" };

  it("posts a form-encoded message under basic auth", async () => {
    const last = stubFetch({ body: { sid: "SM1" } });
    const r = await twilioSms(cfg).send({ to: "+33612345678", text: "SEV1" });
    expect(r).toEqual({ ok: true, ref: "SM1" });
    const { url, init } = last();
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("AC1:tok").toString("base64")}`,
    );
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      To: "+33612345678",
      From: "+33100000000",
      Body: "SEV1",
    });
  });

  it("gathers one key and posts it to the acknowledgement route", async () => {
    const last = stubFetch({ body: { sid: "CA1" } });
    await twilioVoice(cfg).call({
      to: "+33612345678",
      say: "SEV1 on checkout-api. Press 4 to acknowledge.",
      ack: { url: "https://acme.example.com/api/notify/voice/abc?x=1&y=2" },
    });
    const twiml = new URLSearchParams(String(last().init.body)).get("Twiml")!;
    expect(twiml).toContain('<Gather numDigits="1"');
    // The query separator has to survive as an entity or the TwiML is invalid.
    expect(twiml).toContain("voice/abc?x=1&amp;y=2");
    expect(twiml).toContain("Press 4 to acknowledge.");
  });

  it("still speaks when there is no token to come back to, but gathers nothing", async () => {
    const last = stubFetch({ body: { sid: "CA2" } });
    await twilioVoice(cfg).call({ to: "+33612345678", say: "Shift starts in 1 hour", ack: null });
    const twiml = new URLSearchParams(String(last().init.body)).get("Twiml")!;
    expect(twiml).not.toContain("Gather");
    expect(twiml).toBe("<Response><Say>Shift starts in 1 hour</Say></Response>");
  });

  it("does not let a network failure escape as an exception", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connect ETIMEDOUT");
    });
    expect(await twilioSms(cfg).send({ to: "+33612345678", text: "x" })).toEqual({
      ok: false,
      error: "connect ETIMEDOUT",
    });
  });
});
