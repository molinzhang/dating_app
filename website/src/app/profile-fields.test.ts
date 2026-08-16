import { describe, expect, it } from "vitest";

import { ageFromBirthDate, resolveSeekingGender } from "./App";

const NOW = new Date(Date.UTC(2026, 7, 16)); // 2026-08-16

describe("ageFromBirthDate", () => {
  it("counts whole years", () => {
    expect(ageFromBirthDate("1996-08-16", NOW)).toBe(30);
  });

  it("does not age someone up before their birthday", () => {
    expect(ageFromBirthDate("1996-08-17", NOW)).toBe(29);
    expect(ageFromBirthDate("1996-12-31", NOW)).toBe(29);
  });

  it("matches the backend on the same inputs", () => {
    // backend/test_orientation.py asserts these exact three.
    expect(ageFromBirthDate("1996-08-16", NOW)).toBe(30);
    expect(ageFromBirthDate("1996-08-17", NOW)).toBe(29);
    expect(ageFromBirthDate("1996-12-31", NOW)).toBe(29);
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "   ", "not-a-date", "1996-1-1", "96-01-01", "1996/01/01"]) {
      expect(ageFromBirthDate(bad, NOW)).toBeNull();
    }
  });

  it("rejects dates that do not exist", () => {
    // Date would silently roll these forward into March.
    expect(ageFromBirthDate("2026-02-30", NOW)).toBeNull();
    expect(ageFromBirthDate("1996-13-01", NOW)).toBeNull();
    expect(ageFromBirthDate("1996-00-10", NOW)).toBeNull();
  });

  it("rejects a future birth date rather than returning a negative age", () => {
    expect(ageFromBirthDate("2030-01-01", NOW)).toBeNull();
  });

  it("handles a leap-day birthday", () => {
    expect(ageFromBirthDate("2000-02-29", NOW)).toBe(26);
  });
});

describe("resolveSeekingGender", () => {
  it("sends straight users to the opposite gender", () => {
    expect(resolveSeekingGender("straight", "男", "")).toBe("女");
    expect(resolveSeekingGender("straight", "女", "")).toBe("男");
  });

  it("sends gay users to their own gender", () => {
    expect(resolveSeekingGender("gay", "男", "")).toBe("男");
    expect(resolveSeekingGender("gay", "女", "")).toBe("女");
  });

  it("ignores a stale choice when the orientation pins the answer", () => {
    // Someone who picked 男 as bisexual and then switched to straight must not
    // keep a target their new orientation forbids.
    expect(resolveSeekingGender("straight", "男", "男")).toBe("女");
    expect(resolveSeekingGender("gay", "男", "女")).toBe("男");
  });

  it("honours a bisexual user's explicit choice", () => {
    expect(resolveSeekingGender("bisexual", "男", "男")).toBe("男");
    expect(resolveSeekingGender("bisexual", "男", "女")).toBe("女");
  });

  it("falls back to the opposite gender for a bisexual user who chose nothing", () => {
    expect(resolveSeekingGender("bisexual", "女", "")).toBe("男");
  });
});
