/**
 * The folds a profile screen is made of.
 *
 * Two of them are worth pinning down. The function key, because frames carry
 * their line and a hot loop spread over four lines of assembly showed up as
 * four rows of ten per cent each — hiding the one fact the reader wanted. And
 * the diff, because its first version compared self time only, and a change
 * that moves work between callers leaves every self time exactly where it was.
 */
import { describe, expect, it } from "vitest";
import { functionOf, locationOf } from "../src/profiles";

describe("a frame, split", () => {
  it("separates the function from where it was seen", () => {
    expect(functionOf("main.hashLoop src/main.go:17")).toBe("main.hashLoop");
    expect(locationOf("main.hashLoop src/main.go:17")).toBe("src/main.go:17");
  });

  it("folds the lines of one function together", () => {
    // The case that made the table useless: four lines of the same assembly
    // routine, each about a tenth of the profile, and no row saying the
    // routine is a third of it.
    const lines = [
      "crypto/sha256.sha256block sha256/sha256block_arm64.s:57",
      "crypto/sha256.sha256block sha256/sha256block_arm64.s:69",
      "crypto/sha256.sha256block sha256/sha256block_arm64.s:92",
    ];
    expect(new Set(lines.map(functionOf)).size).toBe(1);
  });

  it("leaves a frame with no location alone", () => {
    expect(functionOf("runtime.mcall")).toBe("runtime.mcall");
    expect(locationOf("runtime.mcall")).toBe("");
  });

  it("does not cut a name that merely contains a colon", () => {
    // A C++ template or a Rust path has colons everywhere; only a trailing
    // `file:line` after a space is a location.
    expect(functionOf("std::vector<int>::push_back")).toBe("std::vector<int>::push_back");
    expect(functionOf("core::ptr::drop_in_place<T>")).toBe("core::ptr::drop_in_place<T>");
  });

  it("keeps an unresolved address whole", () => {
    expect(functionOf("0x104f2c1a8")).toBe("0x104f2c1a8");
  });
});
