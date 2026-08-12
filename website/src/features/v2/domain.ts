export type EntityId = string;
export type ISODate = string;
export type ISODateTime = string;

export type Gender = "male" | "female";
export type Orientation = "straight" | "gay" | "bisexual";

export type MatchAvailability = "active" | "paused";
export type FieldVisibility = "matching_only" | "after_match" | "public";

export type EducationLevel =
  | "high_school"
  | "associate"
  | "bachelor"
  | "master"
  | "doctorate"
  | "other";

export type UsStatus =
  | "citizen"
  | "permanent_resident"
  | "h1b"
  | "f1"
  | "j1"
  | "o1"
  | "dependent"
  | "other"
  | "prefer_not_to_say";

export type ReturnIntent =
  | "plan_to_return"
  | "open_to_return"
  | "plan_to_stay"
  | "undecided"
  | "prefer_not_to_say";

export type MaritalHistory =
  | "never_married"
  | "divorced"
  | "widowed"
  | "separated"
  | "prefer_not_to_say";

export type ChildrenStatus =
  | "no_children"
  | "has_children"
  | "prefer_not_to_say";

export type ChildrenIntent = "yes" | "no" | "open" | "undecided";
export type SmokingHabit = "never" | "socially" | "regularly" | "quit";
export type DrinkingHabit = "never" | "socially" | "regularly";
export type RelocationIntent = "yes" | "maybe" | "no";
export type RelationshipGoal = "marriage" | "long_term" | "getting_to_know";
export type EmploymentStatus = "employed" | "self_employed" | "student" | "between_jobs" | "retired" | "other";
export type MarriageTimeline = "within_1_year" | "one_to_three_years" | "three_to_five_years" | "no_timeline" | "undecided";

/**
 * Optional profile facts are deliberately separate from identity and account
 * fields. A value may be used by the matcher without being disclosed in the UI.
 */
export interface ProfileDetails {
  heightCm?: number;
  weightKg?: number;
  school?: string;
  educationLevel?: EducationLevel;
  employmentStatus?: EmploymentStatus;
  occupation?: string;
  company?: string;
  industry?: string;
  city?: string;
  usStatus?: UsStatus;
  returnIntent?: ReturnIntent;
  maritalHistory?: MaritalHistory;
  childrenStatus?: ChildrenStatus;
  childrenIntent?: ChildrenIntent;
  smoking?: SmokingHabit;
  drinking?: DrinkingHabit;
  religion?: string;
  languages?: string[];
  relationshipGoal?: RelationshipGoal;
  marriageTimeline?: MarriageTimeline;
  relocationIntent?: RelocationIntent;
}

export type OptionalProfileFieldId = keyof ProfileDetails;

export type CoreProfileFieldId =
  | "legalName"
  | "displayName"
  | "gender"
  | "orientation"
  | "seekingGender"
  | "birthDate";

export type ProfileFieldId = CoreProfileFieldId | OptionalProfileFieldId;

export interface ContactDetails {
  email: string;
  wechat?: string;
  instagram?: string;
  xiaohongshu?: string;
  linkedin?: string;
}

export type ContactChannel = keyof ContactDetails;

export interface MatchProfile {
  id: EntityId;
  legalName: string;
  displayName: string;
  gender: Gender;
  orientation: Orientation;
  /**
   * A bisexual person still chooses one gender for the current matching pass.
   * The UI can describe changing this value as switching pools, not as changing
   * the person's orientation.
   */
  seekingGender: Gender;
  birthDate: ISODate;
  bio?: string;
  /** Soft introduction only; never interpreted as a hard filter. */
  partnerIntro?: string;
  photoUrl?: string;
  details: ProfileDetails;
  contacts: ContactDetails;
  fieldVisibility: Partial<Record<ProfileFieldId, FieldVisibility>>;
  availability: MatchAvailability;
  profileSchemaVersion: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface NumberRange {
  min?: number;
  max?: number;
}

export type HardFilterRule =
  | { kind: "range"; min?: number; max?: number }
  | { kind: "one_of"; values: string[] }
  | { kind: "equals"; value: string | boolean }
  | { kind: "contains_any"; values: string[] };

export interface MatchCriteria {
  schemaVersion: string;
  targetGender: Gender;
  ageRange: Required<NumberRange>;
  optional: Partial<Record<OptionalProfileFieldId, HardFilterRule>>;
  updatedAt: ISODateTime;
}

export interface CriteriaEvaluation {
  accepted: boolean;
  failedFields: Array<"orientation" | "targetGender" | "age" | OptionalProfileFieldId>;
}

export type PoolType = "event" | "school" | "company";
export type PoolVisibility = "invite_only" | "unlisted" | "public";
export type MatchingMode = "profileSimilarity" | "profileAndQuestionnaire";
export type ContactReleasePolicy = "immediate" | "mutualInterest";

export interface ResultPolicy {
  organizerCanViewPairs: boolean;
  contactReleasePolicy: ContactReleasePolicy;
}

export type CustomQuestionType =
  | "shortText"
  | "longText"
  | "singleSelect"
  | "multiSelect"
  | "boolean";

export interface CustomQuestionOption {
  id: EntityId;
  label: string;
}

export interface CustomQuestion {
  id: EntityId;
  label: string;
  description?: string;
  type: CustomQuestionType;
  required: boolean;
  options?: CustomQuestionOption[];
}

export type PoolStatus =
  | "draft"
  | "open"
  | "registration_closed"
  | "matching"
  | "ready"
  | "revealed"
  | "archived";

export interface PoolLocation {
  mode: "in_person" | "online";
  city?: string;
  venue?: string;
  meetingUrl?: string;
}

export interface Pool {
  id: EntityId;
  slug: string;
  type: PoolType;
  name: string;
  summary: string;
  description: string;
  organizerId: EntityId;
  coverTone: "coral" | "cobalt" | "violet" | "green";
  visibility: PoolVisibility;
  joinCode?: string;
  status: PoolStatus;
  timeZone: string;
  startsAt?: ISODateTime;
  endsAt?: ISODateTime;
  registrationClosesAt?: ISODateTime;
  revealAt?: ISODateTime;
  location?: PoolLocation;
  participantLimit?: number;
  requiredFieldIds: ProfileFieldId[];
  allowCriteriaOverride: boolean;
  matchingMode: MatchingMode;
  resultPolicy: ResultPolicy;
  /** Organizer-defined registration questions. The service enforces <= 10. */
  customQuestions: CustomQuestion[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type MembershipRole = "organizer" | "participant";
export type MembershipStatus =
  | "draft"
  | "confirmed"
  | "withdrawn"
  | "ineligible";

export type CriteriaMode = "inherit" | "custom";

export interface PoolMembership {
  id: EntityId;
  poolId: EntityId;
  userId: EntityId;
  role: MembershipRole;
  /** Organizer accounts opt in explicitly; ordinary participants set this true on join. */
  participatesInMatching: boolean;
  status: MembershipStatus;
  criteriaMode: CriteriaMode;
  criteriaOverride?: MatchCriteria;
  registrationAnswers: Record<string, string | string[] | boolean | number | null>;
  sharedContactTypes: ContactChannel[];
  consentVersion?: string;
  consentedAt?: ISODateTime;
  confirmedAt?: ISODateTime;
  joinedAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type MatchRunStatus = "frozen" | "processing" | "ready" | "revealed" | "failed";

export interface MatchRun {
  id: EntityId;
  poolId: EntityId;
  round: number;
  status: MatchRunStatus;
  triggeredBy: EntityId;
  createdAt: ISODateTime;
  frozenAt: ISODateTime;
  revealAt?: ISODateTime;
  revealedAt?: ISODateTime;
  participantIds: EntityId[];
  unmatchedUserIds: EntityId[];
  matchIds: EntityId[];
  /** A deterministic digest in the real API; a readable token in the demo. */
  snapshotId: string;
}

/** Internal frozen inputs. DatingService never returns these to organizers. */
export interface MatchRunSnapshot {
  runId: EntityId;
  fieldConfigVersion: string;
  profilesByUserId: Record<EntityId, MatchProfile>;
  criteriaByUserId: Record<EntityId, MatchCriteria>;
  membershipsByUserId: Record<EntityId, PoolMembership>;
}

export type MatchResponse = "unseen" | "viewed" | "interested" | "passed";

export interface MatchPair {
  id: EntityId;
  poolId: EntityId;
  runId: EntityId;
  userIds: [EntityId, EntityId];
  compatibilityScore: number;
  compatibilitySummary: string;
  conversationStarters: string[];
  responseByUserId: Record<EntityId, MatchResponse>;
  createdAt: ISODateTime;
  revealedAt?: ISODateTime;
}

export interface MatchPartnerProfile {
  id: EntityId;
  displayName: string;
  age: number;
  gender: Gender;
  bio?: string;
  partnerIntro?: string;
  photoUrl?: string;
  details: Partial<ProfileDetails>;
  /** Omitted until the pool's contact release policy is satisfied. */
  contacts?: Partial<ContactDetails>;
}

export interface MatchView {
  id: EntityId;
  pool: Pool;
  run: MatchRun;
  partner: MatchPartnerProfile;
  compatibilityScore: number;
  compatibilitySummary: string;
  conversationStarters: string[];
  myResponse: MatchResponse;
  partnerSignal: "interested" | "seen" | "unseen";
  contactsUnlocked: boolean;
  createdAt: ISODateTime;
  revealedAt?: ISODateTime;
}

export interface PoolSummary extends Pool {
  participantCount: number;
  confirmedCount: number;
  myMembership?: PoolMembership;
  latestRun?: MatchRun;
}

export interface PublicProfileSummary {
  id: EntityId;
  displayName: string;
  photoUrl?: string;
  bio?: string;
}

export interface PoolDetails extends PoolSummary {
  organizer: PublicProfileSummary;
  members: PoolMembership[];
}

/** Organizer-safe run metadata; participant and outcome identities are omitted. */
export type OrganizerRunSummary = Omit<
  MatchRun,
  "participantIds" | "unmatchedUserIds" | "matchIds"
>;

export interface OrganizerRunReport {
  run: OrganizerRunSummary;
  matchedPairCount: number;
  unmatchedCount: number;
  /** Present only after reveal when resultPolicy.organizerCanViewPairs is true. */
  pairs?: Array<{ matchId: EntityId; displayNames: [string, string] }>;
}

export interface DatingBootstrap {
  currentUser: MatchProfile;
  criteria: MatchCriteria;
  pools: PoolSummary[];
  matches: MatchView[];
}

export interface DemoDatingState {
  schemaVersion: number;
  revision: number;
  currentUserId: EntityId;
  profiles: MatchProfile[];
  criteriaByUserId: Record<EntityId, MatchCriteria>;
  pools: Pool[];
  memberships: PoolMembership[];
  runs: MatchRun[];
  runSnapshotsByRunId: Record<EntityId, MatchRunSnapshot>;
  matches: MatchPair[];
  blockedPairs: Array<[EntityId, EntityId]>;
}

export interface CreatePoolInput {
  type: PoolType;
  name: string;
  summary: string;
  description?: string;
  coverTone?: Pool["coverTone"];
  visibility?: PoolVisibility;
  joinCode?: string;
  timeZone?: string;
  startsAt?: ISODateTime;
  endsAt?: ISODateTime;
  registrationClosesAt?: ISODateTime;
  revealAt?: ISODateTime;
  location?: PoolLocation;
  participantLimit?: number;
  requiredFieldIds?: ProfileFieldId[];
  allowCriteriaOverride?: boolean;
  matchingMode?: MatchingMode;
  resultPolicy?: ResultPolicy;
  customQuestions?: CustomQuestion[];
}

export interface UpdatePoolInput extends Partial<Omit<CreatePoolInput, "type">> {
  status?: PoolStatus;
}

export interface JoinPoolInput {
  joinCode?: string;
  registrationAnswers?: PoolMembership["registrationAnswers"];
  criteriaMode?: CriteriaMode;
  criteriaOverride?: MatchCriteria;
  sharedContactTypes?: ContactChannel[];
}

export type UpdateProfileInput = Partial<
  Omit<MatchProfile, "id" | "createdAt" | "details" | "contacts" | "fieldVisibility">
> & {
  details?: Partial<ProfileDetails>;
  contacts?: Partial<ContactDetails>;
  fieldVisibility?: Partial<Record<ProfileFieldId, FieldVisibility>>;
};

export interface ListPoolsQuery {
  relation?: "all" | "joined" | "organized" | "discoverable";
  type?: PoolType;
  status?: PoolStatus;
}

export type DatingServiceListener = (revision: number) => void;

/**
 * Promise-based on purpose: the demo implementation persists locally, while a
 * backend adapter can implement the same interface without changing the UI.
 */
export interface DatingService {
  bootstrap(): Promise<DatingBootstrap>;
  getCurrentProfile(): Promise<MatchProfile>;
  saveProfile(patch: UpdateProfileInput): Promise<MatchProfile>;
  getCriteria(): Promise<MatchCriteria>;
  saveCriteria(criteria: MatchCriteria): Promise<MatchCriteria>;
  listPools(query?: ListPoolsQuery): Promise<PoolSummary[]>;
  getPool(poolIdOrSlug: EntityId): Promise<PoolDetails>;
  createPool(input: CreatePoolInput): Promise<PoolDetails>;
  updatePool(poolId: EntityId, input: UpdatePoolInput): Promise<PoolDetails>;
  joinPool(poolId: EntityId, input?: JoinPoolInput): Promise<PoolMembership>;
  savePoolRegistration(
    poolId: EntityId,
    answers: PoolMembership["registrationAnswers"],
  ): Promise<PoolMembership>;
  setPoolCriteria(
    poolId: EntityId,
    mode: CriteriaMode,
    criteriaOverride?: MatchCriteria,
  ): Promise<PoolMembership>;
  confirmPoolParticipation(poolId: EntityId): Promise<PoolMembership>;
  leavePool(poolId: EntityId): Promise<void>;
  closePoolRegistration(poolId: EntityId): Promise<PoolDetails>;
  runPoolMatching(poolId: EntityId): Promise<MatchRun>;
  revealMatchRun(runId: EntityId): Promise<MatchRun>;
  getOrganizerRunReport(runId: EntityId): Promise<OrganizerRunReport>;
  listMatches(): Promise<MatchView[]>;
  markMatchViewed(matchId: EntityId): Promise<MatchView>;
  respondToMatch(matchId: EntityId, response: "interested" | "passed"): Promise<MatchView>;
  blockUser(userId: EntityId): Promise<void>;
  resetDemo(): Promise<DatingBootstrap>;
  subscribe(listener: DatingServiceListener): () => void;
}

export function calculateAge(birthDate: ISODate, at: Date = new Date()): number {
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = at.getUTCFullYear() - year;
  const beforeBirthday =
    at.getUTCMonth() + 1 < month ||
    (at.getUTCMonth() + 1 === month && at.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

export function oppositeGender(gender: Gender): Gender {
  return gender === "male" ? "female" : "male";
}

export function isOrientationSelectionValid(
  profile: Pick<MatchProfile, "gender" | "orientation" | "seekingGender">,
): boolean {
  if (profile.orientation === "straight") return profile.seekingGender === oppositeGender(profile.gender);
  if (profile.orientation === "gay") return profile.seekingGender === profile.gender;
  return true;
}

/**
 * Returns the orientations this profile can meet in its currently selected
 * gender lane. This makes the bisexual rule explicit and independently
 * testable:
 * - bisexual + same gender -> gay or bisexual candidates
 * - bisexual + other gender -> straight or bisexual candidates
 */
export function compatibleCandidateOrientations(
  profile: Pick<MatchProfile, "gender" | "orientation" | "seekingGender">,
): Orientation[] {
  const seekingSameGender = profile.seekingGender === profile.gender;
  if (profile.orientation === "bisexual") {
    return seekingSameGender ? ["gay", "bisexual"] : ["straight", "bisexual"];
  }
  return profile.orientation === "gay" ? ["gay", "bisexual"] : ["straight", "bisexual"];
}

/** Both users must be in each other's selected gender lane and orientation set. */
export function areProfilesOrientationCompatible(
  a: Pick<MatchProfile, "gender" | "orientation" | "seekingGender">,
  b: Pick<MatchProfile, "gender" | "orientation" | "seekingGender">,
): boolean {
  if (!isOrientationSelectionValid(a) || !isOrientationSelectionValid(b)) return false;
  return (
    a.seekingGender === b.gender &&
    b.seekingGender === a.gender &&
    compatibleCandidateOrientations(a).includes(b.orientation) &&
    compatibleCandidateOrientations(b).includes(a.orientation)
  );
}
