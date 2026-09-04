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
                title: "Cause racine",
                body: "Mock: connection pool exhausted after the deploy.",
              },
              { key: "actions", title: "Actions", body: "- Add pool saturation alert" },
            ],
          });
        else if (/TASK: summary/.test(prompt))
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
