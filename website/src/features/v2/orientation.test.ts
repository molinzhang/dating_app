import { describe, expect, it } from "vitest";

import {
  areMutuallyEligibleCandidates,
  type PoolOrientation,
  validatePoolOrientation,
} from "./orientation";

const profile = (
  gender: PoolOrientation["gender"],
  orientation: PoolOrientation["orientation"],
  desiredGender: PoolOrientation["desiredGender"],
): PoolOrientation => ({ gender, orientation, desiredGender });

describe("validatePoolOrientation", () => {
  it.each([
    profile("male", "straight", "female"),
    profile("female", "straight", "male"),
  ])("accepts a straight user targeting the other gender", (value) => {
    expect(validatePoolOrientation(value)).toEqual({ valid: true, value });
  });

  it.each([
    profile("male", "gay", "male"),
    profile("female", "gay", "female"),
  ])("accepts a gay user targeting the same gender", (value) => {
    expect(validatePoolOrientation(value)).toEqual({ valid: true, value });
  });

  it.each([
    profile("male", "bisexual", "male"),
    profile("male", "bisexual", "female"),
    profile("female", "bisexual", "female"),
    profile("female", "bisexual", "male"),
  ])("accepts either single target gender for a bisexual user", (value) => {
    expect(validatePoolOrientation(value)).toEqual({ valid: true, value });
  });

  it("rejects a straight user targeting the same gender", () => {
    expect(validatePoolOrientation(profile("male", "straight", "male"))).toEqual({
      valid: false,
      error: "straight_requires_opposite_gender",
    });
  });

  it("rejects a gay user targeting the other gender", () => {
    expect(validatePoolOrientation(profile("female", "gay", "male"))).toEqual({
      valid: false,
      error: "gay_requires_same_gender",
    });
  });

  it.each([
    [{ orientation: "straight", desiredGender: "female" }, "invalid_gender"],
    [{ gender: "male", orientation: "unknown", desiredGender: "female" }, "invalid_orientation"],
    [{ gender: "male", orientation: "bisexual" }, "invalid_desired_gender"],
    [{ gender: "male", orientation: "bisexual", desiredGender: ["male", "female"] }, "invalid_desired_gender"],
    [{ gender: "male", orientation: "bisexual", desiredGender: "any" }, "invalid_desired_gender"],
  ] as const)("rejects malformed or multi-target wire values", (value, error) => {
    expect(validatePoolOrientation(value)).toEqual({ valid: false, error });
  });
});

describe("areMutuallyEligibleCandidates", () => {
  it("matches reciprocal straight users of different genders", () => {
    expect(
      areMutuallyEligibleCandidates(
        profile("male", "straight", "female"),
        profile("female", "straight", "male"),
      ),
    ).toBe(true);
  });

  it("matches reciprocal gay users of the same gender", () => {
    expect(
      areMutuallyEligibleCandidates(
        profile("female", "gay", "female"),
        profile("female", "gay", "female"),
      ),
    ).toBe(true);
  });

  it.each([
    [profile("male", "bisexual", "male"), profile("male", "gay", "male")],
    [profile("female", "bisexual", "female"), profile("female", "bisexual", "female")],
  ])("allows a bisexual same-gender pool to match only gay/bi candidates", (a, b) => {
    expect(areMutuallyEligibleCandidates(a, b)).toBe(true);
  });

  it.each([
    [profile("male", "bisexual", "female"), profile("female", "straight", "male")],
    [profile("female", "bisexual", "male"), profile("male", "bisexual", "female")],
  ])("allows a bisexual different-gender pool to match only straight/bi candidates", (a, b) => {
    expect(areMutuallyEligibleCandidates(a, b)).toBe(true);
  });

  it("rejects straight candidates from a bisexual same-gender pool", () => {
    expect(
      areMutuallyEligibleCandidates(
        profile("male", "bisexual", "male"),
        profile("male", "straight", "female"),
      ),
    ).toBe(false);
  });

  it("rejects gay candidates from a bisexual different-gender pool", () => {
    expect(
      areMutuallyEligibleCandidates(
        profile("male", "bisexual", "female"),
        profile("female", "gay", "female"),
      ),
    ).toBe(false);
  });

  it("requires both users to target the other's gender", () => {
    expect(
      areMutuallyEligibleCandidates(
        profile("male", "bisexual", "female"),
        profile("female", "bisexual", "female"),
      ),
    ).toBe(false);
  });

  it("rejects a pair when either pool profile is invalid", () => {
    expect(
      areMutuallyEligibleCandidates(
        profile("male", "straight", "male"),
        profile("male", "gay", "male"),
      ),
    ).toBe(false);
  });
});
