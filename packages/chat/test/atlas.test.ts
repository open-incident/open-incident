import { describe, expect, it } from "vitest";
import { atlasActedBlocks, atlasDraftBlocks } from "../src/slack/blocks";
import { atlasActedCard, atlasDraftCard, mentionActivity } from "../src/teams/cards";
import { chatSettings } from "../src/settings";
import { peopleLine } from "../src/people";

const view = {
  level: 3,
  title: "Rolled back the CDN config to revision 418",
  detail: "5xx on web-storefront rose to 4 % after the 16:05 push.",
  reversible: true,
  actionId: "11111111-1111-1111-1111-111111111111",
  incidentId: "22222222-2222-2222-2222-222222222222",
  openUrl: "https://acme.example/app/incidents/225",
};

describe("Atlas in the channel", () => {
  it("tells the level, and offers Undo, Stop Atlas and Open on Slack", () => {
    const json = JSON.stringify(atlasActedBlocks(view));
    expect(json).toContain("ATLAS ACTED · LEVEL 3");
    expect(json).toContain('"action_id":"oi_atlas_undo"');
    expect(json).toContain(`"value":"${view.actionId}"`);
    expect(json).toContain('"action_id":"oi_atlas_stop"');
    expect(json).toContain(`"value":"${view.incidentId}"`);
    expect(json).toContain(view.openUrl);
  });

  it("offers no Undo for an action that cannot be undone", () => {
    const json = JSON.stringify(atlasActedBlocks({ ...view, reversible: false }));
    expect(json).not.toContain("oi_atlas_undo");
    expect(json).toContain("not reversible");
  });

  it("draws the same message as a Teams card, its buttons as submits", () => {
    const card = atlasActedCard(view) as {
      actions: Array<{ type: string; title: string; data?: Record<string, string> }>;
    };
    expect(card.actions.map((a) => a.title)).toEqual(["Undo", "Stop Atlas", "Open"]);
    expect(card.actions[0]!.data).toEqual({ action: "oi_atlas_undo", actionId: view.actionId });
    expect(card.actions[1]!.data).toEqual({ action: "oi_atlas_stop", incidentId: view.incidentId });
  });

  it("labels an update draft and carries its words to Publish", () => {
    const draft = {
      reference: "INC-225",
      incidentId: view.incidentId,
      message: "CDN rolled back; 5xx under 0.5 %.",
    };
    const blocks = JSON.stringify(atlasDraftBlocks(draft));
    expect(blocks).toContain("UPDATE DRAFT · ATLAS");
    expect(blocks).toContain("oi_atlas_draft_publish");
    const card = atlasDraftCard(draft) as { actions: Array<{ data: Record<string, string> }> };
    expect(card.actions[0]!.data).toMatchObject({
      action: "oi_atlas_draft_publish",
      message: draft.message,
    });
  });
});

describe("settings and people", () => {
  it("fills the defaults and keeps what was chosen", () => {
    expect(chatSettings({})).toMatchObject({
      autoInvite: true,
      inviteOnCall: true,
      dmPages: true,
      postRca: true,
      atlasDrafts: false,
    });
    expect(chatSettings({ postRca: false, atlasDrafts: true }).postRca).toBe(false);
    expect(chatSettings({ postRca: "no" }).postRca).toBe(true);
  });

  it("says who was added the way the channel reads it", () => {
    const p = (name: string, onCall = false) => ({ memberId: name, name, email: "", onCall });
    expect(peopleLine([p("Thomas Moreau"), p("Nadia Benali"), p("Jordan Bakker", true)])).toBe(
      "Thomas Moreau, Nadia Benali and Jordan Bakker (on call)",
    );
    const a = mentionActivity([{ aadObjectId: "aad-1", name: "Nadia Benali" }], "INC-220") as {
      text: string;
      entities: Array<{ mentioned: { id: string } }>;
    };
    expect(a.text).toContain("<at>Nadia Benali</at>");
    expect(a.entities[0]!.mentioned.id).toBe("aad-1");
  });
});
