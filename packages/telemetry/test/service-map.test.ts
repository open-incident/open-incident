/**
 * The map's layout, which is the part that decides whether it is readable.
 *
 * The columns answer one question — "what is downstream of this" — so the
 * tests are about the shapes that make that question hard: a diamond, where
 * two paths of different lengths reach the same service; a cycle, which real
 * architectures have and which a naive walk never leaves; and a service
 * nothing calls, which must still appear rather than vanish because it has no
 * edge.
 */
import { describe, expect, it } from "vitest";
import { layoutByDepth } from "../src/service-map";

const edge = (source_service: string, target_service: string) => ({
  source_service,
  target_service,
});

/** Which column a service landed in. */
function columnOf(columns: string[][], service: string): number {
  return columns.findIndex((c) => c.includes(service));
}

describe("services in columns", () => {
  it("puts what calls on the left and what is called on the right", () => {
    const columns = layoutByDepth([edge("web", "api"), edge("api", "db")], ["web", "api", "db"]);
    expect(columns).toEqual([["web"], ["api"], ["db"]]);
  });

  it("takes the longest path to a service, not the shortest", () => {
    // A diamond: `db` is reached directly from `web` and through `api`. It
    // belongs after `api`, because the question the column answers is "what
    // does everything end up depending on".
    const columns = layoutByDepth(
      [edge("web", "api"), edge("web", "db"), edge("api", "db")],
      ["web", "api", "db"],
    );
    expect(columnOf(columns, "db")).toBeGreaterThan(columnOf(columns, "api"));
  });

  it("terminates on a cycle instead of walking it for ever", () => {
    const columns = layoutByDepth(
      [edge("a", "b"), edge("b", "c"), edge("c", "a")],
      ["a", "b", "c"],
    );
    expect(columns.flat().sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps a service nothing calls", () => {
    // A worker that only consumes a queue has no inbound edge, and dropping it
    // would be the map quietly claiming the service does not exist.
    const columns = layoutByDepth([edge("web", "api")], ["web", "api", "lonely"]);
    expect(columns.flat()).toContain("lonely");
    expect(columnOf(columns, "lonely")).toBe(0);
  });

  it("keeps a service that only appears in an edge", () => {
    // The span list and the edge list are read separately, and a service busy
    // enough to be called but too quiet to make the top of the span list would
    // otherwise be missing from its own dependency.
    const columns = layoutByDepth([edge("web", "unseen")], ["web"]);
    expect(columns.flat()).toContain("unseen");
  });

  it("leaves no empty column", () => {
    const columns = layoutByDepth([edge("a", "c")], ["a", "b", "c"]);
    expect(columns.every((c) => c.length > 0)).toBe(true);
  });
});
