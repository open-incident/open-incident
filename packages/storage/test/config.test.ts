import { describe, expect, it } from "vitest";
import { storageConfig, tenantPrefix } from "../src/index";

describe("storage configuration", () => {
  it("is absent when no variable is set, complete when all are, and refuses a partial set", () => {
    expect(storageConfig({})).toBeNull();
    const full = {
      S3_ENDPOINT: "http://localhost:9100",
      S3_REGION: "us-east-1",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "a",
      S3_SECRET_ACCESS_KEY: "s",
    };
    expect(storageConfig(full)?.bucket).toBe("b");
    expect(storageConfig(full)?.forcePathStyle).toBe(true);
    expect(() => storageConfig({ S3_ENDPOINT: "http://localhost:9100" })).toThrow(
      /partially configured/,
    );
    expect(tenantPrefix("t1")).toBe("tenants/t1/");
  });
});
