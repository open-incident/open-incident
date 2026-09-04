/** Twilio <Gather> callback: "press 4 to acknowledge". Answers with TwiML — the caller hears the outcome. */
import { getTenantFromHeaders } from "@/lib/tenant";
import { ackByToken } from "@/lib/ack";

export const dynamic = "force-dynamic";

function twiml(say: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${say.replace(/[<>&]/g, "")}</Say></Response>`,
    { headers: { "content-type": "text/xml" } },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tenant = await getTenantFromHeaders();
  if (!tenant) return twiml("This link is not valid.");
  const form = await request.formData().catch(() => null);
  const digits = String(form?.get("Digits") ?? "");
  if (digits !== "4") return twiml("No acknowledgement recorded. Goodbye.");
  const r = await ackByToken(tenant.id, token, "voice");
  if (!r.ok) return twiml("This escalation is no longer pending. Goodbye.");
  return twiml(
    r.already ? "Already acknowledged. Thank you." : "Acknowledged. Thank you, you are on it.",
  );
}
