import { describe, expect, it } from "vitest";
import { keyify, parseAttributes, parseBundle } from "../src/spec";
import { entriesFromCsv, parseCsv, toCsv } from "../src/csv";
import { bundleFromEntities, groupRef } from "../src/entities";
import { bundleFromText } from "../src/sources/index";

describe("keys", () => {
  it("derives a stable key from a label", () => {
    expect(keyify("Payments squad")).toBe("payments_squad");
    expect(keyify("Équipe – Données")).toBe("equipe_donnees");
    expect(keyify("3rd party")).toBe("t_3rd_party");
    expect(keyify("   ")).toBe("");
  });
});

describe("attributes", () => {
  it("requires a referenced type for entry attributes and values for selects", () => {
    const errors: string[] = [];
    const defs = parseAttributes(
      [
        { label: "Lead", type: "text" },
        { key: "domain", label: "Domain", type: "select", options: "payments, search" },
        { key: "team", label: "Team", type: "entry", refTypeKey: "team" },
        { key: "bad", label: "Bad", type: "entry" },
        { key: "bad2", label: "Bad", type: "select" },
        { key: "Nope!", label: "x", type: "text" },
      ],
      "attributes",
      errors,
    );
    expect(defs.map((d) => d.key)).toEqual(["lead", "domain", "team"]);
    expect(defs[1]!.options).toEqual(["payments", "search"]);
    expect(errors).toHaveLength(3);
  });
});

describe("bundles", () => {
  it("validates types and entries with paths in the errors", () => {
    const { bundle, errors } = parseBundle({
      types: [{ name: "Squad", attributes: [{ label: "Lead" }] }, { key: "x" }],
      entries: [{ type: "squad", name: "Payments" }, { type: "squad" }],
    });
    expect(bundle.types).toHaveLength(1);
    expect(bundle.types[0]!.key).toBe("squad");
    expect(bundle.entries).toHaveLength(1);
    expect(errors).toEqual(["types[1].name: required", "entries[1].name: required"]);
  });
});

describe("csv", () => {
  it("parses quoted fields, doubled quotes, CRLF and a BOM", () => {
    const rows = parseCsv('\uFEFFname,description\r\n"a, b","He said ""hi"""\r\nc,\r\n');
    expect(rows).toEqual([
      ["name", "description"],
      ["a, b", 'He said "hi"'],
      ["c", ""],
    ]);
    expect(toCsv(rows)).toContain('"a, b","He said ""hi"""');
  });
  it("maps the header to fixed columns and attributes", () => {
    const { entries, errors } = entriesFromCsv(
      "Name,External ID,lead,domain\nPayments,sq_pay,Ana,payments\n,x,,\n",
      "squad",
    );
    expect(errors).toEqual(["row 3.name: required"]);
    expect(entries[0]).toMatchObject({
      type: "squad",
      name: "Payments",
      external_id: "sq_pay",
      attributes: { lead: "Ana", domain: "payments" },
    });
  });
});

describe("backstage", () => {
  it("normalises owner references", () => {
    expect(groupRef("group:default/search")).toBe("group:default/search");
    expect(groupRef("Search")).toBe("group:default/search");
    expect(groupRef("user:jane")).toBeNull();
  });
  it("maps groups to teams and components to services, teams first", () => {
    const { bundle, skipped } = bundleFromEntities([
      {
        kind: "Component",
        metadata: {
          name: "search-indexer",
          description: "Indexes",
          annotations: { "github.com/project-slug": "acme/search-indexer" },
        },
        spec: { type: "service", owner: "search" },
      },
      { kind: "Group", metadata: { name: "search" }, spec: { profile: { displayName: "Search" } } },
      { kind: "API", metadata: { name: "ignored" } },
    ]);
    expect(skipped).toEqual(["API ignored"]);
    expect(bundle.entries.map((e) => e.type)).toEqual(["team", "service"]);
    expect(bundle.entries[1]).toMatchObject({
      external_id: "component:default/search-indexer",
      attributes: { owner: "group:default/search", repository: "acme/search-indexer" },
    });
  });
  it("sniffs a multi-document catalog-info.yaml and a JSON bundle", () => {
    const yaml = bundleFromText(
      "apiVersion: backstage.io/v1alpha1\nkind: Group\nmetadata:\n  name: search\n---\napiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: api\nspec:\n  owner: search\n",
    );
    expect(yaml.errors).toEqual([]);
    expect(yaml.bundle.entries).toHaveLength(2);
    const json = bundleFromText('{"types":[{"key":"squad","name":"Squad"}],"entries":[]}');
    expect(json.bundle.types[0]!.key).toBe("squad");
    const csv = bundleFromText("name\nx\n", { format: "csv" });
    expect(csv.errors[0]).toMatch(/--type/);
  });
});
