import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PACKS, allPackSignals, packById, packDocument } from "../src/packs";
import { parsePromql } from "../src/promql/parse";

const dashboards = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docker",
  "collector",
  "dashboards",
);

describe("collector pack dashboards", () => {
  /*
   * The panels are read by a PromQL subset that refuses what it cannot do
   * exactly. A query outside it does not draw a wrong chart — it draws an
   * error message, on a dashboard the product placed by itself, which is the
   * worst place to discover a typo.
   */
  it("every query is inside the subset", () => {
    for (const pack of PACKS) {
      for (const panel of pack.panels) {
        expect(() => parsePromql(panel.query), `${pack.id}/${panel.id}`).not.toThrow();
      }
    }
  });

  it("panel ids are unique within a pack", () => {
    for (const pack of PACKS) {
      const ids = pack.panels.map((p) => p.id);
      expect(new Set(ids).size, pack.id).toBe(ids.length);
    }
  });

  it("every pack is recognised by at least one metric", () => {
    for (const pack of PACKS) expect(pack.signals.length, pack.id).toBeGreaterThan(0);
  });

  /*
   * Two packs claiming the same metric would both be placed by the first
   * collector to report — `container.cpu.utilization` comes from docker_stats
   * and from kubeletstats both, which is why the Docker pack is recognised by
   * `container.memory.percent` instead.
   */
  it("no metric identifies two packs", () => {
    const all = PACKS.flatMap((p) => p.signals);
    expect(new Set(all).size).toBe(all.length);
    expect(allPackSignals().length).toBe(all.length);
  });

  it("the JSON on disk is what the definitions say", () => {
    for (const pack of PACKS) {
      const file = join(dashboards, `${pack.id}.json`);
      const onDisk = JSON.parse(readFileSync(file, "utf8"));
      expect(onDisk, `${pack.id}.json is stale — run packs:emit`).toEqual(
        JSON.parse(JSON.stringify(packDocument(pack))),
      );
    }
  });

  it("finds a pack by id and refuses an unknown one", () => {
    expect(packById("host")?.title).toBe("Hosts");
    expect(packById("nope")).toBeNull();
  });
});
