import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * A mock OpenAI-compatible model server for the smoke suite: chat completions
 * answer according to what the prompt asks for (a title, a draft, follow-ups,
 * sections), embeddings are deterministic. Every call is recorded.
 */
export type AiCall = { path: string; body: Record<string, unknown> };

export function startAiMock(
  port = 3198,
): Promise<{ server: Server; calls: AiCall[]; reset: () => void }> {
  const calls: AiCall[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (o: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    if (req.method === "GET" && url.pathname === "/_calls") return json(calls);
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw || "{}") as Record<string, unknown>;
      } catch {
        body = {};
      }
      calls.push({ path: url.pathname, body });
      if (url.pathname === "/v1/embeddings") {
        const input = Array.isArray(body.input)
          ? (body.input as string[])
          : [String(body.input ?? "")];
        const data = input.map((text, index) => {
          const h = createHash("sha256")
            .update(
              text
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, " ")
                .split(" ")
                .slice(0, 6)
                .join(" "),
            )
            .digest();
          return { index, embedding: Array.from({ length: 16 }, (_, i) => (h[i]! - 128) / 128) };
        });
        return json({
          model: "mock-embed",
          data,
          usage: { prompt_tokens: input.join(" ").split(/\s+/).length },
        });
      }
      if (url.pathname === "/v1/chat/completions") {
        const messages = (body.messages as Array<{ role: string; content: string }>) ?? [];
        const prompt = messages.map((m) => m.content).join("\n");
        let content: string;
        if (/TASK: declare/.test(prompt))
          content = JSON.stringify({
            title: "Mock: checkout errors spike on payments-worker",
            summary: "Mock summary — error rate rose after the 13:55 deploy; investigating.",
          });
        else if (/TASK: follow_ups/.test(prompt))
          content = JSON.stringify([
            { title: "Mock follow-up: add alerting on connection pool saturation", priority: "P1" },
            { title: "Mock follow-up: document the rollback procedure", priority: "P2" },
          ]);
        else if (/TASK: post_mortem_review/.test(prompt)) {
          const keys = [...prompt.matchAll(/^\[([a-z0-9_]+)\] /gm)].map((m) => m[1]!);
          content = JSON.stringify({
            notes: keys.map((key, i) => ({
              key,
              verdict: i === 0 ? "gap" : i === 1 ? "contradiction" : "supported",
              note:
                i === 0
                  ? "Mock review: the material says the alert fired at 14:02; the section does not mention detection."
                  : i === 1
                    ? "Mock review: the section says 15:20 but the timeline records resolution at 15:24."
                    : "",
            })),
          });
        } else if (/TASK: post_mortem_refine/.test(prompt))
          content = "Mock refined body: shorter, every fact kept, nothing added.";
        else if (/TASK: post_mortem/.test(prompt))
          content = JSON.stringify({
            sections: [
              {
                key: "summary",
                title: "Résumé",
                body: "Mock: between 13:55 and 15:20, checkout latency degraded.",
              },
              {
                key: "timeline",
                title: "Chronologie",
                body: "- 13:55 deploy\n- 14:02 alert\n- 15:20 resolved",
              },
              {
                key: "root_cause",
                title: "Analyse de cause racine (RCA)",
                body: "Mock: connection pool exhausted after the deploy.",
              },
              { key: "actions", title: "Actions", body: "- Add pool saturation alert" },
            ],
          });
        else if (/TASK: investigate_challenge/.test(prompt)) {
          const ids = [
            ...new Set(prompt.match(/^\[([A-Z]\d+)\]/gm)?.map((x) => x.slice(1, -1)) ?? []),
          ];
          content = JSON.stringify({
            verdicts: [
              {
                id: "H1",
                verdict: "holds",
                note: "Mock review: the deploy precedes the first symptom; nothing in the material contradicts it.",
                citations: ids.slice(0, 1),
              },
              {
                id: "H2",
                verdict: "weakened",
                note: "Mock review: an alternative remains unexcluded — a flag change in the same window.",
                citations: [],
              },
            ],
          });
        } else if (/TASK: investigate\b/.test(prompt)) {
          // Cite what the material really contains: the ids of its evidence lines.
          const ids = [
            ...new Set(prompt.match(/^\[([A-Z]\d+)\]/gm)?.map((x) => x.slice(1, -1)) ?? []),
          ];
          const e = ids.filter((i) => i.startsWith("E"));
          const c = ids.filter((i) => i.startsWith("C"));
          const a = ids.filter((i) => i.startsWith("A"));
          const n = ids.filter((i) => i.startsWith("N"));
          content = JSON.stringify({
            triage: {
              severityHint: "SEV2",
              scope: "Mock: checkout in eu-west-1",
              escalate: false,
              rationale: "Mock: one service, a lead is assigned.",
            },
            findings: [
              {
                id: "F1",
                check: "timeline",
                statement: "Mock finding: the incident was declared after checkout latency rose.",
                citations: e.slice(0, 2),
              },
              {
                id: "F2",
                check: c.length ? "changes" : "timeline",
                statement: "Mock finding: a deploy preceded the first symptom.",
                citations: c.length ? c.slice(0, 1) : e.slice(0, 1),
              },
              ...(a.length
                ? [
                    {
                      id: "F3",
                      check: "alerts",
                      statement: "Mock finding: the alert fired on the affected service.",
                      citations: a.slice(0, 1),
                    },
                  ]
                : []),
              ...(n.length
                ? [
                    {
                      id: "F4",
                      check: "notes",
                      statement: "Mock finding: a responder reported the rollback did not help.",
                      citations: n.slice(0, 1),
                    },
                  ]
                : []),
            ],
            hypotheses: [
              {
                id: "H1",
                whatBroke: "Mock hypothesis: the connection pool of checkout-api",
                why: "exhausted after the 13:55 deploy doubled the worker's connections",
                confidence: "likely",
                findings: ["F1", "F2"],
                nextSteps: ["Mock: roll back the deploy", "Mock: check pool saturation"],
              },
              {
                id: "H2",
                whatBroke: "Mock hypothesis: a feature flag",
                why: "a flag changed in the same window",
                confidence: "plausible",
                findings: ["F1"],
                nextSteps: ["Mock: list the flag changes"],
              },
            ],
            blastRadius: "Mock: checkout in eu-west-1.",
            whatsGoingOn: "Mock: checkout latency degraded; responders are on it.",
          });
        } else if (/TASK: summary/.test(prompt))
          content =
            "Mock summary of the timeline: the incident was acknowledged in 3 minutes and is under monitoring.";
        else if (/TASK: update_draft/.test(prompt))
          content =
            "Mock draft: the fix is deployed and error rates are back to baseline; we keep monitoring for the next hour.";
        else content = "Mock answer.";
        return json({
          id: "mock",
          model: "mock-chat",
          choices: [{ index: 0, message: { role: "assistant", content } }],
          usage: {
            prompt_tokens: Math.ceil(prompt.length / 4),
            completion_tokens: Math.ceil(content.length / 4),
          },
        });
      }
      return json({ error: { message: `mock: unknown path ${url.pathname}` } }, 404);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      resolve({ server, calls, reset: () => calls.splice(0, calls.length) }),
    );
  });
}
