# 结构化资料、硬性条件与活动匹配：后端接入契约

> **状态（2026-08-17）：这份契约描述的功能已从 `main` 摘除，暂存在分支 `v2-profile-events-experience`。**
>
> 摘除原因：它需要的 4 个接口（`/api/me/profile`、`/api/me/match-criteria`、`/api/events`、`/api/matches`）
> 后端都还没有，所以那套界面在 main 上只能跑 `demo-service.ts` 的假数据——用户注册后会直接掉进演示里。
>
> 本文档保留作为**设计参考**，不代表 main 的现状。main 现在的匹配是：24 题价值观问卷 + 逐题硬筛选 +
> 年龄区间 + 性取向分池 + 自我介绍/期待的文本匹配，见 `backend/matching.py`、`backend/orientation.py`、
> `backend/text_match.py`。要恢复这套设计，先实现那 4 个接口，再从分支 cherry-pick 前端。

> 文档状态：v1 实现契约
>
> 前端 wire 类型权威来源：`website/src/features/v2/domain.ts`
>
> 字段配置权威来源：`website/src/features/v2/field-config.ts`

本文定义个人资料、匹配硬条件，以及活动、学校、公司小池子的后端接入方式。若本文中的 TypeScript 片段与上述两个文件冲突，必须先在同一个变更中统一两处，不能让后端另造一套平行字段。

## 1. 名称映射与核心原则

产品文案仍可使用“活动”和“报名”，但 canonical wire 名称统一如下：

| 产品/后端概念 | canonical wire 类型 |
| --- | --- |
| UserProfile | `MatchProfile` |
| MatchCriteria | `MatchCriteria` |
| Event、学校池、公司池 | `Pool` |
| EventRegistration | `PoolMembership` |
| MatchRun | `MatchRun` |
| 内部 MatchRecord | `MatchPair` |
| 面向参与者的匹配结果 | `MatchView` |

不可变规则：

1. `MatchProfile` 保存本人事实；`MatchCriteria` 保存希望对方满足的硬条件。
2. `legalName`、`displayName`、`gender`、`orientation`、`seekingGender`、`birthDate` 为必填核心资料。
3. `targetGender` 和完整 `ageRange` 为必填条件；其他条件都在 `optional` 中，缺失表示不限制。
4. 双性恋本期正式支持，但每个全局条件或池内条件仍只选择一个目标性别。
5. 本期 `Gender` 仅支持 `male | female`；其他性别只显示 Coming soon，API 必须拒绝未知值。
6. 一对用户必须双向满足性别/性取向规则、年龄和全部硬条件，才在候选图中建立边。
7. 同一用户可加入多个池；同一池中每个用户只有一条 membership，每次 run 最多出现于一个 pair。
8. 匹配采用一般图最大权重一对一匹配，不能继续使用按男女二分的 Gale–Shapley。
9. `resultPolicy.contactReleasePolicy` 默认 `mutualInterest`；`organizerCanViewPairs` 默认 `false`，两者互不推导。
10. run 冻结后使用不可变快照；用户之后修改资料、条件、membership 或问卷不能改变已生成结果，也不能扩大该 run 已同意共享的联系方式范围。

## 2. 通用 HTTP 约定

### 2.1 JSON 与时间

- JSON 字段统一 `camelCase`，枚举值严格使用本文列出的大小写和下划线形式。
- ID 序列化为 string。
- `ISODate` 使用 `YYYY-MM-DD`；`ISODateTime` 使用 UTC ISO 8601。
- 新请求模型拒绝未知字段，避免 Pydantic 静默忽略前端新增值。
- `PATCH` 字段缺失表示不修改，显式 `null` 仅可清空选填字段。
- domain 对象不追加 `revision`、`userId`、`eventId` 等未声明属性。并发控制放在 HTTP `ETag` / `If-Match` 头和数据库内部列中。

### 2.2 鉴权与幂等

- 延续 `Authorization: Bearer <token>`；公开 pool 落地页以外均要求登录。
- 创建 Pool、确认参加、关闭报名、启动 run、揭晓 run 等动作型 POST 要求 `Idempotency-Key`。
- ETag 不属于 JSON。更新成功后返回新 ETag；过期 `If-Match` 返回 `409 REVISION_CONFLICT`。

### 2.3 错误格式

~~~ts
interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    field?: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
}
~~~

前端只按稳定 `code` 分支，不解析中文 message。

## 3. Canonical 资料字段

### 3.1 基础类型与 visibility

~~~ts
type Gender = 'male' | 'female';
type Orientation = 'straight' | 'gay' | 'bisexual';
type MatchAvailability = 'active' | 'paused';
type FieldVisibility = 'matching_only' | 'after_match' | 'public';

type CoreProfileFieldId =
  | 'legalName'
  | 'displayName'
  | 'gender'
  | 'orientation'
  | 'seekingGender'
  | 'birthDate';
~~~

visibility 语义：

- `matching_only`：只允许匹配引擎使用，不返回给匹配对象、其他参与者或主办方。
- `after_match`：run 揭晓后可出现在 `MatchPartnerProfile`；揭晓前不可见。
- `public`：可出现在用户明确参与的公开展示位置，也可在匹配后展示。

联系方式不使用 `fieldVisibility`；它只受 `sharedContactTypes` 和 Pool 的 `contactReleasePolicy` 控制。服务端还要执行字段配置的最大可见性，例如 `legalName`、`orientation`、`seekingGender`、`birthDate` 不允许被用户提升为 `public`。

### 3.2 ProfileDetails

wire 字段必须完全一致：

~~~ts
type EducationLevel =
  | 'high_school' | 'associate' | 'bachelor' | 'master' | 'doctorate' | 'other';

type UsStatus =
  | 'citizen' | 'permanent_resident' | 'h1b' | 'f1' | 'j1' | 'o1'
  | 'dependent' | 'other' | 'prefer_not_to_say';

type ReturnIntent =
  | 'plan_to_return' | 'open_to_return' | 'plan_to_stay'
  | 'undecided' | 'prefer_not_to_say';

type MaritalHistory =
  | 'never_married' | 'divorced' | 'widowed' | 'separated' | 'prefer_not_to_say';

type ChildrenStatus = 'no_children' | 'has_children' | 'prefer_not_to_say';
type ChildrenIntent = 'yes' | 'no' | 'open' | 'undecided';
type SmokingHabit = 'never' | 'socially' | 'regularly' | 'quit';
type DrinkingHabit = 'never' | 'socially' | 'regularly';
type RelocationIntent = 'yes' | 'maybe' | 'no';
type RelationshipGoal = 'marriage' | 'long_term' | 'getting_to_know';
type EmploymentStatus = 'employed' | 'self_employed' | 'student' | 'between_jobs' | 'retired' | 'other';
type MarriageTimeline = 'within_1_year' | 'one_to_three_years' | 'three_to_five_years' | 'no_timeline' | 'undecided';

interface ProfileDetails {
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

type OptionalProfileFieldId = keyof ProfileDetails;
type ProfileFieldId = CoreProfileFieldId | OptionalProfileFieldId;
~~~

首版明确不采集、也不允许通过自定义字段伪装成硬筛条件的类别：收入与资产、族裔、政治倾向、健康状况、残障信息。活动自定义题即使询问这些内容也绝不能进入匹配算法；上线前还应由内容政策校验拦截高风险题目。

不得在 canonical JSON 中使用旧设计里的 `schoolId`、`schoolName`、`occupationCategory`、`jobTitle`、`employer`、`cityCode`、`cityName`、`returnToChinaPlan`、`maritalStatus`、`hasChildren` 或 `wantsChildren`。

数值校验：`heightCm` 为 120–230，`weightKg` 为 35–200。`school`、`occupation`、`city`、`religion` 保存用户展示文本，同时保存内部规范化值用于 `one_of` 比较；规范化只做 Unicode NFKC、trim、连续空白折叠和不区分大小写，响应仍返回原文本。

### 3.3 字段配置接口

`GET /api/config/profile-fields` 返回与 `field-config.ts` 一致的 `ProfileFieldConfig`：

~~~ts
type ProfileFieldInput = 'text' | 'date' | 'number' | 'single_select' | 'multi_select';
type FieldGroup = 'identity' | 'basics' | 'education_work' | 'life_plan' | 'lifestyle';

interface ProfileFieldDefinition {
  id: ProfileFieldId;
  group: FieldGroup;
  label: string;
  shortLabel?: string;
  description?: string;
  placeholder?: string;
  input: ProfileFieldInput;
  required: boolean;
  hardFilterEnabled: boolean;
  sensitive?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
    badge?: string;
  }>;
  defaultVisibility: FieldVisibility;
  filterKind?: HardFilterRule['kind'];
}

interface ProfileFieldConfig {
  version: string;
  groups: Array<{ id: FieldGroup; label: string; description: string }>;
  fields: ProfileFieldDefinition[];
}
~~~

`similarityWeight` 不属于前端 wire 的 `ProfileFieldDefinition`。`profileSimilarity` 使用的权重保存在版本化后端 algorithm config，key 必须是 `OptionalProfileFieldId`，并在 run 快照中记录配置版本。

## 4. Canonical 个人资料与条件

### 4.1 MatchProfile

~~~ts
interface ContactDetails {
  email: string;
  wechat?: string;
  instagram?: string;
  xiaohongshu?: string;
  linkedin?: string;
}

type ContactChannel = keyof ContactDetails;

interface MatchProfile {
  id: string;
  legalName: string;
  displayName: string;
  gender: Gender;
  orientation: Orientation;
  seekingGender: Gender;
  birthDate: string;
  bio?: string;
  partnerIntro?: string;
  photoUrl?: string;
  details: ProfileDetails;
  contacts: ContactDetails;
  fieldVisibility: Partial<Record<ProfileFieldId, FieldVisibility>>;
  availability: MatchAvailability;
  profileSchemaVersion: string;
  createdAt: string;
  updatedAt: string;
}
~~~

`MatchProfile` 是本人完整视图。`partnerIntro` 是原“对 TA 的期待”的 canonical 新名称，只作为软性介绍展示，不能解析或写入 `MatchCriteria`。对外不得直接复用完整对象：匹配对象使用 `MatchPartnerProfile`，公开页面使用经过 visibility 投影的专用响应。`legalName`、完整 `birthDate`、`orientation`、`seekingGender` 和未解锁 contacts 不得因为前端没有渲染而发送到浏览器。

年龄由服务端按 UTC 日期从 `birthDate` 计算；只在 `MatchPartnerProfile.age` 中公开整数年龄。用户必须为 18–100 岁。

### 4.2 MatchCriteria

~~~ts
interface NumberRange {
  min?: number;
  max?: number;
}

type HardFilterRule =
  | { kind: 'range'; min?: number; max?: number }
  | { kind: 'one_of'; values: string[] }
  | { kind: 'equals'; value: string | boolean }
  | { kind: 'contains_any'; values: string[] };

interface MatchCriteria {
  schemaVersion: string;
  targetGender: Gender;
  ageRange: Required<NumberRange>;
  optional: Partial<Record<OptionalProfileFieldId, HardFilterRule>>;
  updatedAt: string;
}
~~~

规则：

- `ageRange.min/max` 都必填，为 18–99 的整数且 min ≤ max。
- `optional` 最多启用 12 项；key 只能来自 `OptionalProfileFieldId`。
- rule.kind 必须等于字段配置的 `filterKind`：身高/体重为 `range`，languages 为 `contains_any`，其他 v1 可筛字段为 `one_of`。
- `range` 至少有 min 或 max；边界为闭区间。
- `one_of` / `contains_any` 的 values 不得为空；候选值缺失时判定失败。
- `prefer_not_to_say` 是真实枚举值，只有 values 明确包含时才通过。
- 自由文本 `one_of` 使用服务端规范化值比较，不能做包含、相似词或未经同意的推断。

### 4.3 seekingGender 与 targetGender

- `MatchProfile.seekingGender` 表示用户当前全局匹配 lane。
- `MatchCriteria.targetGender` 表示某一组条件实际筛选的目标性别。
- 全局 criteria 必须与 profile 保持 `targetGender === seekingGender`。保存任意一方时，服务端在同一事务同步另一方的值和 `updatedAt`。
- `PoolMembership.criteriaMode='inherit'` 时使用全局 criteria。
- `criteriaMode='custom'` 时使用 `criteriaOverride.targetGender`，不修改 `MatchProfile.seekingGender` 或全局 criteria。

性取向一致性：

| orientation | 合法目标性别 |
| --- | --- |
| `straight` | 与本人 gender 不同 |
| `gay` | 与本人 gender 相同 |
| `bisexual` | `male` 或 `female` 均可，但同一 criteria 只能一个 |

候选关系还必须满足双方 orientation 对这段同性/异性关系的支持：

- straight 可匹配异性关系中的 straight 或 bisexual。
- gay 可匹配同性关系中的 gay 或 bisexual。
- bisexual 选择同性 lane 时只匹配 gay/ bisexual；选择异性 lane 时只匹配 straight/ bisexual。

服务端判定 A、B 时，用各自有效 criteria 的 targetGender 临时覆盖 profile.seekingGender，再执行双向检查；不能根据 targetGender 反推或改写 orientation。

## 5. Canonical Pool 与报名模型

### 5.1 Pool

~~~ts
type PoolType = 'event' | 'school' | 'company';
type PoolVisibility = 'invite_only' | 'unlisted' | 'public';
type MatchingMode = 'profileSimilarity' | 'profileAndQuestionnaire';
type ContactReleasePolicy = 'immediate' | 'mutualInterest';

interface ResultPolicy {
  organizerCanViewPairs: boolean;
  contactReleasePolicy: ContactReleasePolicy;
}

type PoolStatus =
  | 'draft' | 'open' | 'registration_closed' | 'matching'
  | 'ready' | 'revealed' | 'archived';

interface PoolLocation {
  mode: 'in_person' | 'online';
  city?: string;
  venue?: string;
  meetingUrl?: string;
}

interface CustomQuestionOption { id: string; label: string; }

interface CustomQuestion {
  id: string;
  label: string;
  description?: string;
  type: 'shortText' | 'longText' | 'singleSelect' | 'multiSelect' | 'boolean';
  required: boolean;
  options?: CustomQuestionOption[];
}

interface Pool {
  id: string;
  slug: string;
  type: PoolType;
  name: string;
  summary: string;
  description: string;
  organizerId: string;
  coverTone: 'coral' | 'cobalt' | 'violet' | 'green';
  visibility: PoolVisibility;
  joinCode?: string;
  status: PoolStatus;
  timeZone: string;
  startsAt?: string;
  endsAt?: string;
  registrationClosesAt?: string;
  revealAt?: string;
  location?: PoolLocation;
  participantLimit?: number;
  requiredFieldIds: ProfileFieldId[];
  allowCriteriaOverride: boolean;
  matchingMode: MatchingMode;
  resultPolicy: ResultPolicy;
  customQuestions: CustomQuestion[];
  createdAt: string;
  updatedAt: string;
}
~~~

`timeZone` 必须是 IANA 时区名（例如 `America/Los_Angeles`）。`startsAt`、`registrationClosesAt`、`revealAt` 仍以 UTC ISO 8601 存储；展示和主办方输入转换使用 `timeZone`，报名截止必须早于活动开始。

默认值：`visibility='invite_only'`、`coverTone='coral'`、`timeZone='America/Los_Angeles'`、`requiredFieldIds=['displayName','birthDate']`、`allowCriteriaOverride=true`、`matchingMode='profileAndQuestionnaire'`、`resultPolicy={ organizerCanViewPairs:false, contactReleasePolicy:'mutualInterest' }`。

约束：

- `customQuestions` 最多 10 个，id 在池内唯一；单选/多选至少两个 option。
- 自定义报名问题不参与硬筛选或打分；要参与必须先成为 ProfileDetails 的版本化字段。
- `invite_only` 必须有不可枚举 joinCode；`unlisted` 可通过 slug 访问但不进入发现列表；`public` 可发现。
- type=event 在从 draft 开放前必须有 startsAt；in_person 必须有 city 或 venue，online 必须有 meetingUrl。
- 第一条 `participatesInMatching=true` 的 membership 进入 confirmed 后，`matchingMode`、`resultPolicy`、`customQuestions`、`requiredFieldIds`、`allowCriteriaOverride` 全部锁定。

### 5.2 PoolMembership

~~~ts
type MembershipRole = 'organizer' | 'participant';
type MembershipStatus = 'draft' | 'confirmed' | 'withdrawn' | 'ineligible';
type CriteriaMode = 'inherit' | 'custom';

interface PoolMembership {
  id: string;
  poolId: string;
  userId: string;
  role: MembershipRole;
  participatesInMatching: boolean;
  status: MembershipStatus;
  criteriaMode: CriteriaMode;
  criteriaOverride?: MatchCriteria;
  registrationAnswers: Record<string, string | string[] | boolean | number | null>;
  sharedContactTypes: ContactChannel[];
  consentVersion?: string;
  consentedAt?: string;
  confirmedAt?: string;
  joinedAt: string;
  updatedAt: string;
}
~~~

创建活动时，主办方 membership 的 `role='organizer'` 且 `participatesInMatching=false`。主办方点击“我也要参加匹配”后必须走与普通参与者相同的报名、资料检查、条件确认、联系方式选择和同意流程，再把该字段设为 `true`；不能因为拥有主办方权限就自动进入快照。

- 创建 Pool 时同步创建 organizer/confirmed membership。
- participant 加入后先为 draft，完成必需资料、报名答案、有效 criteria、至少一种已填写联系方式和隐私确认后进入 confirmed。
- `consentVersion` 是用户确认时所接受条款的版本，不是可由普通 PATCH 任意改写的偏好。confirm 必须把服务端当前版本、`consentedAt` 与 `confirmedAt` 原子写入；若条款升级，旧版本记录保留在只追加的同意审计中，用户必须显式重新确认后，membership 才投影为新版本。
- 已进入 `MatchRunSnapshot.membershipsByUserId` 的 `consentVersion` 永久不变。修改实时 membership、再次确认或退出，只影响未来 run；不得回写历史快照。
- participantLimit 已满时返回冲突；v1 没有 waitlisted/rejected wire 状态。
- 用户退出变为 withdrawn；资料或规则在冻结时不合格可变为 ineligible。
- 同一 `(poolId,userId)` 只有一条记录；退出后重入复用原 ID。
- `criteriaMode='custom'` 仅在 pool.allowCriteriaOverride=true 时允许且必须提供 criteriaOverride。
- registrationAnswers 只接受 pool.customQuestions 中存在的 id 和匹配类型；额外 key 被拒绝。

### 5.3 Pool 列表投影

~~~ts
interface PoolSummary extends Pool {
  participantCount: number;
  confirmedCount: number;
  myMembership?: PoolMembership;
  latestRun?: MatchRun;
}

interface PublicProfileSummary {
  id: string;
  displayName: string;
  photoUrl?: string;
  bio?: string;
}

interface PoolDetails extends PoolSummary {
  organizer: PublicProfileSummary;
  members: PoolMembership[];
}
~~~

`PoolDetails.members` 按权限过滤：主办方可见该池的非 withdrawn memberships；普通参与者只返回自己的 membership；公开访问不返回成员。`organizer` 始终是 `PublicProfileSummary`，不能把完整 `MatchProfile` 塞入同一字段，也不能泄露 legalName、birthDate、orientation、seekingGender 或 contacts。`participantCount` / `confirmedCount` 只统计 `participatesInMatching=true` 的 membership，主办方未 opt in 时不计入。

## 6. Canonical 运行与结果模型

### 6.1 MatchRun

~~~ts
type MatchRunStatus = 'frozen' | 'processing' | 'ready' | 'revealed' | 'failed';

interface MatchRun {
  id: string;
  poolId: string;
  round: number;
  status: MatchRunStatus;
  triggeredBy: string;
  createdAt: string;
  frozenAt: string;
  revealAt?: string;
  revealedAt?: string;
  participantIds: string[];
  unmatchedUserIds: string[];
  matchIds: string[];
  snapshotId: string;
}

/** 后端内部冻结输入，绝不通过普通或主办方 API 返回。 */
interface MatchRunSnapshot {
  runId: string;
  fieldConfigVersion: string;
  profilesByUserId: Record<string, MatchProfile>;
  criteriaByUserId: Record<string, MatchCriteria>;
  membershipsByUserId: Record<string, PoolMembership>;
}

type OrganizerRunSummary = Omit<
  MatchRun,
  'participantIds' | 'unmatchedUserIds' | 'matchIds'
>;

interface OrganizerRunReport {
  run: OrganizerRunSummary;
  matchedPairCount: number;
  unmatchedCount: number;
  /** 仅揭晓后且 resultPolicy.organizerCanViewPairs=true 时出现。 */
  pairs?: Array<{ matchId: string; displayNames: [string, string] }>;
}
~~~

algorithmVersion、字段权重版本、问卷版本、失败详情和幂等记录属于后端内部 run metadata，不追加到 `MatchRun` wire 对象。`snapshotId` 是对已冻结 membership/profile/criteria/questionnaire revisions、算法配置与 seed 的确定性摘要。

`MatchRunSnapshot` 与 `domain.ts` 的内部结构保持一致，并按 `participantIds` 为每位入池用户保存三张同 key 的 map。尤其必须保存完整 `membershipsByUserId`，其中的 `participatesInMatching`、`criteriaMode`、`criteriaOverride`、`sharedContactTypes`、`consentVersion` 和确认时间均为该 run 的不可变事实。活动自定义题即使随 membership 快照保存，也不参与筛选或打分。后端若用关系表或加密版本引用实现，逻辑投影仍须等价；该对象不得返回给主办方。

### 6.2 MatchPair 与 MatchView

~~~ts
type MatchResponse = 'unseen' | 'viewed' | 'interested' | 'passed';

interface MatchPair {
  id: string;
  poolId: string;
  runId: string;
  userIds: [string, string];
  compatibilityScore: number;
  compatibilitySummary: string;
  conversationStarters: string[];
  responseByUserId: Record<string, MatchResponse>;
  createdAt: string;
  revealedAt?: string;
}

interface MatchPartnerProfile {
  id: string;
  displayName: string;
  age: number;
  gender: Gender;
  bio?: string;
  partnerIntro?: string;
  photoUrl?: string;
  details: Partial<ProfileDetails>;
  contacts?: Partial<ContactDetails>;
}

interface MatchView {
  id: string;
  pool: Pool;
  run: MatchRun;
  partner: MatchPartnerProfile;
  compatibilityScore: number;
  compatibilitySummary: string;
  conversationStarters: string[];
  myResponse: MatchResponse;
  partnerSignal: 'interested' | 'seen' | 'unseen';
  contactsUnlocked: boolean;
  createdAt: string;
  revealedAt?: string;
}
~~~

- MatchPair 是服务端/算法记录，不直接返回给普通参与者。
- passed 对对方只投影成 `partnerSignal='seen'`，不能暴露拒绝。
- MatchPartnerProfile.details 只包含 visibility=`after_match|public` 的字段。
- contacts 仅在策略满足时出现；未解锁必须省略，不能发送空壳中的真实值。

## 7. 硬筛选与一般图匹配

### 7.1 冻结参与者

主办方关闭报名后，run 只冻结满足以下条件的 membership（包括主动 opt in 的主办方）：

- `participatesInMatching=true`、status=confirmed，用户 availability=active，年龄仍为 18–100。
- pool.requiredFieldIds 对应资料均非空。
- 必答 customQuestions 完整，`consentVersion` 等于服务端当前有效版本，consentedAt 存在，sharedContactTypes 至少有一个实际已填写 channel。
- inherit 模式有有效全局 criteria；custom 模式有合法 criteriaOverride。
- profileAndQuestionnaire 模式有完整 current 24 题问卷。

不满足者保留 membership 并标记 ineligible，不删除其报名。具体失败字段只告知本人；主办方只见聚合数量。

### 7.2 双向候选边

对 A/B 使用各自 membership 的有效 criteria。仅当以下全部成立才建立无向边：

1. 不是同一用户，且不存在任一方向的全局 block。
2. A.targetGender = B.gender，B.targetGender = A.gender。
3. 双方 orientation 都支持这段同性或异性关系。
4. A 的 ageRange 接受 B，B 的 ageRange 接受 A。
5. A.optional 的每条规则接受 B.details，B.optional 的每条规则接受 A.details。
6. profileAndQuestionnaire 模式下，双方现有逐题问卷硬偏好也互相接受。

候选字段缺失时，有条件的一侧判定失败；条件未启用则不检查。系统不会越过用户标记为必须的条件。

### 7.3 边权

- profileSimilarity：只对通过硬筛选的边，按后端版本化 `similarityWeight` 配置计算 ProfileDetails 相似度。
- profileAndQuestionnaire：ProfileDetails 只用于资格和硬筛选，边权只用现有双向价值观得分，不混入资料相似度。
- 启用某字段为硬条件不会让该字段获得额外相似度权重。
- profileSimilarity 数值字段用 `clamp(1-abs(a-b)/(max-min),0,1)`；枚举和规范化文本相同为 1、不同为 0；languages 用 Jaccard。任一方缺值的字段从分子和分母移除；没有可比较字段时为 0。
- 同分 tie-break 使用 HMAC(run seed, 规范化 user pair)，保证可复现且不能由用户操控。

### 7.4 求解

使用一般图最大权重一对一匹配（Edmonds Blossom 或等价实现），按字典序目标：

1. 最大化 matched 用户数。
2. 在最大基数下最大化总 compatibilityScore。
3. 仍同分时优先更早 confirmed 的参与者，再用确定性 tie-break。

结果不宣称具备稳定婚姻意义的稳定性。奇数人数、孤立顶点和全无可行边都允许，未匹配用户进入 `unmatchedUserIds`。

## 8. API 契约

### 8.1 Bootstrap、资料与条件

~~~ts
interface DatingBootstrap {
  currentUser: MatchProfile;
  criteria: MatchCriteria;
  pools: PoolSummary[];
  matches: MatchView[];
}
~~~

| 方法 | 路径 | 请求/响应 |
| --- | --- | --- |
| GET | `/api/config/profile-fields` | `ProfileFieldConfig` |
| GET | `/api/me/profile` | `MatchProfile` |
| PUT | `/api/me/profile` | `UpdateProfileInput -> MatchProfile`；服务端合并未提供的选填字段 |
| GET | `/api/me/match-criteria` | `MatchCriteria` |
| PUT | `/api/me/match-criteria` | `MatchCriteria -> MatchCriteria` |

~~~ts
type UpdateProfileInput = Partial<
  Omit<MatchProfile, 'id' | 'createdAt' | 'details' | 'contacts' | 'fieldVisibility'>
> & {
  details?: Partial<ProfileDetails>;
  contacts?: Partial<ContactDetails>;
  fieldVisibility?: Partial<Record<ProfileFieldId, FieldVisibility>>;
};
~~~

PUT 对 details/contacts/fieldVisibility 做逐 key merge；其他字段按顶层替换。任何资料保存都要重新校验 orientation 与 seekingGender，并在需要时同步全局 criteria.targetGender。

### 8.2 Pool

~~~ts
interface CreatePoolInput {
  type: PoolType;
  name: string;
  summary: string;
  description?: string;
  coverTone?: Pool['coverTone'];
  visibility?: PoolVisibility;
  joinCode?: string;
  timeZone?: string;
  startsAt?: string;
  endsAt?: string;
  registrationClosesAt?: string;
  revealAt?: string;
  location?: PoolLocation;
  participantLimit?: number;
  requiredFieldIds?: ProfileFieldId[];
  allowCriteriaOverride?: boolean;
  matchingMode?: MatchingMode;
  resultPolicy?: ResultPolicy;
  customQuestions?: CustomQuestion[];
}

interface UpdatePoolInput extends Partial<Omit<CreatePoolInput, 'type'>> {
  status?: PoolStatus;
}
~~~

首版只开放活动，因此 HTTP 资源名使用 `/api/events`；内部领域模型仍保留 `Pool`，供学校/公司后续复用。

| 方法 | 路径 | 请求/响应 |
| --- | --- | --- |
| GET | `/api/events?relation=&status=` | `PoolSummary[]` |
| GET | `/api/events/{eventIdOrSlug}` | 按权限投影的 `PoolDetails` |
| POST | `/api/events` | `CreatePoolInput -> PoolDetails` |
| PATCH | `/api/events/{eventId}` | `UpdatePoolInput -> PoolDetails` |
| POST | `/api/events/{eventId}/publish` | `PoolDetails` |
| POST | `/api/events/{eventId}/close-registration` | `PoolDetails`；关闭并冻结参与者名单 |
| POST | `/api/events/{eventId}/archive` | `PoolDetails` |
| GET | `/api/events/{eventId}/organizer-summary` | 匿名完成度、问卷完成度、可进入匹配人数与活动题答案 |
| GET | `/api/events/{eventId}/match-preflight` | 匿名预检与警告；不返回筛除明细 |

List query canonical 值：relation=`all|joined|organized|discoverable`，status 使用 PoolStatus。首版 `type` 只能省略或传 `event`；`school|company` 仅为领域模型预留，产品入口显示 Coming soon，API 暂不允许创建。

### 8.3 Membership/报名

~~~ts
interface JoinPoolInput {
  joinCode?: string;
  registrationAnswers?: PoolMembership['registrationAnswers'];
  criteriaMode?: CriteriaMode;
  criteriaOverride?: MatchCriteria;
  sharedContactTypes?: ContactChannel[];
}
~~~

| 方法 | 路径 | 请求/响应 |
| --- | --- | --- |
| POST | `/api/events/{eventId}/registration` | `JoinPoolInput -> PoolMembership`；邀请码也在此校验 |
| PUT | `/api/events/{eventId}/registration` | registrationAnswers -> `PoolMembership` |
| PUT | `/api/events/{eventId}/registration/match-criteria` | `{ criteriaMode, criteriaOverride? } -> PoolMembership` |
| POST | `/api/events/{eventId}/registration/confirm` | `PoolMembership` |
| DELETE | `/api/events/{eventId}/registration` | 204；幂等退出 |

同一 registration 接口也用于主办方 opt in：现有 organizer membership 从 `participatesInMatching=false/status=confirmed` 转为 `true/draft`，随后必须调用 confirm。confirm 时原子校验 participantLimit、必需资料、答案、criteria、联系方式与当前 `consentVersion`；名单 frozen 后退出返回冲突，不能从 run 快照移除。

### 8.4 Run 与 Match

| 方法 | 路径 | 请求/响应 |
| --- | --- | --- |
| POST | `/api/events/{eventId}/match-runs` | 启动并返回 `MatchRun` |
| GET | `/api/match-runs/{runId}` | `MatchRun` |
| POST | `/api/match-runs/{runId}/reveal` | `MatchRun` |
| GET | `/api/match-runs/{runId}/organizer-report` | `OrganizerRunReport`；是否含昵称配对受结果策略控制 |
| GET | `/api/matches` | `MatchView[]`，仅已揭晓且属于当前用户 |
| POST | `/api/matches/{matchId}/view` | `MatchView`；unseen 时改 viewed |
| PUT | `/api/matches/{matchId}/response` | `{ response:'interested'|'passed' } -> MatchView` |
| POST | `/api/users/{userId}/block` | 204；全局双向排除效果 |

`MatchPair` 不通过普通用户接口返回。主办方查看 pairs 要使用独立、经过权限裁剪的管理响应；不得把 responseByUserId、contacts、orientation、criteria 或问卷答案一起返回。

## 9. 状态机

### 9.1 PoolStatus

~~~text
draft -> open -> registration_closed -> matching -> ready -> revealed -> archived
matching -> registration_closed  (run failed，可重试)
draft | open | registration_closed | ready -> archived
~~~

- draft：仅主办方；可编辑全部配置。
- open：开放加入和确认。
- registration_closed：名单停止变化，可启动 run。
- matching：存在 frozen/processing run。
- ready：结果已生成但参与者不可见。
- revealed：结果已揭晓，MatchView 可读。
- archived：终态，不开放新报名/运行/联系人读取。

达到 registrationClosesAt 可由后台自动 close；达到 revealAt 可自动 reveal。手动和自动动作使用相同幂等状态转换。

### 9.2 MembershipStatus

~~~text
draft -> confirmed
draft | confirmed -> withdrawn
draft | confirmed -> ineligible
~~~

organizer membership 创建即 confirmed，不能直接 withdrawn；必须先完成所有权迁移或 archive pool。

### 9.3 MatchRunStatus

~~~text
frozen -> processing -> ready -> revealed
frozen | processing -> failed
~~~

同一 Pool 只能有一个 processing/ready run。失败 attempt 保留并增加下一次 round；revealed 后不得再创建新 run，新的活动轮次创建新 Pool。

### 9.4 MatchResponse

~~~text
unseen -> viewed -> interested
                 -> passed
viewed | interested | passed -> interested | passed
~~~

对方 passed 始终投影为 seen。block 会立即隐藏双方 MatchView，并阻止未来联系人读取。

## 10. 权限、visibility 与联系人

### 10.1 资源权限

- 任意登录用户可创建 Pool，创建者为 organizerId。
- organizer 可编辑自己的 Pool、查看经过裁剪的 memberships、关闭报名、触发和揭晓 run。
- participant 只能修改自己的 membership、registrationAnswers、criteriaOverride 和 sharedContactTypes。
- organizer 不能修改参与者资料、criteria、问卷、MatchResponse 或 contacts。
- invite_only 校验 joinCode；unlisted 需知道 slug；public 可进入 discoverable。

### 10.2 organizerCanViewPairs

- false（默认）：organizer 只能看到 participantCount、confirmedCount、pair 数和 unmatched 数。
- true：揭晓后 `OrganizerRunReport.pairs` 可包含每对的 `matchId` 与两个 `displayNames`；不返回 userId、contacts、responseByUserId、orientation、硬条件、问卷答案或排除原因明细。
- 该布尔值不改变 contactReleasePolicy。

### 10.3 contactReleasePolicy

- immediate：run revealed 后立即令 `contactsUnlocked=true`，只返回对方 `MatchRunSnapshot.membershipsByUserId[partnerId].sharedContactTypes` 在冻结 profile/contact version 中实际存在的 channel。
- mutualInterest：双方当前 response 都为 interested 后才解锁。
- 联系方式授权范围必须读取 run 快照，不能读取 live membership；run 后新增 channel、修改 `sharedContactTypes` 或接受新版条款都不能追溯扩大旧结果。撤回、passed、block 与账号安全封禁仍可收紧后续读取。
- 任一方 passed、block 或 Pool archived 后，后续 API 不再返回 contacts；已被复制的信息无法技术性收回，确认页需明确告知。
- 所有成功与拒绝的联系人访问写入只追加审计，包含 viewer、subject、pair、policy、时间和结果。

### 10.4 敏感数据

- legalName、birthDate、orientation、seekingGender、usStatus、returnIntent、maritalHistory、childrenStatus/Intent、religion 默认 matching_only。
- hard criteria 永不展示给他人或 organizer；预检只提供匿名聚合。
- contacts 分表加密，MatchPair 和 run 快照只保存引用。
- 照片接口必须鉴权并按本人、public 或已揭晓匹配关系授权；不能继续用连续 user ID 公开读取。
- 日志、错误和分析事件不得记录上述敏感原值。

## 11. 持久化与内部模型

建议新增：

| 表 | 关键约束 |
| --- | --- |
| `match_profiles` | user_id 唯一；核心字段有类型/CHECK；details JSONB；内部 revision |
| `profile_contacts` | `(user_id,channel)` 唯一；值加密 |
| `match_criteria` | global `(user_id,scope)` 唯一；custom criteria 绑定 membership |
| `pools` | slug 唯一；状态、时间和 result policy 有 CHECK |
| `pool_memberships` | `(pool_id,user_id)` 唯一；role/status/criteria mode 有 CHECK |
| `consent_acceptances` | 只追加；`(membership_id,consent_version)` 唯一；保存 consented_at 与条款摘要 |
| `match_runs` | `(pool_id,round)` 唯一；内部 snapshot metadata 与 algorithm version |
| `match_run_participants` | `(run_id,user_id)` 唯一；冻结 profile/criteria/membership/questionnaire revision；membership 快照含 consentVersion 与 sharedContactTypes |
| `match_pairs` | 两个不同 user；规范化 pair 在 run 内唯一 |
| `match_pair_participants` | `(run_id,user_id)` 唯一，DB 兜底每 run 每人最多一对 |
| `match_responses` | `(pair_id,user_id)` 唯一 |
| `blocks` | 有序 `(blocker_id,blocked_id)` 唯一，读取时双向生效 |
| `contact_access_audit` | 只追加 |
| `idempotency_requests` | `(actor_id,method,path,key)` 唯一，保存 request digest 与响应 |

run 冻结事务记录 profileSchemaVersion、criteria.schemaVersion、profile/membership 内部 revision、问卷版本、算法/相似度配置版本和 seed，再计算 snapshotId。逻辑上必须能重建完整 `MatchRunSnapshot`，包括 `membershipsByUserId`；快照行和同意审计只追加、禁止 UPDATE。生成 run、参与者快照、pairs 与双方初始 unseen response 必须原子提交；通知通过 outbox 异步发送。

## 12. Legacy 映射与迁移

### 12.1 当前仓库旧字段

- users.gender：`男 -> male`，`女 -> female`。
- users.display_name 可迁入 displayName；legalName 不得从邮箱或 displayName 推断，要求用户确认。
- users.bio -> MatchProfile.bio。
- users.match_preference 是自由文本，不解析成 MatchCriteria.optional；可只读保留在 legacy 字段直至产品决定去向。
- orientation、seekingGender、birthDate、全局 targetGender/ageRange 不可安全推断；迁移后 profile/criteria 标记未完成，新匹配前必须 onboarding。
- 现有问卷、逐题 match_preferences、历史 weekly_matches 和 dislikes 保留；新 Pool run 不写旧 weekly_matches。

### 12.2 本文早期草案字段到 canonical 的映射

| legacy | canonical | 规则 |
| --- | --- | --- |
| `schoolId/schoolName` | `details.school` | 优先展示名；要求用户确认 |
| `educationLevel=highSchool` | `educationLevel=high_school` | 其余同名值保留 |
| `occupationCategory/jobTitle` | `details.industry/occupation` | 有可靠目录映射才迁；否则确认 |
| `employer` | `details.company` | 迁移原展示文本；不能塞入 occupation |
| `cityCode/cityName` | `details.city` | 优先展示名；要求用户确认 |
| `permanentResident` | `permanent_resident` | 确定性映射 |
| `otherVisa` | `other` | 确定性映射 |
| `pending/notInUs` | 无精确 UsStatus | 留空并要求确认 |
| `returnToChinaPlan` | `returnIntent` | 依据下方映射 |
| `maritalStatus` | `maritalHistory` | neverMarried -> never_married，其余同义映射 |
| `hasChildren` | `childrenStatus` | true -> has_children，false -> no_children |
| `wantsChildren` | `childrenIntent` | unsure -> undecided，其余同义映射 |
| `private` | `matching_only` | visibility |
| `matchedParticipants` | `after_match` | visibility |

return intent：明确计划在五年内回国 -> plan_to_return；afterFiveYears -> open_to_return；notPlanning -> plan_to_stay；undecided/preferNotToSay -> 对应 `undecided/prefer_not_to_say`。

迁移必须使用正式 migration 工具而非 `CREATE TABLE IF NOT EXISTS`。顺序为旁路建表与回填、双读 bootstrap、资料 onboarding、Pool API、离线回放一般图算法、开放 run/reveal、最后退役旧字段。迁移脚本可重复运行并输出计数审计。

## 13. 幂等、并发与任务

- Idempotency-Key 长度 16–128，以 actor + method + path + key 为作用域保存 30 天。
- 相同 key/相同规范化 body 返回原响应；相同 key/不同 body 返回 `409 IDEMPOTENCY_CONFLICT`。
- PUT criteria/registration/response 和 DELETE membership 天然幂等，同时用 ETag 防止旧页面覆盖。
- run 使用 poolId advisory lock 或唯一租约；持锁后重新检查 PoolStatus、现有 processing/ready/revealed run 和 frozen membership revisions。
- 同一 `Idempotency-Key` 的技术重试必须恢复同一个 run，不得生成第二组 pairs。活动首版只允许一轮；failed run 保留原 ID 与冻结快照，由 worker 继续或人工重试同一 run，不能 round+1 绕过限制。
- reveal 写 run、pairs.revealedAt 与 PoolStatus 必须同一事务。
- 通知使用 outbox，worker 重试不能重复发送同一业务事件。

## 14. 稳定错误码

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 通用格式/范围错误 |
| 401 | `AUTH_REQUIRED` | 无有效会话 |
| 401 | `SESSION_EXPIRED` | 会话过期/撤销 |
| 403 | `FORBIDDEN` | 无资源权限 |
| 403 | `POOL_NOT_OWNED` | 非 organizer 管理 Pool |
| 403 | `INVALID_JOIN_CODE` | invite_only code 不正确 |
| 403 | `CONTACT_NOT_RELEASED` | 尚未满足结果策略 |
| 404 | `PROFILE_NOT_FOUND` | 资料不存在 |
| 404 | `POOL_NOT_FOUND` | Pool 不存在或无权得知 |
| 404 | `MEMBERSHIP_NOT_FOUND` | 未加入 Pool |
| 404 | `MATCH_NOT_FOUND` | Match 不属于当前用户 |
| 409 | `REVISION_CONFLICT` | ETag 过期 |
| 409 | `IDEMPOTENCY_CONFLICT` | key 被不同请求复用 |
| 409 | `POOL_STATE_CONFLICT` | 状态不允许该动作 |
| 409 | `POOL_CONFIG_LOCKED` | 已有 confirmed 且参与匹配的 membership |
| 409 | `PRIVACY_POLICY_LOCKED` | 首条参与匹配的 membership 确认后试图修改结果权限 |
| 409 | `CONSENT_VERSION_STALE` | 同意版本已更新，必须重新确认后才能进入未来 run |
| 409 | `REGISTRATION_CLOSED` | 报名已关闭、名单已冻结或活动已匹配 |
| 409 | `PARTICIPANT_LIMIT_REACHED` | 已达到上限 |
| 409 | `MATCH_RUN_IN_PROGRESS` | 已有 processing/ready run |
| 409 | `MATCH_ALREADY_REVEALED` | 不能再生成新 run |
| 409 | `MATCH_ALREADY_RUN` | 该活动已经创建过唯一匹配轮次；不得重跑或覆盖 |
| 409 | `PROFILE_INCOMPLETE` | 缺必需资料 |
| 409 | `CRITERIA_INCOMPLETE` | 缺 targetGender/ageRange |
| 409 | `QUESTIONNAIRE_REQUIRED` | 模式要求完整问卷 |
| 422 | `UNSUPPORTED_GENDER` | 非 male/female |
| 422 | `ORIENTATION_TARGET_MISMATCH` | orientation 与目标性别不一致 |
| 422 | `INVALID_HARD_FILTER` | key/kind/value 不合法 |
| 422 | `MISSING_REQUIRED_FIELD` | Pool 必需资料未填 |
| 422 | `INVALID_REGISTRATION_ANSWER` | 自定义答案格式错误 |
| 422 | `CONSENT_REQUIRED` | 未确认结果/联系人策略 |
| 422 | `INVALID_TIME_ZONE` | timeZone 不是有效 IANA 时区名 |
| 429 | `RATE_LIMITED` | 公开查询或高成本操作限流 |
| 503 | `MATCHING_TEMPORARILY_UNAVAILABLE` | worker/数据库暂不可用 |

## 15. 必测验收场景

### Wire 契约

- 用 domain.ts 生成的 fixtures 验证所有响应无额外/缺失字段，snake_case 枚举值完全一致。
- ProfileDetails 21 个 optional key、FieldVisibility 三个值、HardFilterRule 四种 kind 全覆盖。
- MatchProfile 使用 seekingGender，MatchCriteria 使用 targetGender；global 保存双向同步，custom override 不污染 global。

### 资料与筛选

- legalName/displayName 必填、18/100 岁边界、详情 merge、visibility 最大级别。
- straight/gay/bisexual 同性与异性 lane 的全部合法/非法组合及双向 orientation 检查。
- range 单边/双边、one_of、equals、contains_any、缺值失败、prefer_not_to_say 精确包含。
- 文案 key 规范化比较，但响应保留原 school/occupation/city/religion。

### Pool 与权限

- 同用户多 Pool、同 Pool 唯一 membership、退出重入复用、participantLimit 并发。
- invite_only/unlisted/public、requiredFieldIds、自定义问题类型和最多 10 个限制。
- 第一条 `participatesInMatching=true` 的 membership confirmed 后配置锁定。
- Pool 必须返回有效 IANA `timeZone`；CreatePoolInput 省略时采用 `America/Los_Angeles`，不能用服务器本地时区隐式解释时间。
- organizer 创建后不计入参与人数；只有显式 opt in、进入 draft 并完成相同 confirm 流程后，才可进入 frozen 快照。
- organizerCanViewPairs 与两种 contact policy 的四种组合互不串权。
- 普通参与者无法列出其他成员或读取完整 MatchProfile。

### 匹配与揭晓

- 异性、男男、女女、bisexual 同性/异性 lane 混合一般图正确构边。
- 双向年龄、optional、问卷逐题硬偏好或 block 任一失败均不构边。
- Blossom 奇环、奇数、孤立、全无边和同分可复现；先最大基数再最大权重。
- profileSimilarity 严格按内部配置；profileAndQuestionnaire 边权不混入 ProfileDetails。
- frozen 快照后修改资料/criteria/membership/问卷不改变 run；`membershipsByUserId` key 与 participantIds 一致，冻结的 consentVersion/sharedContactTypes 不可变；每人每 run 最多一 pair。
- ready 前无 MatchView，revealed 后才可读；unmatchedUserIds 正确。

### 联系方式、迁移与幂等

- immediate 揭晓即解锁；mutualInterest 双方 interested 才解锁；passed 不向对方显示为拒绝。
- contacts 只含 partner frozen membership.sharedContactTypes；live membership 不能扩大历史授权，所有访问有审计。
- legacy 字段/枚举映射不会凭空推断 legalName、orientation、birthDate 或 targetGender。
- 相同 Idempotency-Key 重试返回同一 Pool/run；不同 body 冲突。
- 并发 run/reveal 只产生一组 pairs 和一次揭晓通知。

## 16. 前端已知问题（2026-08-11 交接记录）

以下问题来自本次前端 React 审阅。按当前交付边界暂缓修复；它们均位于浏览器端状态、路由、请求反馈或打包逻辑中，不要求、也不授权修改后端数据库、API 语义或匹配算法。

### 正确性

- `website/src/features/v2/EventsPages.tsx`：活动报名页存在初始化竞态。恢复已有 membership 的 `criteriaOverride` 后，另一条 effect 可能再次应用全局 criteria，导致活动专属条件被覆盖。后续前端修复时，应在 pool 与 criteria 都就绪后只初始化一次，并为“重新进入已有报名”补回归测试。
- `website/src/app/App.tsx`：路由已改为读取 `location.pathname`，但旧页面映射对未知路径没有 fallback。未知或已删除的深链可能只显示 header/footer 和空白主区域。后续前端修复时，应增加 Not Found 页面或安全重定向。

### 稳定性与反馈

- `website/src/features/v2/GuestEventPreview.tsx` 与 `website/src/features/v2/EventsPages.tsx`：按 event ID 加载时未统一重置旧状态，也没有全部忽略过期 Promise；活动之间快速导航可能短暂保留旧活动数据，较慢的旧请求也可能覆盖新结果。
- `website/src/app/App.tsx`：切换每周匹配状态时，前端在持久化完成前就提示成功；API 失败时可能同时出现成功和失败反馈。后续应等待明确成功结果后再提示。

### 性能

- `website/src/features/v2/V2Experience.tsx`：V2 外层虽然使用懒加载，但内部仍静态导入全部页面；访问首页或资料页也会下载活动创建、报名和管理代码。后续可按路由进一步拆分 bundle。

### 当前验证基线

- `pnpm test`：4 个测试文件、49 个测试通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
- 上述通过项不代表已覆盖本节列出的竞态、未知路由、过期请求和失败反馈场景。
