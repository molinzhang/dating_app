export const GENDERS = ["male", "female"] as const;
export type Gender = (typeof GENDERS)[number];

export const ORIENTATIONS = ["straight", "gay", "bisexual"] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  male: "男",
  female: "女",
};

export const ORIENTATION_LABELS: Record<Orientation, string> = {
  straight: "异性恋",
  gay: "同性恋",
  bisexual: "双性恋",
};

/** A user's orientation choice for one matching pool. */
export interface PoolOrientation {
  gender: Gender;
  orientation: Orientation;
  /** Exactly one target gender is active in a pool, including for bisexual users. */
  desiredGender: Gender;
}

export type PoolOrientationValidationError =
  | "invalid_profile"
  | "invalid_gender"
  | "invalid_orientation"
  | "invalid_desired_gender"
  | "straight_requires_opposite_gender"
  | "gay_requires_same_gender";

export type PoolOrientationValidationResult =
  | { valid: true; value: PoolOrientation }
  | { valid: false; error: PoolOrientationValidationError };

export function isGender(value: unknown): value is Gender {
  return typeof value === "string" && GENDERS.includes(value as Gender);
}

export function isOrientation(value: unknown): value is Orientation {
  return typeof value === "string" && ORIENTATIONS.includes(value as Orientation);
}

export function oppositeGender(gender: Gender): Gender {
  return gender === "male" ? "female" : "male";
}

/**
 * Validates the runtime/wire representation for a single pool.
 * Bisexual users may choose either gender, but never both in the same pool.
 */
export function validatePoolOrientation(input: unknown): PoolOrientationValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, error: "invalid_profile" };
  }

  const candidate = input as Record<string, unknown>;
  if (!isGender(candidate.gender)) {
    return { valid: false, error: "invalid_gender" };
  }
  if (!isOrientation(candidate.orientation)) {
    return { valid: false, error: "invalid_orientation" };
  }
  if (!isGender(candidate.desiredGender)) {
    return { valid: false, error: "invalid_desired_gender" };
  }

  const value: PoolOrientation = {
    gender: candidate.gender,
    orientation: candidate.orientation,
    desiredGender: candidate.desiredGender,
  };

  if (value.orientation === "straight" && value.desiredGender === value.gender) {
    return { valid: false, error: "straight_requires_opposite_gender" };
  }
  if (value.orientation === "gay" && value.desiredGender !== value.gender) {
    return { valid: false, error: "gay_requires_same_gender" };
  }

  return { valid: true, value };
}

function supportsRelationship(orientation: Orientation, sameGender: boolean): boolean {
  if (orientation === "bisexual") return true;
  return sameGender ? orientation === "gay" : orientation === "straight";
}

/**
 * Two users are candidates only when each profile is valid, both target the
 * other's gender, and both orientations support that same-/different-gender
 * relationship. This makes a bisexual user's same-gender pool gay/bi only and
 * their different-gender pool straight/bi only.
 */
export function areMutuallyEligibleCandidates(first: unknown, second: unknown): boolean {
  const firstResult = validatePoolOrientation(first);
  const secondResult = validatePoolOrientation(second);

  if (!firstResult.valid || !secondResult.valid) return false;

  const a = firstResult.value;
  const b = secondResult.value;
  if (a.desiredGender !== b.gender || b.desiredGender !== a.gender) return false;

  const sameGender = a.gender === b.gender;
  return (
    supportsRelationship(a.orientation, sameGender) &&
    supportsRelationship(b.orientation, sameGender)
  );
}
