/**
 * What a person pastes into a monitor's target field.
 *
 * The cases below are what people actually type, not what a grammar allows.
 * A browser shows `https://example.com/` — with the trailing slash — so that
 * is what gets pasted, and it used to produce the host `example.com/` and a
 * monitor that could never succeed: `ENOTFOUND example.com/`, on a screen that
 * looked correctly configured.
 */
import { describe, expect, it } from "vitest";
import { hostAndPort } from "../src/monitors";

describe("reading a host out of what somebody pasted", () => {
  it.each([
    ["example.com", 443, "example.com", 443],
    ["https://example.com", 443, "example.com", 443],
    // The one that was broken, and the commonest thing to paste.
    ["https://example.com/", 443, "example.com", 443],
    ["https://example.com/status/page", 443, "example.com", 443],
    ["https://example.com:8443/", 443, "example.com", 8443],
    ["http://example.com", 443, "example.com", 80],
    ["example.com:8443", 443, "example.com", 8443],
    ["  https://example.com/  ", 443, "example.com", 443],
    ["https://example.com/?q=1#x", 443, "example.com", 443],
    // Credentials in a URL: the host is still the host.
    ["https://user:pass@example.com/", 443, "example.com", 443],
    // A trailing dot is a legal fully-qualified name and resolves.
    ["https://example.com./", 443, "example.com.", 443],
  ])("%s → %s:%s", (input, fallback, host, port) => {
    expect(hostAndPort(input, fallback)).toEqual({ host, port });
  });

  /** `tls.connect` and `net.connect` want the address without its brackets. */
  it("unwraps an IPv6 literal", () => {
    expect(hostAndPort("[2001:db8::1]:8443", 443)).toEqual({ host: "2001:db8::1", port: 8443 });
    expect(hostAndPort("https://[2001:db8::1]/", 443)).toEqual({ host: "2001:db8::1", port: 443 });
  });

  it("refuses what names no host", () => {
    for (const bad of ["", "   ", "https://", "://example.com"]) {
      expect(hostAndPort(bad, 443), bad).toBeNull();
    }
  });

  it("refuses a port outside the range rather than dialling it", () => {
    expect(hostAndPort("example.com:99999", 443)).toBeNull();
  });

  /**
   * The port check has no default: its contract is `host:port`, and inventing
   * one would turn "you forgot the port" into a check against something the
   * person never named.
   */
  it("refuses a bare host when the caller defaults no port", () => {
    // What the TCP check relies on: its contract is `host:port`, and inventing
    // a port would turn "you forgot it" into a check against something the
    // person never named.
    expect(hostAndPort("example.com", Number.NaN)).toBeNull();
    expect(hostAndPort("example.com:8443", Number.NaN)).toEqual({
      host: "example.com",
      port: 8443,
    });
  });
});
