import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { declareCard, incidentHeaderCard } from "../src/teams/cards";
import { resetTeamsKeyCache, verifyTeamsToken } from "../src/teams/verify";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

describe("teams", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid: "k1" };
  const sign = (payload: Record<string, unknown>, kid = "k1") => {
    const h = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
    const p = b64url(JSON.stringify(payload));
    return `${h}.${p}.${b64url(createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey))}`;
  };
  beforeEach(() => {
    process.env.TEAMS_APP_ID = "app-1";
    process.env.TEAMS_OPENID_CONFIG = "http://mock/openid";
    resetTeamsKeyCache();
    vi.stubGlobal(
      "fetch",
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/openid") ? { jwks_uri: "http://mock/jwks" } : { keys: [jwk] },
          ),
          { status: 200 },
        ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("accepts a token signed by the published key for our app, and refuses the rest", async () => {
    const now = Math.floor(Date.now() / 1000);
    const good = sign({
      iss: "https://api.botframework.com",
      aud: "app-1",
      exp: now + 300,
      serviceurl: "https://smba.example/emea/",
    });
    expect(await verifyTeamsToken(`Bearer ${good}`, "https://smba.example/emea")).toEqual({
      appId: "app-1",
      serviceUrl: "https://smba.example/emea/",
    });
    expect(await verifyTeamsToken(`Bearer ${good}`, "https://elsewhere.example")).toBeNull();
    expect(
      await verifyTeamsToken(
        `Bearer ${sign({ iss: "https://api.botframework.com", aud: "other", exp: now + 300 })}`,
        null,
      ),
    ).toBeNull();
    expect(
      await verifyTeamsToken(
        `Bearer ${sign({ iss: "https://api.botframework.com", aud: "app-1", exp: now - 3600 })}`,
        null,
      ),
    ).toBeNull();
    expect(
      await verifyTeamsToken(
        `Bearer ${sign({ iss: "https://api.botframework.com", aud: "app-1", exp: now + 300 }, "unknown-kid")}`,
        null,
      ),
    ).toBeNull();
    const tampered = good.replace(/\.[^.]+$/, ".AAAA");
    expect(await verifyTeamsToken(`Bearer ${tampered}`, null)).toBeNull();
    expect(await verifyTeamsToken(null, null)).toBeNull();
  });

  it("builds cards that carry the incident and the actions the product answers", () => {
    const card = incidentHeaderCard({
      reference: "INC-217",
      name: "Checkout latency",
      status: "Investigating",
      severity: "SEV2",
      phase: "active",
      lead: "Amélie",
      service: "checkout-api",
      url: "https://x/app/incidents/217",
      bridgeUrl: "https://meet/x",
    }) as { actions: Array<{ data?: { action: string }; url?: string }> };
    expect(card.actions.map((a) => a.data?.action ?? a.url)).toEqual([
      "https://x/app/incidents/217",
      "https://meet/x",
      "oi_update_open",
      "oi_escalate_open",
    ]);
    const declare = declareCard({
      types: [{ title: "Défaut", value: "t1" }],
      severities: [{ title: "SEV1", value: "s1" }],
      services: [],
      defaultTypeId: "t1",
    }) as { body: Array<{ id?: string }>; actions: Array<{ data: { action: string } }> };
    expect(declare.body.map((b) => b.id).filter(Boolean)).toEqual([
      "name",
      "typeId",
      "severityId",
      "serviceEntryId",
      "summary",
    ]);
    expect(declare.actions[0]!.data.action).toBe("oi_declare");
  });
});
