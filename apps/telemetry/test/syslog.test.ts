/**
 * Syslog, both dialects and both framings.
 *
 * The cases below are lines real senders produce, not lines the RFC uses as
 * examples. RFC 3164 in particular is what most hardware speaks and what the
 * RFC describes is not quite what anything sends — the tests are written from
 * the second.
 */
import { describe, expect, it } from "vitest";
import { frameSyslog, parseSyslog, SyslogError } from "../src/syslog";

const NOW = new Date("2026-09-20T15:00:00Z");

describe("RFC 5424", () => {
  const line =
    '<134>1 2026-09-20T14:58:03.123Z lb-01 haproxy 4821 ID47 [origin ip="10.0.0.4"] backend web has no server available';

  it("reads the whole envelope", () => {
    const m = parseSyslog(line, NOW);
    expect(m).toMatchObject({
      facility: "local0",
      severityText: "INFO",
      host: "lb-01",
      appName: "haproxy",
      procId: "4821",
      msgId: "ID47",
      message: "backend web has no server available",
    });
    expect(m.ts.toISOString()).toBe("2026-09-20T14:58:03.123Z");
    expect(m.structured["origin.ip"]).toBe("10.0.0.4");
  });

  it("maps the severity onto the scale everything else uses", () => {
    // A firewall's WARN must sort with an application's WARN, which is the
    // whole point of one table.
    expect(parseSyslog("<11>1 - - - - - - disk failing", NOW).severityText).toBe("ERROR");
    expect(parseSyslog("<12>1 - - - - - - queue deep", NOW).severityText).toBe("WARN");
    expect(parseSyslog("<15>1 - - - - - - verbose", NOW).severityText).toBe("DEBUG");
    expect(parseSyslog("<0>1 - - - - - - halting", NOW).severityText).toBe("FATAL");
  });

  it("reads a `-` as absent rather than as a value", () => {
    const m = parseSyslog("<134>1 - - - - - - just a message", NOW);
    expect(m.host).toBe("");
    expect(m.appName).toBe("");
    expect(m.ts).toEqual(NOW);
  });

  it("keeps a message containing a bracket out of the structured data", () => {
    const m = parseSyslog('<134>1 - h a - - [x k="v"] GET /orders [200] in 4ms', NOW);
    expect(m.structured["x.k"]).toBe("v");
    expect(m.message).toBe("GET /orders [200] in 4ms");
  });
});

describe("RFC 3164, which is what most hardware sends", () => {
  it("reads the tag, the pid and the message", () => {
    const m = parseSyslog("<38>Sep 20 14:58:03 db-02 sshd[1234]: Failed password for root", NOW);
    expect(m).toMatchObject({
      facility: "auth",
      severityText: "INFO",
      host: "db-02",
      appName: "sshd",
      procId: "1234",
      message: "Failed password for root",
    });
  });

  it("copes with no pid and no colon", () => {
    const m = parseSyslog("<13>Sep 20 14:58:03 switch-1 link down on port 4", NOW);
    expect(m.appName).toBe("link");
    expect(m.message).toBe("down on port 4");
  });

  it("gives the year the line does not carry", () => {
    expect(parseSyslog("<13>Sep 20 14:58:03 h a: x", NOW).ts.getUTCFullYear()).toBe(2026);
  });

  it("does not file December on New Year's Day twelve months ahead", () => {
    // The one case this date format gets wrong on its own, and the one nobody
    // notices until January.
    const january = new Date("2027-01-01T00:30:00Z");
    expect(parseSyslog("<13>Dec 31 23:58:03 h a: x", january).ts.getUTCFullYear()).toBe(2026);
  });
});

describe("what arrives that is not syslog at all", () => {
  it("files a bare line as informational rather than dropping it", () => {
    // Plenty of things write plain text to a syslog socket. A line with no
    // severity is still a line.
    const m = parseSyslog("something wrote this without a priority", NOW);
    expect(m.severityText).toBe("INFO");
    expect(m.message).toBe("something wrote this without a priority");
  });

  it("refuses something that opens like a priority and is not", () => {
    expect(() => parseSyslog("<not-a-number> hello", NOW)).toThrow(SyslogError);
  });

  it("refuses an empty line", () => {
    expect(() => parseSyslog("   ", NOW)).toThrow(SyslogError);
  });
});

describe("framing a stream", () => {
  it("splits on newlines and keeps the remainder", () => {
    const { lines, rest } = frameSyslog(Buffer.from("<13>one\n<13>two\n<13>par"));
    expect(lines).toEqual(["<13>one", "<13>two"]);
    expect(rest.toString()).toBe("<13>par");
  });

  it("reads octet counting, which is the framing that survives a newline", () => {
    const body = "<134>1 - - - - - - line one\nline two";
    const { lines, rest } = frameSyslog(Buffer.from(`${Buffer.byteLength(body)} ${body}`));
    expect(lines).toEqual([body]);
    expect(rest.length).toBe(0);
  });

  it("waits rather than truncating a counted message that has not all arrived", () => {
    const { lines, rest } = frameSyslog(Buffer.from("40 <134>1 - - - - - - only part of it"));
    expect(lines).toEqual([]);
    expect(rest.length).toBeGreaterThan(0);
  });

  it("handles the two framings in one stream", () => {
    const counted = "<134>1 - - - - - - counted";
    const buffer = Buffer.from(`<13>plain\n${Buffer.byteLength(counted)} ${counted}<13>after\n`);
    const { lines } = frameSyslog(buffer);
    expect(lines).toEqual(["<13>plain", counted, "<13>after"]);
  });
});
