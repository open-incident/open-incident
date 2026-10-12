import { inflateRawSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SLACK_BOT_SCOPES } from "../src/install";
import { colorIcon, outlineIcon, zip } from "../src/package-files";
import { slackAppManifest, slackManifestCreateUrl } from "../src/slack/manifest";
import { teamsAppManifest } from "../src/teams/manifest";

/**
 * What the Slack Marketplace and the Teams Store review is the manifest and
 * the package. These tests read them back the way the stores do: every URL on
 * the one address the app calls, the removal events Slack requires us to
 * handle, team-scoped permissions only, and files that decode.
 */
describe("Slack manifest", () => {
  const m = slackAppManifest({ origin: "https://oi.example/" });

  it("points every request URL at the one fixed origin", () => {
    const urls = [
      m.features.slash_commands[0]!.url,
      m.oauth_config.redirect_urls[0]!,
      m.settings.event_subscriptions.request_url,
      m.settings.interactivity.request_url,
    ];
    for (const u of urls) expect(u.startsWith("https://oi.example/api/slack/")).toBe(true);
  });

  it("subscribes to the removal events and asks for the scopes the code uses", () => {
    expect(m.settings.event_subscriptions.bot_events).toEqual(
      expect.arrayContaining(["app_uninstalled", "tokens_revoked"]),
    );
    expect(m.oauth_config.scopes.bot).toEqual([...SLACK_BOT_SCOPES]);
  });

  it("opens Slack's creation flow with the manifest in the link", () => {
    const url = new URL(slackManifestCreateUrl(m));
    expect(url.origin).toBe("https://api.slack.com");
    expect(JSON.parse(url.searchParams.get("manifest_json")!)).toEqual(m);
  });
});

describe("Teams manifest", () => {
  const m = teamsAppManifest({
    appId: "00000000-0000-4000-8000-000000000001",
    origin: "https://oi.example",
    developer: {
      name: "Open Incident",
      websiteUrl: "https://oi.example",
      privacyUrl: "https://oi.example/legal/confidentialite",
      termsOfUseUrl: "https://oi.example/legal/conditions",
    },
  });

  it("asks only for team-scoped permissions", () => {
    const rsc = m.authorization.permissions.resourceSpecific;
    expect(rsc.length).toBeGreaterThan(0);
    for (const p of rsc) expect(p.name.endsWith(".Group")).toBe(true);
    expect(m.webApplicationInfo.id).toBe(m.id);
  });

  it("declares the bot for teams and for personal pages, on the product's domain", () => {
    expect(m.bots[0]!.botId).toBe(m.id);
    expect(m.bots[0]!.scopes).toEqual(["team", "personal"]);
    expect(m.validDomains).toEqual(["oi.example"]);
    expect(m.description.short.length).toBeLessThanOrEqual(80);
  });
});

/** Width, height and the RGBA bytes of a PNG this module wrote. */
function readPng(buf: Buffer) {
  expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let o = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.subarray(o + 4, o + 8).toString("ascii");
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === "IDAT") idat.push(data);
    o += 12 + len;
  }
  return { width, height, raw: inflateSync(Buffer.concat(idat)) };
}

describe("icons", () => {
  it("draws a 192 px colour icon, opaque in the middle", () => {
    const { width, height, raw } = readPng(colorIcon());
    expect([width, height]).toEqual([192, 192]);
    const row = 96 * (192 * 4 + 1) + 1;
    expect(raw[row + 96 * 4 + 3]).toBe(255);
  });

  it("draws a 32 px outline, transparent in the corner, white on the mark", () => {
    const { width, raw } = readPng(outlineIcon());
    expect(width).toBe(32);
    expect(raw[1 + 3]).toBe(0); // top-left pixel: transparent
    const centre = 16 * (32 * 4 + 1) + 1 + 16 * 4;
    expect([raw[centre], raw[centre + 3]]).toEqual([255, 255]);
  });
});

describe("zip", () => {
  it("writes entries a reader can find and inflate", () => {
    const files = [
      { name: "manifest.json", data: Buffer.from('{"ok":true}') },
      { name: "color.png", data: colorIcon() },
    ];
    const z = zip(files);
    const end = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(z.readUInt16LE(end + 10)).toBe(2);
    let o = z.readUInt32LE(end + 16);
    for (const f of files) {
      expect(z.readUInt32LE(o)).toBe(0x02014b50);
      const size = z.readUInt32LE(o + 20);
      const nameLen = z.readUInt16LE(o + 28);
      const local = z.readUInt32LE(o + 42);
      expect(z.subarray(o + 46, o + 46 + nameLen).toString()).toBe(f.name);
      const localName = z.readUInt16LE(local + 26);
      const packed = z.subarray(local + 30 + localName, local + 30 + localName + size);
      expect(inflateRawSync(packed)).toEqual(f.data);
      o += 46 + nameLen;
    }
  });
});
