#!/usr/bin/env node
/**
 * The MCP server over stdio — what Claude Desktop, Claude Code and the other
 * local clients speak.
 *
 * Configured entirely by environment, because that is all a client config can
 * pass:
 *
 *   OI_BASE_URL   https://skylark.open-incident.com
 *   OI_API_KEY    oi_live_…
 *
 * Nothing is written to stdout, ever: stdout *is* the protocol, and one stray
 * `console.log` makes the client fail to parse the handshake with an error
 * that names neither this file nor the line. Diagnostics go to stderr, which
 * clients surface in their logs.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

const baseUrl = process.env["OI_BASE_URL"];
const apiKey = process.env["OI_API_KEY"];

if (!baseUrl || !apiKey) {
  console.error(
    "open-incident-mcp: set OI_BASE_URL (e.g. https://skylark.open-incident.com) " +
      "and OI_API_KEY (Settings → API keys).",
  );
  process.exit(1);
}

const server = createServer({ baseUrl, apiKey });
await server.connect(new StdioServerTransport());
console.error(`open-incident-mcp: connected to ${baseUrl}`);
