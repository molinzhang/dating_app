import {
  calculateAge,
  isOrientationSelectionValid,
  type CriteriaEvaluation,
  type CreatePoolInput,
  type DatingBootstrap,
  type DatingService,
  type DatingServiceListener,
  type DemoDatingState,
  type EntityId,
  type HardFilterRule,
  type JoinPoolInput,
  type ListPoolsQuery,
  type MatchCriteria,
  type MatchPair,
  type MatchProfile,
  type MatchRun,
  type MatchView,
  type OptionalProfileFieldId,
  type OrganizerRunReport,
  type Pool,
  type PoolDetails,
  type PoolMembership,
  type PoolSummary,
  type ProfileFieldId,
  type UpdatePoolInput,
  type UpdateProfileInput,
} from "./domain";
import {
  MATCH_CRITERIA_CONFIG_VERSION,
  PROFILE_FIELD_CONFIG_VERSION,
  profileFieldConfig,
} from "./field-config";
import { areMutuallyEligibleCandidates } from "./orientation";

export const DEMO_STORAGE_KEY = "common-ground:v2-demo-state";
export const DEMO_STATE_SCHEMA_VERSION = 4;
export const DEMO_CONSENT_VERSION = "2026-08-11.v1";

export type DatingServiceErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT";

export class DatingServiceError extends Error {
  constructor(
    public readonly code: DatingServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DatingServiceError";
  }
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DemoDatingServiceOptions {
  storage?: StorageLike;
  now?: () => Date;
}

function clone<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function iso(value: Date): string {
  return value.toISOString();
}

function defaultVisibility(): MatchProfile["fieldVisibility"] {
  return Object.fromEntries(
    profileFieldConfig.fields.map((field) => [field.id, field.defaultVisibility]),
  );
}

function seedProfile(
  now: Date,
  input: Omit<MatchProfile, "fieldVisibility" | "profileSchemaVersion" | "createdAt" | "updatedAt">,
): MatchProfile {
  return {
    ...input,
    fieldVisibility: defaultVisibility(),
    profileSchemaVersion: PROFILE_FIELD_CONFIG_VERSION,
    createdAt: iso(addDays(now, -60)),
    updatedAt: iso(addDays(now, -2)),
  };
}

function seedCriteria(
  now: Date,
  profile: MatchProfile,
  input?: Partial<Pick<MatchCriteria, "ageRange" | "optional">>,
): MatchCriteria {
  return {
    schemaVersion: MATCH_CRITERIA_CONFIG_VERSION,
    targetGender: profile.seekingGender,
    ageRange: input?.ageRange ?? { min: 25, max: 42 },
    optional: input?.optional ?? {},
    updatedAt: iso(addDays(now, -2)),
  };
}

/**
 * Creates a fresh, date-relative state so the upcoming event remains useful in
 * demos instead of aging into the past. It intentionally includes all four
 * currently supported lanes: straight pairs, gay pairs, bisexual selecting the
 * same gender, and bisexual selecting the other gender.
 */
export function createSeedState(at: Date = new Date()): DemoDatingState {
  const profiles: MatchProfile[] = [
    seedProfile(at, {
      id: "user-lin-zhixia",
      legalName: "林知夏",
      displayName: "知夏",
      gender: "female",
      orientation: "bisexual",
      seekingGender: "female",
      birthDate: "1994-05-18",
      bio: "在旧金山做产品设计，周末喜欢逛书店、爬轻松的山，也愿意为一顿好吃的开车一小时。",
      partnerIntro: "希望认识愿意认真沟通、也尊重彼此独立空间的人。这里是一段软性介绍，不会作为必要条件。",
      photoUrl: "/example_girl.webp",
      details: {
        heightCm: 166,
        weightKg: 55,
        school: "UC Berkeley",
        educationLevel: "master",
        employmentStatus: "employed",
        occupation: "产品设计师",
        company: "独立设计团队",
        industry: "technology",
        city: "San Francisco",
        usStatus: "h1b",
        returnIntent: "open_to_return",
        maritalHistory: "never_married",
        childrenStatus: "no_children",
        childrenIntent: "open",
        smoking: "never",
        drinking: "socially",
        languages: ["zh-CN", "en"],
        relationshipGoal: "long_term",
        marriageTimeline: "one_to_three_years",
        relocationIntent: "maybe",
      },
      contacts: { email: "zhixia@example.com", wechat: "summerlin_sf", instagram: "@summerlin.sf" },
      availability: "active",
    }),
    seedProfile(at, {
      id: "user-zhou-anran",
      legalName: "周安然",
      displayName: "安然",
      gender: "female",
      orientation: "gay",
      seekingGender: "female",
      birthDate: "1992-11-03",
      bio: "城市规划师，喜欢建筑、胶片和长距离散步。希望认识能认真沟通，也保留各自空间的人。",
      photoUrl: "/example_girl.webp",
      details: {
        heightCm: 170, weightKg: 58, school: "UCLA", educationLevel: "master",
        occupation: "城市规划师", industry: "public_service", city: "Oakland",
        usStatus: "permanent_resident", returnIntent: "open_to_return", maritalHistory: "never_married",
        childrenStatus: "no_children", childrenIntent: "open", smoking: "never", drinking: "socially",
        languages: ["zh-CN", "en"], relationshipGoal: "long_term", relocationIntent: "maybe",
      },
      contacts: { email: "anran@example.com", wechat: "anran_walks" },
      availability: "active",
    }),
    seedProfile(at, {
      id: "user-shen-qing",
      legalName: "沈晴",
      displayName: "晴晴",
      gender: "female",
      orientation: "straight",
      seekingGender: "male",
      birthDate: "1996-02-14",
      bio: "医疗数据研究员，最近在学陶艺。喜欢稳定、坦诚又有一点幽默感的关系。",
      details: {
        heightCm: 162, school: "University of Washington", educationLevel: "doctorate",
        occupation: "医疗数据研究员", industry: "healthcare", city: "San Francisco",
        usStatus: "f1", returnIntent: "undecided", maritalHistory: "never_married",
        childrenStatus: "no_children", childrenIntent: "yes", smoking: "never", drinking: "never",
        languages: ["zh-CN", "en"], relationshipGoal: "marriage", relocationIntent: "maybe",
      },
      contacts: { email: "qing@example.com", instagram: "@qing.makes" },
      availability: "active",
    }),
    seedProfile(at, {
      id: "user-gu-yan",
      legalName: "顾言",
      displayName: "顾言",
      gender: "male",
      orientation: "bisexual",
      seekingGender: "female",
      birthDate: "1993-08-27",
      bio: "做气候科技投资，也认真做饭。现在这一轮希望认识女生。",
      photoUrl: "/example_boy.webp",
      details: {
        heightCm: 181, school: "Stanford University", educationLevel: "master",
        occupation: "投资经理", industry: "finance", city: "San Francisco",
        usStatus: "citizen", returnIntent: "open_to_return", maritalHistory: "never_married",
        childrenStatus: "no_children", childrenIntent: "yes", smoking: "never", drinking: "socially",
        languages: ["zh-CN", "en"], relationshipGoal: "long_term", relocationIntent: "yes",
      },
      contacts: { email: "guyan@example.com", wechat: "guyan_climate" },
      availability: "active",
    }),
    seedProfile(at, {
      id: "user-chen-yu",
      legalName: "陈屿",
      displayName: "陈屿",
      gender: "male",
      orientation: "straight",
      seekingGender: "female",
      birthDate: "1991-06-09",
      bio: "后端工程师和业余咖啡烘焙玩家，希望把线上认识自然地带到线下。",
      photoUrl: "/example_boy.webp",
      details: {
        heightCm: 178, school: "Carnegie Mellon University", educationLevel: "master",
        occupation: "软件工程师", industry: "technology", city: "San Jose",
        usStatus: "h1b", returnIntent: "plan_to_stay", maritalHistory: "never_married",
        childrenStatus: "no_children", childrenIntent: "yes", smoking: "never", drinking: "socially",
        languages: ["zh-CN", "en"], relationshipGoal: "marriage", relocationIntent: "maybe",
      },
      contacts: { email: "chenyu@example.com", wechat: "islandbrew" },
      availability: "active",
    }),
    seedProfile(at, {
      id: "user-lu-chuan",
      legalName: "陆川",
      displayName: "川",
      gender: "male",
      orientation: "gay",
      seekingGender: "male",
      birthDate: "1995-12-21",
      bio: "教育科技产品经理，跑步很慢但从不缺席。喜欢温柔直接的交流。",
      details: {
        heightCm: 175, school: "NYU", educationLevel: "master", occupation: "产品经理",
        industry: "education", city: "Oakland", usStatus: "o1", returnIntent: "undecided",
        maritalHistory: "never_married", childrenStatus: "no_children", childrenIntent: "no",
        smoking: "never", drinking: "socially", languages: ["zh-CN", "en"],
        relationshipGoal: "long_term", relocationIntent: "maybe",
      },
      contacts: { email: "luchuan@example.com", instagram: "@river.runs" },
      availability: "active",
    }),
    seedProfile(at, {
      id: "user-cheng-yue",
      legalName: "程越",
      displayName: "阿越",
      gender: "male",
      orientation: "bisexual",
      seekingGender: "male",
      birthDate: "1994-09-16",
      bio: "独立纪录片剪辑师。这一轮希望认识男生，偏爱有好奇心、能一起看世界的人。",
      details: {
        heightCm: 180, school: "USC", educationLevel: "bachelor", occupation: "影视剪辑师",
        industry: "creative", city: "San Francisco", usStatus: "citizen", returnIntent: "open_to_return",
        maritalHistory: "never_married", childrenStatus: "no_children", childrenIntent: "open",
        smoking: "socially", drinking: "socially", languages: ["zh-CN", "en"],
        relationshipGoal: "getting_to_know", relocationIntent: "yes",
      },
      contacts: { email: "chengyue@example.com", instagram: "@over.the.cut" },
      availability: "active",
    }),
  ];

  const criteriaByUserId = Object.fromEntries(
    profiles.map((profile) => [profile.id, seedCriteria(at, profile)]),
  ) as Record<EntityId, MatchCriteria>;
  criteriaByUserId["user-lin-zhixia"] = seedCriteria(at, profiles[0], {
    ageRange: { min: 27, max: 38 },
    optional: {
      city: { kind: "one_of", values: ["San Francisco", "Oakland"] },
      smoking: { kind: "one_of", values: ["never", "socially"] },
      relationshipGoal: { kind: "one_of", values: ["long_term", "marriage"] },
    },
  });

  const pools: Pool[] = [
    {
      id: "pool-bay-walk",
      slug: "bay-area-sunset-walk",
      type: "event",
      name: "湾区夏日晚风散步",
      summary: "六到十人的轻松散步，活动前完成一对一匹配。",
      description: "从渡轮大楼出发，沿海边散步到咖啡馆。匹配结果只会发给参与者本人，现场不公开配对名单。",
      organizerId: "user-lin-zhixia",
      coverTone: "coral",
      visibility: "public",
      status: "open",
      timeZone: "America/Los_Angeles",
      startsAt: iso(addDays(at, 12)),
      endsAt: iso(addDays(at, 12.12)),
      registrationClosesAt: iso(addDays(at, 8)),
      revealAt: iso(addDays(at, 9)),
      location: { mode: "in_person", city: "San Francisco", venue: "Ferry Building 北门" },
      participantLimit: 12,
      requiredFieldIds: ["displayName", "birthDate", "city"],
      allowCriteriaOverride: true,
      matchingMode: "profileAndQuestionnaire",
      resultPolicy: { organizerCanViewPairs: false, contactReleasePolicy: "mutualInterest" },
      customQuestions: [
        {
          id: "q-arrival",
          label: "你预计几点到？",
          type: "singleSelect",
          required: true,
          options: [
            { id: "on-time", label: "准时到" },
            { id: "late-15", label: "可能晚 15 分钟以内" },
          ],
        },
        {
          id: "q-note",
          label: "有什么需要组织者提前知道的吗？",
          description: "例如无障碍需求或饮食限制；不会用于匹配。",
          type: "longText",
          required: false,
        },
      ],
      createdAt: iso(addDays(at, -8)),
      updatedAt: iso(addDays(at, -1)),
    },
    {
      id: "pool-cal-alumni",
      slug: "cal-alumni-august",
      type: "event",
      name: "Cal 校友八月小聚",
      summary: "经校友邮箱邀请加入的湾区线下小聚。",
      description: "一轮已经完成并揭晓。活动组织者只能看到匹配完成数量，不会看到谁和谁被匹配。",
      organizerId: "user-gu-yan",
      coverTone: "cobalt",
      visibility: "invite_only",
      joinCode: "GOBEARS26",
      status: "revealed",
      timeZone: "America/Los_Angeles",
      startsAt: iso(addDays(at, 3)),
      endsAt: iso(addDays(at, 3.12)),
      registrationClosesAt: iso(addDays(at, -3)),
      revealAt: iso(addDays(at, -1)),
      location: { mode: "in_person", city: "Berkeley", venue: "Faculty Glade" },
      participantLimit: 20,
      requiredFieldIds: ["displayName", "birthDate", "school", "city"],
      allowCriteriaOverride: false,
      matchingMode: "profileAndQuestionnaire",
      resultPolicy: { organizerCanViewPairs: false, contactReleasePolicy: "mutualInterest" },
      customQuestions: [
        { id: "q-grad-year", label: "毕业年份", type: "shortText", required: true },
        {
          id: "q-program",
          label: "你更想参加哪一段？",
          type: "multiSelect",
          required: true,
          options: [
            { id: "picnic", label: "草坪野餐" },
            { id: "walk", label: "校园散步" },
            { id: "coffee", label: "活动后咖啡" },
          ],
        },
      ],
      createdAt: iso(addDays(at, -24)),
      updatedAt: iso(addDays(at, -1)),
    },
    {
      id: "pool-design-community",
      slug: "design-community-coffee",
      type: "event",
      name: "设计社区周五 Coffee Chat",
      summary: "受邀成员的小范围线下认识活动。",
      description: "报名仍在开放；你可以沿用全局硬性条件，或为本活动单独设置。",
      organizerId: "user-zhou-anran",
      coverTone: "violet",
      visibility: "invite_only",
      joinCode: "DESIGNFRI",
      status: "open",
      timeZone: "America/Los_Angeles",
      startsAt: iso(addDays(at, 20)),
      endsAt: iso(addDays(at, 20.08)),
      registrationClosesAt: iso(addDays(at, 16)),
      revealAt: iso(addDays(at, 18)),
      location: { mode: "in_person", city: "Oakland", venue: "Kinfolx Cafe" },
      participantLimit: 16,
      requiredFieldIds: ["displayName", "birthDate", "occupation", "city"],
      allowCriteriaOverride: true,
      matchingMode: "profileSimilarity",
      resultPolicy: { organizerCanViewPairs: false, contactReleasePolicy: "immediate" },
      customQuestions: [
        { id: "q-first-event", label: "这是你第一次参加社区活动吗？", type: "boolean", required: true },
      ],
      createdAt: iso(addDays(at, -4)),
      updatedAt: iso(addDays(at, -1)),
    },
    {
      id: "pool-bookstore-reading",
      slug: "bookstore-reading-night",
      type: "event",
      name: "周末书店交换阅读",
      summary: "一场已经揭晓的小型阅读活动，本轮保留了未匹配结果示例。",
      description: "参与者先交换一本最近喜欢的书，再由系统在活动前完成一次双向条件匹配。",
      organizerId: "user-chen-yu",
      coverTone: "green",
      visibility: "unlisted",
      status: "revealed",
      timeZone: "America/Los_Angeles",
      startsAt: iso(addDays(at, 5)),
      endsAt: iso(addDays(at, 5.1)),
      registrationClosesAt: iso(addDays(at, -4)),
      revealAt: iso(addDays(at, -2)),
      location: { mode: "in_person", city: "San Francisco", venue: "Green Apple Books" },
      participantLimit: 8,
      requiredFieldIds: ["displayName", "birthDate", "city"],
      allowCriteriaOverride: true,
      matchingMode: "profileSimilarity",
      resultPolicy: { organizerCanViewPairs: false, contactReleasePolicy: "mutualInterest" },
      customQuestions: [],
      createdAt: iso(addDays(at, -14)),
      updatedAt: iso(addDays(at, -2)),
    },
  ];

  const allIds = profiles.map((profile) => profile.id);
  const memberships: PoolMembership[] = [
    ...allIds.map((userId, index): PoolMembership => ({
      id: `member-walk-${index + 1}`,
      poolId: "pool-bay-walk",
      userId,
      role: userId === "user-lin-zhixia" ? "organizer" : "participant",
      participatesInMatching: userId !== "user-lin-zhixia",
      status: "confirmed",
      criteriaMode: "inherit",
      registrationAnswers: { "q-arrival": "on-time", "q-note": "" },
      sharedContactTypes: ["email"],
      consentVersion: userId === "user-lin-zhixia" ? undefined : DEMO_CONSENT_VERSION,
      consentedAt: userId === "user-lin-zhixia" ? undefined : iso(addDays(at, -6)),
      confirmedAt: iso(addDays(at, -5)),
      joinedAt: iso(addDays(at, -7)),
      updatedAt: iso(addDays(at, -5)),
    })),
    ...allIds.slice(0, 6).map((userId, index): PoolMembership => ({
      id: `member-cal-${index + 1}`,
      poolId: "pool-cal-alumni",
      userId,
      role: userId === "user-gu-yan" ? "organizer" : "participant",
      // This completed seed run includes the organizer in a pair, so the
      // organizer has completed the same explicit opt-in and consent flow.
      participatesInMatching: true,
      status: "confirmed",
      criteriaMode: "inherit",
      registrationAnswers: { "q-grad-year": String(2016 + (index % 5)), "q-program": ["picnic", "walk"] },
      sharedContactTypes: ["email", "wechat"],
      consentVersion: DEMO_CONSENT_VERSION,
      consentedAt: iso(addDays(at, -12)),
      confirmedAt: iso(addDays(at, -10)),
      joinedAt: iso(addDays(at, -14)),
      updatedAt: iso(addDays(at, -10)),
    })),
    {
      id: "member-design-current",
      poolId: "pool-design-community",
      userId: "user-lin-zhixia",
      role: "participant",
      participatesInMatching: true,
      status: "draft",
      criteriaMode: "inherit",
      registrationAnswers: {},
      sharedContactTypes: ["email"],
      joinedAt: iso(addDays(at, -1)),
      updatedAt: iso(addDays(at, -1)),
    },
    {
      id: "member-design-host",
      poolId: "pool-design-community",
      userId: "user-zhou-anran",
      role: "organizer",
      participatesInMatching: false,
      status: "confirmed",
      criteriaMode: "inherit",
      registrationAnswers: { "q-first-event": false },
      sharedContactTypes: ["email"],
      confirmedAt: iso(addDays(at, -4)),
      joinedAt: iso(addDays(at, -4)),
      updatedAt: iso(addDays(at, -4)),
    },
    {
      id: "member-bookstore-current",
      poolId: "pool-bookstore-reading",
      userId: "user-lin-zhixia",
      role: "participant",
      participatesInMatching: true,
      status: "confirmed",
      criteriaMode: "inherit",
      registrationAnswers: {},
      sharedContactTypes: ["email"],
      consentVersion: DEMO_CONSENT_VERSION,
      consentedAt: iso(addDays(at, -6)),
      confirmedAt: iso(addDays(at, -6)),
      joinedAt: iso(addDays(at, -7)),
      updatedAt: iso(addDays(at, -6)),
    },
    {
      id: "member-bookstore-host",
      poolId: "pool-bookstore-reading",
      userId: "user-chen-yu",
      role: "organizer",
      participatesInMatching: false,
      status: "confirmed",
      criteriaMode: "inherit",
      registrationAnswers: {},
      sharedContactTypes: ["email"],
      confirmedAt: iso(addDays(at, -10)),
      joinedAt: iso(addDays(at, -12)),
      updatedAt: iso(addDays(at, -10)),
    },
  ];

  const revealedAt = iso(addDays(at, -1));
  const runs: MatchRun[] = [
    {
      id: "run-cal-1",
      poolId: "pool-cal-alumni",
      round: 1,
      status: "revealed",
      triggeredBy: "user-gu-yan",
      createdAt: iso(addDays(at, -2)),
      frozenAt: iso(addDays(at, -2)),
      revealAt: revealedAt,
      revealedAt,
      participantIds: allIds.slice(0, 6),
      unmatchedUserIds: [],
      matchIds: ["match-cal-1", "match-cal-2", "match-cal-3"],
      snapshotId: "cal-1-demo-snapshot",
    },
    {
      id: "run-bookstore-1",
      poolId: "pool-bookstore-reading",
      round: 1,
      status: "revealed",
      triggeredBy: "user-chen-yu",
      createdAt: iso(addDays(at, -3)),
      frozenAt: iso(addDays(at, -3)),
      revealAt: iso(addDays(at, -2)),
      revealedAt: iso(addDays(at, -2)),
      participantIds: ["user-lin-zhixia"],
      unmatchedUserIds: ["user-lin-zhixia"],
      matchIds: [],
      snapshotId: "bookstore-1-demo-snapshot",
    },
  ];

  const matches: MatchPair[] = [
    {
      id: "match-cal-1", poolId: "pool-cal-alumni", runId: "run-cal-1",
      userIds: ["user-lin-zhixia", "user-zhou-anran"], compatibilityScore: 91,
      compatibilitySummary: "你们都重视稳定沟通，也愿意为彼此保留独立空间。",
      conversationStarters: ["最近一次让你愿意走很远的城市角落", "你如何理解关系里的独立空间"],
      responseByUserId: { "user-lin-zhixia": "viewed", "user-zhou-anran": "interested" },
      createdAt: iso(addDays(at, -2)), revealedAt,
    },
    {
      id: "match-cal-2", poolId: "pool-cal-alumni", runId: "run-cal-1",
      userIds: ["user-shen-qing", "user-gu-yan"], compatibilityScore: 86,
      compatibilitySummary: "你们对长期关系和生活规划有相近期待。",
      conversationStarters: ["最近学会的一件小事", "理想周末的一天"],
      responseByUserId: { "user-shen-qing": "unseen", "user-gu-yan": "viewed" },
      createdAt: iso(addDays(at, -2)), revealedAt,
    },
    {
      id: "match-cal-3", poolId: "pool-cal-alumni", runId: "run-cal-1",
      userIds: ["user-lu-chuan", "user-cheng-yue"], compatibilityScore: 83,
      compatibilitySummary: "你们都对新的体验保持好奇，也偏好坦诚的沟通。",
      conversationStarters: ["一部最近反复想起的电影", "最想一起探索的城市"],
      responseByUserId: { "user-lu-chuan": "interested", "user-cheng-yue": "interested" },
      createdAt: iso(addDays(at, -2)), revealedAt,
    },
  ];

  return {
    schemaVersion: DEMO_STATE_SCHEMA_VERSION,
    revision: 1,
    currentUserId: "user-lin-zhixia",
    profiles,
    criteriaByUserId,
    pools,
    memberships,
    runs,
    runSnapshotsByRunId: {
      "run-cal-1": {
        runId: "run-cal-1",
        fieldConfigVersion: PROFILE_FIELD_CONFIG_VERSION,
        profilesByUserId: Object.fromEntries(
          profiles.slice(0, 6).map((profile) => [profile.id, clone(profile)]),
        ),
        criteriaByUserId: Object.fromEntries(
          allIds.slice(0, 6).map((userId) => [userId, clone(criteriaByUserId[userId])]),
        ),
        membershipsByUserId: Object.fromEntries(memberships.filter(item => item.poolId === "pool-cal-alumni" && item.participatesInMatching).map(item => [item.userId, clone(item)])),
      },
      "run-bookstore-1": {
        runId: "run-bookstore-1",
        fieldConfigVersion: PROFILE_FIELD_CONFIG_VERSION,
        profilesByUserId: { "user-lin-zhixia": clone(profiles[0]) },
        criteriaByUserId: { "user-lin-zhixia": clone(criteriaByUserId["user-lin-zhixia"]) },
        membershipsByUserId: { "user-lin-zhixia": clone(memberships.find(item => item.id === "member-bookstore-current")!) },
      },
    },
    matches,
    blockedPairs: [],
  };
}

function profileFieldValue(profile: MatchProfile, fieldId: ProfileFieldId): unknown {
  if (fieldId in profile.details) return profile.details[fieldId as OptionalProfileFieldId];
  return profile[fieldId as keyof MatchProfile];
}

function passesRule(value: unknown, rule: HardFilterRule): boolean {
  if (value === undefined || value === null || value === "") return false;
  switch (rule.kind) {
    case "range":
      return (
        typeof value === "number" &&
        (rule.min === undefined || value >= rule.min) &&
        (rule.max === undefined || value <= rule.max)
      );
    case "one_of":
      return Array.isArray(value)
        ? value.some((item) => rule.values.includes(String(item)))
        : rule.values.includes(String(value));
    case "equals":
      return value === rule.value;
    case "contains_any":
      return Array.isArray(value) && value.some((item) => rule.values.includes(String(item)));
  }
}

export function evaluateCandidateAgainstCriteria(
  viewer: MatchProfile,
  candidate: MatchProfile,
  criteria: MatchCriteria,
  at: Date = new Date(),
  candidateCriteria?: MatchCriteria,
): CriteriaEvaluation {
  const failedFields: CriteriaEvaluation["failedFields"] = [];
  const viewerLane = { ...viewer, seekingGender: criteria.targetGender };
  const candidateLane = {
    ...candidate,
    seekingGender: candidateCriteria?.targetGender ?? candidate.seekingGender,
  };
  if (!areMutuallyEligibleCandidates(
    { gender: viewerLane.gender, orientation: viewerLane.orientation, desiredGender: viewerLane.seekingGender },
    { gender: candidateLane.gender, orientation: candidateLane.orientation, desiredGender: candidateLane.seekingGender },
  )) failedFields.push("orientation");
  if (criteria.targetGender !== candidate.gender) failedFields.push("targetGender");
  const age = calculateAge(candidate.birthDate, at);
  if (age < criteria.ageRange.min || age > criteria.ageRange.max) failedFields.push("age");
  for (const [fieldId, rule] of Object.entries(criteria.optional) as Array<
    [OptionalProfileFieldId, HardFilterRule | undefined]
  >) {
    if (rule && !passesRule(profileFieldValue(candidate, fieldId), rule)) failedFields.push(fieldId);
  }
  return { accepted: failedFields.length === 0, failedFields };
}

export function areMutuallyEligible(
  a: MatchProfile,
  aCriteria: MatchCriteria,
  b: MatchProfile,
  bCriteria: MatchCriteria,
  at: Date = new Date(),
): boolean {
  return (
    evaluateCandidateAgainstCriteria(a, b, aCriteria, at, bCriteria).accepted &&
    evaluateCandidateAgainstCriteria(b, a, bCriteria, at, aCriteria).accepted
  );
}

function validateCriteria(profile: MatchProfile, criteria: MatchCriteria): void {
  if (!isOrientationSelectionValid({ ...profile, seekingGender: criteria.targetGender })) {
    throw new DatingServiceError("VALIDATION", "当前性取向与所选匹配性别不一致。");
  }
  if (
    !Number.isInteger(criteria.ageRange.min) ||
    !Number.isInteger(criteria.ageRange.max) ||
    criteria.ageRange.min < 18 ||
    criteria.ageRange.max > 99 ||
    criteria.ageRange.min > criteria.ageRange.max
  ) {
    throw new DatingServiceError("VALIDATION", "目标年龄范围需为 18–99 岁，且最小年龄不能大于最大年龄。");
  }
  const optionalEntries = Object.entries(criteria.optional) as Array<
    [OptionalProfileFieldId, HardFilterRule | undefined]
  >;
  for (const [fieldId, rule] of optionalEntries) {
    if (!rule) continue;
    const definition = profileFieldConfig.fields.find((field) => field.id === fieldId);
    if (!definition?.hardFilterEnabled || definition.filterKind !== rule.kind) {
      throw new DatingServiceError("VALIDATION", `“${definition?.label ?? fieldId}”不支持这个筛选方式。`);
    }
    if ((rule.kind === "one_of" || rule.kind === "contains_any") && rule.values.length === 0) {
      throw new DatingServiceError("VALIDATION", `请为“${definition.label}”选择至少一个可接受值。`);
    }
    if (rule.kind === "range") {
      if (rule.min === undefined && rule.max === undefined) {
        throw new DatingServiceError("VALIDATION", `请为“${definition.label}”填写范围。`);
      }
      if (rule.min !== undefined && rule.max !== undefined && rule.min > rule.max) {
        throw new DatingServiceError("VALIDATION", `“${definition.label}”的最小值不能大于最大值。`);
      }
      if (rule.min !== undefined && definition.min !== undefined && rule.min < definition.min) {
        throw new DatingServiceError("VALIDATION", `“${definition.label}”不能小于 ${definition.min}${definition.unit ?? ""}。`);
      }
      if (rule.max !== undefined && definition.max !== undefined && rule.max > definition.max) {
        throw new DatingServiceError("VALIDATION", `“${definition.label}”不能大于 ${definition.max}${definition.unit ?? ""}。`);
      }
    }
  }
}

function validateCustomQuestions(pool: Pick<Pool, "customQuestions">): void {
  if (pool.customQuestions.length > 10) {
    throw new DatingServiceError("VALIDATION", "每个匹配池最多可以设置 10 个报名问题。");
  }
  const ids = new Set<string>();
  for (const question of pool.customQuestions) {
    if (!question.id.trim() || !question.label.trim()) {
      throw new DatingServiceError("VALIDATION", "报名问题需要完整的 id 和标题。");
    }
    if (ids.has(question.id)) throw new DatingServiceError("VALIDATION", "报名问题 id 不能重复。");
    ids.add(question.id);
    if (
      (question.type === "singleSelect" || question.type === "multiSelect") &&
      (!question.options || question.options.length < 2)
    ) {
      throw new DatingServiceError("VALIDATION", "单选或多选问题至少需要两个选项。");
    }
  }
}

function requiredAnswersComplete(pool: Pool, membership: PoolMembership): boolean {
  return pool.customQuestions.every((question) => {
    if (!question.required) return true;
    const value = membership.registrationAnswers[question.id];
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== "";
  });
}

function validateRegistrationAnswers(
  pool: Pool,
  answers: PoolMembership["registrationAnswers"],
  requireComplete: boolean,
): void {
  for (const question of pool.customQuestions) {
    const value = answers[question.id];
    const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    if (empty) {
      if (requireComplete && question.required) {
        throw new DatingServiceError("VALIDATION", `请回答“${question.label}”。`);
      }
      continue;
    }
    const optionIds = new Set((question.options ?? []).map((option) => option.id));
    const valid =
      ((question.type === "shortText" || question.type === "longText") && typeof value === "string") ||
      (question.type === "boolean" && typeof value === "boolean") ||
      (question.type === "singleSelect" && typeof value === "string" && optionIds.has(value)) ||
      (question.type === "multiSelect" && Array.isArray(value) && value.every((item) => typeof item === "string" && optionIds.has(item)));
    if (!valid) throw new DatingServiceError("VALIDATION", `“${question.label}”的答案格式不正确。`);
  }
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function similarityScore(a: MatchProfile, b: MatchProfile, pool: Pool): number {
  let score = 66;
  if (a.details.city && a.details.city === b.details.city) score += 8;
  if (a.details.relationshipGoal && a.details.relationshipGoal === b.details.relationshipGoal) score += 7;
  if (a.details.smoking && a.details.smoking === b.details.smoking) score += 4;
  if (a.details.childrenIntent && a.details.childrenIntent === b.details.childrenIntent) score += 4;
  if (a.details.returnIntent && a.details.returnIntent === b.details.returnIntent) score += 3;
  const aLanguages = new Set(a.details.languages ?? []);
  if ((b.details.languages ?? []).some((language) => aLanguages.has(language))) score += 4;
  if (pool.matchingMode === "profileAndQuestionnaire") {
    // Deterministic demo stand-in for the existing 24-question compatibility.
    score += 5 + (stableHash([...a.id, b.id].sort().join("|")) % 7);
  }
  return Math.min(98, score);
}

function startersFor(a: MatchProfile, b: MatchProfile): string[] {
  const starters: string[] = [];
  if (a.details.city === b.details.city) starters.push(`你们都在 ${a.details.city}，最近各自发现了什么好去处？`);
  if (a.details.industry === b.details.industry) starters.push("同一个行业里，什么工作瞬间最让你有成就感？");
  if ((a.details.languages ?? []).some((value) => (b.details.languages ?? []).includes(value))) {
    starters.push("如果一起安排一个没有工作消息的周末，你会怎么过？");
  }
  return (starters.length ? starters : ["最近有什么让你持续好奇的事情？", "你理想中的线下第一次见面是什么样？"]).slice(0, 2);
}

function summaryFor(score: number): string {
  if (score >= 88) return "你们在生活节奏、长期期待和沟通方式上有不少共同点。";
  if (score >= 78) return "你们有稳定的共同基础，也留有一些值得当面聊聊的差异。";
  return "你们满足彼此的必要条件，可以从共同兴趣开始认识。";
}

class LocalDatingService implements DatingService {
  private readonly storage?: StorageLike;
  private readonly now: () => Date;
  private readonly listeners = new Set<DatingServiceListener>();
  private memoryState: DemoDatingState;

  constructor(options: DemoDatingServiceOptions = {}) {
    this.storage = options.storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    this.now = options.now ?? (() => new Date());
    this.memoryState = createSeedState(this.now());
  }

  private read(): DemoDatingState {
    const raw = this.storage?.getItem(DEMO_STORAGE_KEY);
    if (!raw) return clone(this.memoryState);
    try {
      const parsed = JSON.parse(raw) as DemoDatingState;
      if (parsed.schemaVersion !== DEMO_STATE_SCHEMA_VERSION) return clone(this.memoryState);
      return parsed;
    } catch {
      return clone(this.memoryState);
    }
  }

  private write(state: DemoDatingState): DemoDatingState {
    const next = { ...state, revision: state.revision + 1 };
    this.memoryState = clone(next);
    this.storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(next));
    this.listeners.forEach((listener) => listener(next.revision));
    return next;
  }

  private currentProfile(state: DemoDatingState): MatchProfile {
    const profile = state.profiles.find((item) => item.id === state.currentUserId);
    if (!profile) throw new DatingServiceError("NOT_FOUND", "找不到当前用户资料。");
    return profile;
  }

  private findPool(state: DemoDatingState, idOrSlug: EntityId): Pool {
    const pool = state.pools.find((item) => item.id === idOrSlug || item.slug === idOrSlug);
    if (!pool) throw new DatingServiceError("NOT_FOUND", "找不到这个活动或匹配圈。");
    return pool;
  }

  private membership(state: DemoDatingState, poolId: EntityId, userId = state.currentUserId): PoolMembership | undefined {
    return state.memberships.find((item) => item.poolId === poolId && item.userId === userId);
  }

  private assertOrganizer(state: DemoDatingState, pool: Pool): void {
    if (pool.organizerId !== state.currentUserId) {
      throw new DatingServiceError("FORBIDDEN", "只有组织者可以进行这个操作。");
    }
  }

  private summary(state: DemoDatingState, pool: Pool): PoolSummary {
    const members = state.memberships.filter((item) => item.poolId === pool.id && item.status !== "withdrawn");
    const participants = members.filter((item) => item.participatesInMatching);
    const latestRun = state.runs
      .filter((run) => run.poolId === pool.id)
      .sort((a, b) => b.round - a.round)[0];
    const visibleRun = latestRun && pool.organizerId !== state.currentUserId
      ? {
          ...latestRun,
          participantIds: latestRun.participantIds.includes(state.currentUserId) ? [state.currentUserId] : [],
          unmatchedUserIds: latestRun.status === "revealed" && latestRun.unmatchedUserIds.includes(state.currentUserId)
            ? [state.currentUserId]
            : [],
          matchIds: latestRun.status === "revealed"
            ? state.matches
                .filter((match) => match.runId === latestRun.id && match.userIds.includes(state.currentUserId))
                .map((match) => match.id)
            : [],
        }
      : latestRun;
    return {
      ...clone(pool),
      participantCount: participants.length,
      confirmedCount: participants.filter((item) => item.status === "confirmed").length,
      myMembership: clone(this.membership(state, pool.id)),
      latestRun: clone(visibleRun),
    };
  }

  private criteriaForMembership(state: DemoDatingState, membership: PoolMembership): MatchCriteria {
    if (membership.criteriaMode === "custom" && membership.criteriaOverride) return membership.criteriaOverride;
    const criteria = state.criteriaByUserId[membership.userId];
    if (!criteria) throw new DatingServiceError("NOT_FOUND", "参与者还没有设置匹配条件。");
    return criteria;
  }

  private isBlocked(state: DemoDatingState, a: EntityId, b: EntityId): boolean {
    return state.blockedPairs.some(([left, right]) =>
      (left === a && right === b) || (left === b && right === a));
  }

  private matchView(state: DemoDatingState, pair: MatchPair): MatchView {
    const pool = this.findPool(state, pair.poolId);
    const run = state.runs.find((item) => item.id === pair.runId);
    if (!run) throw new DatingServiceError("NOT_FOUND", "找不到这次匹配轮次。");
    const snapshot = state.runSnapshotsByRunId[run.id];
    if (!snapshot) throw new DatingServiceError("NOT_FOUND", "找不到这次匹配的冻结快照。");
    const partnerId = pair.userIds.find((id) => id !== state.currentUserId);
    const partner = partnerId ? snapshot.profilesByUserId[partnerId] : undefined;
    if (!partner) throw new DatingServiceError("NOT_FOUND", "找不到匹配对象资料。");
    const myResponse = pair.responseByUserId[state.currentUserId] ?? "unseen";
    const partnerResponse = pair.responseByUserId[partner.id] ?? "unseen";
    const policyAllowsContacts =
      pool.status !== "archived" &&
      !this.isBlocked(state, state.currentUserId, partner.id) &&
      myResponse !== "passed" &&
      partnerResponse !== "passed" &&
      (pool.resultPolicy.contactReleasePolicy === "immediate" ||
        (myResponse === "interested" && partnerResponse === "interested"));
    const myMembership = snapshot.membershipsByUserId[state.currentUserId];
    const partnerMembership = snapshot.membershipsByUserId[partner.id];
    const hasFrozenConsent = [myMembership, partnerMembership].every((membership) =>
      membership?.participatesInMatching === true &&
      membership.status === "confirmed" &&
      membership.consentVersion === DEMO_CONSENT_VERSION &&
      Boolean(membership.consentedAt),
    );
    const sharedContacts = Object.fromEntries(
      (hasFrozenConsent ? partnerMembership?.sharedContactTypes ?? [] : [])
        .filter((channel) => Boolean(partner.contacts[channel]))
        .map((channel) => [channel, partner.contacts[channel]]),
    );
    const contactsUnlocked = policyAllowsContacts && hasFrozenConsent && Object.keys(sharedContacts).length > 0;
    const visibleDetails = Object.fromEntries(
      Object.entries(partner.details).filter(([fieldId]) =>
        partner.fieldVisibility[fieldId as ProfileFieldId] === "after_match" ||
        partner.fieldVisibility[fieldId as ProfileFieldId] === "public"),
    );
    return {
      id: pair.id,
      pool: clone(pool),
      run: clone(run),
      partner: {
        id: partner.id,
        displayName: partner.displayName,
        age: calculateAge(partner.birthDate, this.now()),
        gender: partner.gender,
        bio: partner.bio,
        partnerIntro: partner.partnerIntro,
        photoUrl: partner.photoUrl,
        details: visibleDetails,
        contacts: contactsUnlocked ? clone(sharedContacts) : undefined,
      },
      compatibilityScore: pair.compatibilityScore,
      compatibilitySummary: pair.compatibilitySummary,
      conversationStarters: clone(pair.conversationStarters),
      myResponse,
      partnerSignal: partnerResponse === "interested" ? "interested" : partnerResponse === "unseen" ? "unseen" : "seen",
      contactsUnlocked,
      createdAt: pair.createdAt,
      revealedAt: pair.revealedAt,
    };
  }

  async bootstrap(): Promise<DatingBootstrap> {
    const state = this.read();
    return {
      currentUser: clone(this.currentProfile(state)),
      criteria: clone(state.criteriaByUserId[state.currentUserId]),
      pools: state.pools.map((pool) => this.summary(state, pool)),
      matches: await this.listMatches(),
    };
  }

  async getCurrentProfile(): Promise<MatchProfile> {
    return clone(this.currentProfile(this.read()));
  }

  async saveProfile(patch: UpdateProfileInput): Promise<MatchProfile> {
    const state = this.read();
    const current = this.currentProfile(state);
    const next: MatchProfile = {
      ...current,
      ...patch,
      details: { ...current.details, ...patch.details },
      contacts: { ...current.contacts, ...patch.contacts },
      fieldVisibility: { ...current.fieldVisibility, ...patch.fieldVisibility },
      profileSchemaVersion: PROFILE_FIELD_CONFIG_VERSION,
      updatedAt: iso(this.now()),
    };
    if (!next.legalName.trim() || !next.displayName.trim()) {
      throw new DatingServiceError("VALIDATION", "请填写真实姓名和对外称呼。");
    }
    const age = calculateAge(next.birthDate, this.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next.birthDate) || !Number.isFinite(age) || age < 18 || age > 100) {
      throw new DatingServiceError("VALIDATION", "目前只向年满 18 岁的用户开放。");
    }
    if (!isOrientationSelectionValid(next)) {
      throw new DatingServiceError("VALIDATION", "当前性取向与所选匹配性别不一致。");
    }
    state.profiles = state.profiles.map((item) => item.id === next.id ? next : item);
    const criteria = state.criteriaByUserId[next.id];
    if (criteria && criteria.targetGender !== next.seekingGender) {
      state.criteriaByUserId[next.id] = { ...criteria, targetGender: next.seekingGender, updatedAt: iso(this.now()) };
    }
    this.write(state);
    return clone(next);
  }

  async getCriteria(): Promise<MatchCriteria> {
    const state = this.read();
    const criteria = state.criteriaByUserId[state.currentUserId];
    if (!criteria) throw new DatingServiceError("NOT_FOUND", "还没有设置匹配条件。");
    return clone(criteria);
  }

  async saveCriteria(criteria: MatchCriteria): Promise<MatchCriteria> {
    const state = this.read();
    const profile = this.currentProfile(state);
    const next = { ...clone(criteria), schemaVersion: MATCH_CRITERIA_CONFIG_VERSION, updatedAt: iso(this.now()) };
    if (next.targetGender !== profile.seekingGender) {
      profile.seekingGender = next.targetGender;
    }
    validateCriteria(profile, next);
    profile.updatedAt = next.updatedAt;
    state.criteriaByUserId[state.currentUserId] = next;
    this.write(state);
    return clone(next);
  }

  async listPools(query: ListPoolsQuery = {}): Promise<PoolSummary[]> {
    const state = this.read();
    return state.pools
      .filter((pool) => {
        const membership = this.membership(state, pool.id);
        if (query.relation === "joined" && !membership) return false;
        if (query.relation === "organized" && pool.organizerId !== state.currentUserId) return false;
        if (query.relation === "discoverable" && (membership || pool.visibility !== "public")) return false;
        if (query.type && pool.type !== query.type) return false;
        if (query.status && pool.status !== query.status) return false;
        return true;
      })
      .map((pool) => this.summary(state, pool));
  }

  async getPool(poolIdOrSlug: EntityId): Promise<PoolDetails> {
    const state = this.read();
    const pool = this.findPool(state, poolIdOrSlug);
    const organizer = state.profiles.find((item) => item.id === pool.organizerId);
    if (!organizer) throw new DatingServiceError("NOT_FOUND", "找不到组织者资料。");
    const allMembers = state.memberships.filter((item) => item.poolId === pool.id && item.status !== "withdrawn");
    const visibleMembers = pool.organizerId === state.currentUserId
      ? allMembers.map((membership) => membership.userId === state.currentUserId
          ? membership
          : { ...membership, criteriaOverride: undefined })
      : allMembers.filter((item) => item.userId === state.currentUserId);
    return {
      ...this.summary(state, pool),
      organizer: {
        id: organizer.id,
        displayName: organizer.displayName,
        photoUrl: organizer.photoUrl,
        bio: organizer.bio,
      },
      members: clone(visibleMembers),
    };
  }

  async createPool(input: CreatePoolInput): Promise<PoolDetails> {
    const state = this.read();
    const now = iso(this.now());
    const id = `pool-${Date.now().toString(36)}-${state.revision}`;
    const baseSlug = input.name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "") || "new-pool";
    const slug = `${baseSlug}-${state.revision}`;
    const pool: Pool = {
      id,
      slug,
      type: input.type,
      name: input.name.trim(),
      summary: input.summary.trim(),
      description: input.description?.trim() ?? "",
      organizerId: state.currentUserId,
      coverTone: input.coverTone ?? "coral",
      visibility: input.visibility ?? "invite_only",
      joinCode: input.joinCode,
      status: "draft",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      registrationClosesAt: input.registrationClosesAt,
      revealAt: input.revealAt,
      timeZone: input.timeZone ?? "America/Los_Angeles",
      location: input.location,
      participantLimit: input.participantLimit,
      requiredFieldIds: input.requiredFieldIds ?? ["displayName", "birthDate"],
      allowCriteriaOverride: input.allowCriteriaOverride ?? true,
      matchingMode: input.matchingMode ?? "profileAndQuestionnaire",
      resultPolicy: input.resultPolicy ?? { organizerCanViewPairs: false, contactReleasePolicy: "mutualInterest" },
      customQuestions: clone(input.customQuestions ?? []),
      createdAt: now,
      updatedAt: now,
    };
    if (!pool.name || !pool.summary) throw new DatingServiceError("VALIDATION", "请填写名称和一句话介绍。");
    validateCustomQuestions(pool);
    state.pools.push(pool);
    state.memberships.push({
      id: `membership-${id}-${state.currentUserId}`,
      poolId: id,
      userId: state.currentUserId,
      role: "organizer",
      participatesInMatching: false,
      status: "confirmed",
      criteriaMode: "inherit",
      registrationAnswers: {},
      sharedContactTypes: ["email"],
      confirmedAt: now,
      joinedAt: now,
      updatedAt: now,
    });
    this.write(state);
    return this.getPool(id);
  }

  async updatePool(poolId: EntityId, input: UpdatePoolInput): Promise<PoolDetails> {
    const state = this.read();
    const pool = this.findPool(state, poolId);
    this.assertOrganizer(state, pool);
    const privacyLocked = state.memberships.some((membership) =>
      membership.poolId === pool.id && membership.participatesInMatching && membership.status === "confirmed");
    if (privacyLocked) {
      const lockedChanges: Array<[unknown, unknown]> = [
        [input.matchingMode, pool.matchingMode],
        [input.resultPolicy, pool.resultPolicy],
        [input.customQuestions, pool.customQuestions],
        [input.requiredFieldIds, pool.requiredFieldIds],
        [input.allowCriteriaOverride, pool.allowCriteriaOverride],
      ];
      if (lockedChanges.some(([requested, existing]) =>
        requested !== undefined && JSON.stringify(requested) !== JSON.stringify(existing))) {
        throw new DatingServiceError("CONFLICT", "已有参与者确认，匹配方式、报名字段与结果权限已锁定。");
      }
    }
    const next: Pool = {
      ...pool,
      ...input,
      name: input.name?.trim() ?? pool.name,
      summary: input.summary?.trim() ?? pool.summary,
      description: input.description?.trim() ?? pool.description,
      resultPolicy: input.resultPolicy ? { ...input.resultPolicy } : pool.resultPolicy,
      customQuestions: input.customQuestions ? clone(input.customQuestions) : pool.customQuestions,
      updatedAt: iso(this.now()),
    };
    validateCustomQuestions(next);
    state.pools = state.pools.map((item) => item.id === pool.id ? next : item);
    this.write(state);
    return this.getPool(pool.id);
  }

  async joinPool(poolId: EntityId, input: JoinPoolInput = {}): Promise<PoolMembership> {
    const state = this.read();
    const pool = this.findPool(state, poolId);
    if (pool.status !== "open") throw new DatingServiceError("CONFLICT", "这个匹配池当前不开放报名。");
    const existing = this.membership(state, pool.id);
    if (!existing && pool.visibility === "invite_only" && input.joinCode !== pool.joinCode) {
      throw new DatingServiceError("FORBIDDEN", "邀请码不正确。");
    }
    const organizerOptIn = existing?.role === "organizer" && !existing.participatesInMatching;
    if (existing && !organizerOptIn && existing.status !== "withdrawn" && existing.status !== "draft") return clone(existing);
    const activeCount = state.memberships.filter((item) => item.poolId === pool.id && item.participatesInMatching && item.status !== "withdrawn").length;
    if ((!existing || existing.status === "withdrawn" || organizerOptIn) && pool.participantLimit && activeCount >= pool.participantLimit) {
      throw new DatingServiceError("CONFLICT", "报名人数已经达到上限。");
    }
    const now = iso(this.now());
    validateRegistrationAnswers(pool, input.registrationAnswers ?? {}, false);
    const answerChannel = input.registrationAnswers?.contactChannel;
    const inferredContactTypes = typeof answerChannel === "string" && answerChannel in this.currentProfile(state).contacts
      ? [answerChannel as keyof MatchProfile["contacts"]]
      : ["email" as const];
    const criteriaMode = input.criteriaMode ?? existing?.criteriaMode ?? "inherit";
    const criteriaOverride = input.criteriaOverride ?? existing?.criteriaOverride;
    if (criteriaMode === "custom") {
      if (!pool.allowCriteriaOverride) {
        throw new DatingServiceError("FORBIDDEN", "这个匹配池只使用全局匹配条件。");
      }
      if (!criteriaOverride) throw new DatingServiceError("VALIDATION", "请提供本池的匹配条件。");
      validateCriteria(this.currentProfile(state), criteriaOverride);
    }
    const membership: PoolMembership = {
      id: existing?.id ?? `membership-${pool.id}-${state.currentUserId}`,
      poolId: pool.id,
      userId: state.currentUserId,
      role: existing?.role ?? "participant",
      participatesInMatching: true,
      status: "draft",
      criteriaMode,
      criteriaOverride: criteriaMode === "custom" ? clone(criteriaOverride) : undefined,
      registrationAnswers: clone(input.registrationAnswers ?? existing?.registrationAnswers ?? {}),
      sharedContactTypes: clone(input.sharedContactTypes ?? (answerChannel ? inferredContactTypes : existing?.sharedContactTypes) ?? inferredContactTypes),
      // A new/re-entered draft has not accepted the current terms yet.
      // Confirmation is the only transition that records matching consent.
      consentVersion: undefined,
      consentedAt: undefined,
      joinedAt: existing?.joinedAt ?? now,
      updatedAt: now,
    };
    state.memberships = state.memberships.filter((item) => item.id !== membership.id);
    state.memberships.push(membership);
    this.write(state);
    return clone(membership);
  }

  async savePoolRegistration(
    poolId: EntityId,
    answers: PoolMembership["registrationAnswers"],
  ): Promise<PoolMembership> {
    const state = this.read();
    const membership = this.membership(state, poolId);
    if (!membership) throw new DatingServiceError("NOT_FOUND", "你还没有加入这个匹配池。");
    const pool = this.findPool(state, poolId);
    if (pool.status !== "open" && pool.status !== "draft") {
      throw new DatingServiceError("CONFLICT", "名单已冻结，不能再修改报名答案。");
    }
    validateRegistrationAnswers(pool, answers, false);
    membership.registrationAnswers = clone(answers);
    const answerChannel = answers.contactChannel;
    if (typeof answerChannel === "string" && answerChannel in this.currentProfile(state).contacts) {
      membership.sharedContactTypes = [answerChannel as keyof MatchProfile["contacts"]];
    }
    membership.updatedAt = iso(this.now());
    this.write(state);
    return clone(membership);
  }

  async setPoolCriteria(
    poolId: EntityId,
    mode: PoolMembership["criteriaMode"],
    criteriaOverride?: MatchCriteria,
  ): Promise<PoolMembership> {
    const state = this.read();
    const pool = this.findPool(state, poolId);
    const membership = this.membership(state, pool.id);
    if (!membership) throw new DatingServiceError("NOT_FOUND", "你还没有加入这个匹配池。");
    if (pool.status !== "open" && pool.status !== "draft") {
      throw new DatingServiceError("CONFLICT", "名单已冻结，不能再修改本场条件。");
    }
    if (mode === "custom" && !pool.allowCriteriaOverride) {
      throw new DatingServiceError("FORBIDDEN", "这个匹配池只使用全局匹配条件。");
    }
    if (mode === "custom") {
      if (!criteriaOverride) throw new DatingServiceError("VALIDATION", "请提供本池的匹配条件。");
      validateCriteria(this.currentProfile(state), criteriaOverride);
    }
    membership.criteriaMode = mode;
    membership.criteriaOverride = mode === "custom" ? clone(criteriaOverride) : undefined;
    membership.updatedAt = iso(this.now());
    this.write(state);
    return clone(membership);
  }

  async confirmPoolParticipation(poolId: EntityId): Promise<PoolMembership> {
    const state = this.read();
    const pool = this.findPool(state, poolId);
    const membership = this.membership(state, pool.id);
    if (!membership) throw new DatingServiceError("NOT_FOUND", "你还没有加入这个匹配池。");
    if (!membership.participatesInMatching || membership.status === "withdrawn") {
      throw new DatingServiceError("CONFLICT", "请先选择参加匹配，再确认报名。");
    }
    if (pool.status !== "open" && pool.status !== "draft") {
      throw new DatingServiceError("CONFLICT", "本轮报名已结束，不能再确认参加。");
    }
    const profile = this.currentProfile(state);
    const missing = pool.requiredFieldIds.filter((fieldId) => {
      const value = profileFieldValue(profile, fieldId);
      return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    });
    if (missing.length) throw new DatingServiceError("VALIDATION", `请先补齐 ${missing.length} 项活动必需资料。`);
    validateRegistrationAnswers(pool, membership.registrationAnswers, true);
    validateCriteria(profile, this.criteriaForMembership(state, membership));
    if (
      !membership.sharedContactTypes.length ||
      !membership.sharedContactTypes.some((channel) => Boolean(profile.contacts[channel]))
    ) {
      throw new DatingServiceError("VALIDATION", "请至少选择一种已经填写的联系方式。");
    }
    const now = iso(this.now());
    membership.status = "confirmed";
    membership.consentVersion = DEMO_CONSENT_VERSION;
    membership.confirmedAt = now;
    membership.consentedAt = now;
    membership.updatedAt = now;
    this.write(state);
    return clone(membership);
  }

  async leavePool(poolId: EntityId): Promise<void> {
    const state = this.read();
    const pool = this.findPool(state, poolId);
    const membership = this.membership(state, pool.id);
    if (!membership) return;
    if (!["open", "draft"].includes(pool.status)) {
      throw new DatingServiceError("CONFLICT", "名单已冻结，请联系组织者处理退出。");
    }
    if (membership.role === "organizer") {
      membership.participatesInMatching = false;
      membership.status = "confirmed";
      membership.criteriaMode = "inherit";
      membership.criteriaOverride = undefined;
      membership.registrationAnswers = {};
      membership.consentVersion = undefined;
      membership.consentedAt = undefined;
      membership.updatedAt = iso(this.now());
      this.write(state);
      return;
    }
    membership.status = "withdrawn";
    membership.updatedAt = iso(this.now());
    this.write(state);
  }

  async closePoolRegistration(poolId: EntityId): Promise<PoolDetails> {
    const state = this.read();
    const pool = this.findPool(state, poolId);
    this.assertOrganizer(state, pool);
    if (["registration_closed", "matching", "ready", "revealed"].includes(pool.status)) {
      return this.getPool(pool.id);
    }
    if (pool.status !== "open") throw new DatingServiceError("CONFLICT", "只有报名中的匹配池可以结束报名。");
    pool.status = "registration_closed";
    pool.updatedAt = iso(this.now());
    this.write(state);
    return this.getPool(pool.id);
  }

  async runPoolMatching(poolId: EntityId): Promise<MatchRun> {
    const state = this.read();
    const pool = this.findPool(state, poolId);
    this.assertOrganizer(state, pool);
    const existingRun = state.runs
      .filter((run) => run.poolId === pool.id && (run.status === "ready" || run.status === "revealed"))
      .sort((a, b) => b.round - a.round)[0];
    if (existingRun) return clone(existingRun);
    if (pool.status !== "registration_closed") {
      throw new DatingServiceError("CONFLICT", "请先结束报名并冻结名单，再开始匹配。");
    }
    const members = state.memberships.filter((membership) =>
      membership.poolId === pool.id && membership.participatesInMatching && membership.status === "confirmed");
    const eligibleMembers = members.filter((membership) => {
      if (membership.consentVersion !== DEMO_CONSENT_VERSION || !membership.consentedAt) return false;
      const profile = state.profiles.find((item) => item.id === membership.userId);
      const age = profile ? calculateAge(profile.birthDate, this.now()) : Number.NaN;
      if (!profile || profile.availability !== "active" || !Number.isFinite(age) || age < 18 || age > 100) return false;
      if (!membership.sharedContactTypes.some((channel) => Boolean(profile.contacts[channel]))) return false;
      return pool.requiredFieldIds.every((fieldId) => {
        const value = profileFieldValue(profile, fieldId);
        return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
      }) && requiredAnswersComplete(pool, membership);
    });
    const byId = new Map(state.profiles.map((profile) => [profile.id, profile]));
    const remaining = [...eligibleMembers].sort((a, b) => a.userId.localeCompare(b.userId));
    const generated: MatchPair[] = [];
    const round = Math.max(0, ...state.runs.filter((run) => run.poolId === pool.id).map((run) => run.round)) + 1;
    const createdAt = iso(this.now());
    const runId = `run-${pool.id}-${round}`;

    while (remaining.length > 1) {
      const first = remaining.shift()!;
      const a = byId.get(first.userId)!;
      const aCriteria = this.criteriaForMembership(state, first);
      const candidates = remaining
        .map((membership, index) => {
          const b = byId.get(membership.userId)!;
          const bCriteria = this.criteriaForMembership(state, membership);
          const accepted = !this.isBlocked(state, a.id, b.id) && areMutuallyEligible(a, aCriteria, b, bCriteria, this.now());
          return { membership, index, b, score: accepted ? similarityScore(a, b, pool) : -1 };
        })
        .filter((candidate) => candidate.score >= 0)
        .sort((left, right) => right.score - left.score || left.b.id.localeCompare(right.b.id));
      const best = candidates[0];
      if (!best) continue;
      remaining.splice(best.index, 1);
      const id = `match-${pool.id}-${round}-${generated.length + 1}`;
      generated.push({
        id,
        poolId: pool.id,
        runId,
        userIds: [a.id, best.b.id],
        compatibilityScore: best.score,
        compatibilitySummary: summaryFor(best.score),
        conversationStarters: startersFor(a, best.b),
        responseByUserId: { [a.id]: "unseen", [best.b.id]: "unseen" },
        createdAt,
      });
    }

    const matchedIds = new Set(generated.flatMap((match) => match.userIds));
    const participantIds = eligibleMembers.map((membership) => membership.userId);
    const run: MatchRun = {
      id: runId,
      poolId: pool.id,
      round,
      status: "ready",
      triggeredBy: state.currentUserId,
      createdAt,
      frozenAt: createdAt,
      revealAt: pool.revealAt,
      participantIds,
      unmatchedUserIds: participantIds.filter((id) => !matchedIds.has(id)),
      matchIds: generated.map((match) => match.id),
      snapshotId: `${pool.id}:${round}:r${state.revision + 1}`,
    };
    state.matches.push(...generated);
    state.runs.push(run);
    state.runSnapshotsByRunId[run.id] = {
      runId: run.id,
      fieldConfigVersion: PROFILE_FIELD_CONFIG_VERSION,
      profilesByUserId: Object.fromEntries(
        participantIds.map((id) => [id, clone(byId.get(id)!)]),
      ),
      criteriaByUserId: Object.fromEntries(
        eligibleMembers.map((membership) => [membership.userId, clone(this.criteriaForMembership(state, membership))]),
      ),
      membershipsByUserId: Object.fromEntries(
        eligibleMembers.map((membership) => [membership.userId, clone(membership)]),
      ),
    };
    pool.status = "ready";
    pool.updatedAt = createdAt;
    this.write(state);
    return clone(run);
  }

  async revealMatchRun(runId: EntityId): Promise<MatchRun> {
    const state = this.read();
    const run = state.runs.find((item) => item.id === runId);
    if (!run) throw new DatingServiceError("NOT_FOUND", "找不到这次匹配轮次。");
    const pool = this.findPool(state, run.poolId);
    this.assertOrganizer(state, pool);
    if (run.status === "revealed") return clone(run);
    if (run.status !== "ready") throw new DatingServiceError("CONFLICT", "匹配结果尚未准备好。");
    const revealedAt = iso(this.now());
    run.status = "revealed";
    run.revealedAt = revealedAt;
    state.matches.forEach((match) => {
      if (match.runId === run.id) match.revealedAt = revealedAt;
    });
    pool.status = "revealed";
    pool.updatedAt = revealedAt;
    this.write(state);
    return clone(run);
  }

  async getOrganizerRunReport(runId: EntityId): Promise<OrganizerRunReport> {
    const state = this.read();
    const run = state.runs.find((item) => item.id === runId);
    if (!run) throw new DatingServiceError("NOT_FOUND", "找不到这次匹配轮次。");
    const pool = this.findPool(state, run.poolId);
    this.assertOrganizer(state, pool);
    const runMatches = state.matches.filter((match) => match.runId === run.id);
    const snapshot = state.runSnapshotsByRunId[run.id];
    const pairs = pool.resultPolicy.organizerCanViewPairs && run.status === "revealed"
      ? runMatches.map((match) => ({
          matchId: match.id,
          displayNames: match.userIds.map((userId) =>
            snapshot?.profilesByUserId[userId]?.displayName ?? "参与者") as [string, string],
        }))
      : undefined;
    return {
      run: {
        id: run.id,
        poolId: run.poolId,
        round: run.round,
        status: run.status,
        triggeredBy: run.triggeredBy,
        createdAt: run.createdAt,
        frozenAt: run.frozenAt,
        revealAt: run.revealAt,
        revealedAt: run.revealedAt,
        snapshotId: run.snapshotId,
      },
      matchedPairCount: runMatches.length,
      unmatchedCount: run.unmatchedUserIds.length,
      pairs: clone(pairs),
    };
  }

  async listMatches(): Promise<MatchView[]> {
    const state = this.read();
    return state.matches
      .filter((pair) => {
        if (!pair.userIds.includes(state.currentUserId)) return false;
        const run = state.runs.find((item) => item.id === pair.runId);
        const partnerId = pair.userIds.find((id) => id !== state.currentUserId)!;
        return run?.status === "revealed" && !this.isBlocked(state, state.currentUserId, partnerId);
      })
      .sort((a, b) => (b.revealedAt ?? b.createdAt).localeCompare(a.revealedAt ?? a.createdAt))
      .map((pair) => this.matchView(state, pair));
  }

  async markMatchViewed(matchId: EntityId): Promise<MatchView> {
    const state = this.read();
    const match = state.matches.find((item) => item.id === matchId && item.userIds.includes(state.currentUserId));
    if (!match) throw new DatingServiceError("NOT_FOUND", "找不到这个匹配结果。");
    if (!match.revealedAt) throw new DatingServiceError("FORBIDDEN", "这个匹配结果还没有揭晓。");
    if ((match.responseByUserId[state.currentUserId] ?? "unseen") === "unseen") {
      match.responseByUserId[state.currentUserId] = "viewed";
      this.write(state);
    }
    return this.matchView(this.read(), match);
  }

  async respondToMatch(matchId: EntityId, response: "interested" | "passed"): Promise<MatchView> {
    const state = this.read();
    const match = state.matches.find((item) => item.id === matchId && item.userIds.includes(state.currentUserId));
    if (!match) throw new DatingServiceError("NOT_FOUND", "找不到这个匹配结果。");
    if (!match.revealedAt) throw new DatingServiceError("FORBIDDEN", "这个匹配结果还没有揭晓。");
    match.responseByUserId[state.currentUserId] = response;
    this.write(state);
    return this.matchView(this.read(), match);
  }

  async blockUser(userId: EntityId): Promise<void> {
    const state = this.read();
    if (!state.profiles.some((profile) => profile.id === userId)) {
      throw new DatingServiceError("NOT_FOUND", "找不到要屏蔽的用户。");
    }
    if (userId === state.currentUserId) throw new DatingServiceError("VALIDATION", "不能屏蔽自己。");
    if (!this.isBlocked(state, state.currentUserId, userId)) {
      state.blockedPairs.push([state.currentUserId, userId]);
      state.matches.forEach((match) => {
        if (match.userIds.includes(state.currentUserId) && match.userIds.includes(userId)) {
          match.responseByUserId[state.currentUserId] = "passed";
        }
      });
      this.write(state);
    }
  }

  async resetDemo(): Promise<DatingBootstrap> {
    const state = createSeedState(this.now());
    this.memoryState = clone(state);
    this.storage?.removeItem(DEMO_STORAGE_KEY);
    this.listeners.forEach((listener) => listener(state.revision));
    return this.bootstrap();
  }

  subscribe(listener: DatingServiceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function createDemoDatingService(options: DemoDatingServiceOptions = {}): DatingService {
  return new LocalDatingService(options);
}

export const datingService: DatingService = createDemoDatingService();
