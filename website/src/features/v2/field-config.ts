import type {
  FieldVisibility,
  HardFilterRule,
  OptionalProfileFieldId,
  ProfileFieldId,
} from "./domain";

export const PROFILE_FIELD_CONFIG_VERSION = "2026-08-11.v2";
export const MATCH_CRITERIA_CONFIG_VERSION = "2026-08-11.v2";

export interface FieldOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  badge?: string;
}

export type ProfileFieldInput =
  | "text"
  | "date"
  | "number"
  | "single_select"
  | "multi_select";

export type FieldGroup = "identity" | "basics" | "education_work" | "life_plan" | "lifestyle";

export interface ProfileFieldDefinition {
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
  options?: FieldOption[];
  defaultVisibility: FieldVisibility;
  filterKind?: HardFilterRule["kind"];
}

export interface ProfileFieldConfig {
  version: string;
  groups: Array<{ id: FieldGroup; label: string; description: string }>;
  fields: ProfileFieldDefinition[];
}

const genderOptions: FieldOption[] = [
  { value: "male", label: "男" },
  { value: "female", label: "女" },
];

const orientationOptions: FieldOption[] = [
  { value: "straight", label: "异性恋" },
  { value: "gay", label: "同性恋" },
  {
    value: "bisexual",
    label: "双性恋",
    description: "本轮仍需先选择一个想匹配的性别，可随时切换。",
    badge: "单性别匹配",
  },
];

export const profileFieldConfig: ProfileFieldConfig = {
  version: PROFILE_FIELD_CONFIG_VERSION,
  groups: [
    { id: "identity", label: "身份与称呼", description: "用于确认你是谁；真实姓名默认不会展示给其他参与者。" },
    { id: "basics", label: "基本资料", description: "帮助系统判断基础硬性条件。" },
    { id: "education_work", label: "教育与工作", description: "选填；只填写你愿意用于匹配的信息。" },
    { id: "life_plan", label: "地点与未来计划", description: "选填；这些信息可能比较私密，默认仅用于匹配。" },
    { id: "lifestyle", label: "生活状态", description: "选填；可用于缩小范围，也可以完全留空。" },
  ],
  fields: [
    {
      id: "legalName", group: "identity", label: "真实姓名", input: "text", required: true,
      hardFilterEnabled: false, sensitive: true, defaultVisibility: "matching_only", placeholder: "仅用于账号与活动身份确认",
    },
    {
      id: "displayName", group: "identity", label: "对外称呼", input: "text", required: true,
      hardFilterEnabled: false, defaultVisibility: "after_match", placeholder: "匹配对象看到的名字",
    },
    {
      id: "gender", group: "identity", label: "性别", input: "single_select", required: true,
      hardFilterEnabled: false, sensitive: true, options: genderOptions, defaultVisibility: "after_match",
    },
    {
      id: "orientation", group: "identity", label: "性取向", input: "single_select", required: true,
      hardFilterEnabled: false, sensitive: true, options: orientationOptions, defaultVisibility: "matching_only",
    },
    {
      id: "seekingGender", group: "identity", label: "本轮想匹配的性别", input: "single_select", required: true,
      hardFilterEnabled: false, sensitive: true, options: genderOptions, defaultVisibility: "matching_only",
      description: "目前每轮只能选择一个性别；调整后会从下一轮开始生效。",
    },
    {
      id: "birthDate", group: "basics", label: "出生日期", input: "date", required: true,
      hardFilterEnabled: false, sensitive: true, defaultVisibility: "matching_only",
      description: "仅用于计算年龄；匹配对象只会看到年龄。",
    },
    {
      id: "heightCm", group: "basics", label: "身高", input: "number", required: false,
      hardFilterEnabled: true, unit: "cm", min: 120, max: 230, step: 1, defaultVisibility: "after_match", filterKind: "range",
    },
    {
      id: "weightKg", group: "basics", label: "体重", input: "number", required: false,
      hardFilterEnabled: true, sensitive: true, unit: "kg", min: 35, max: 200, step: 1,
      defaultVisibility: "matching_only", filterKind: "range",
    },
    {
      id: "school", group: "education_work", label: "毕业院校", input: "text", required: false,
      hardFilterEnabled: true, defaultVisibility: "after_match", filterKind: "one_of", placeholder: "例如 UC Berkeley",
    },
    {
      id: "educationLevel", group: "education_work", label: "最高学历", input: "single_select", required: false,
      hardFilterEnabled: true, defaultVisibility: "after_match", filterKind: "one_of",
      options: [
        { value: "high_school", label: "高中/中专" }, { value: "associate", label: "大专" },
        { value: "bachelor", label: "本科" }, { value: "master", label: "硕士" },
        { value: "doctorate", label: "博士" }, { value: "other", label: "其他" },
      ],
    },
    {
      id: "employmentStatus", group: "education_work", label: "就业状态", input: "single_select", required: false,
      hardFilterEnabled: true, defaultVisibility: "after_match", filterKind: "one_of",
      options: [
        ["employed", "全职工作"], ["self_employed", "自由职业 / 创业"], ["student", "在读"],
        ["between_jobs", "职业过渡期"], ["retired", "已退休"], ["other", "其他"],
      ].map(([value, label]) => ({ value, label })),
    },
    {
      id: "occupation", group: "education_work", label: "职业", input: "text", required: false,
      hardFilterEnabled: true, defaultVisibility: "after_match", filterKind: "one_of", placeholder: "例如 产品设计师",
    },
    {
      id: "company", group: "education_work", label: "公司 / 机构", input: "text", required: false,
      hardFilterEnabled: true, sensitive: true, defaultVisibility: "matching_only", filterKind: "one_of", placeholder: "填写你愿意用于匹配的机构名称",
    },
    {
      id: "industry", group: "education_work", label: "行业", input: "single_select", required: false,
      hardFilterEnabled: true, defaultVisibility: "after_match", filterKind: "one_of",
      options: ["technology", "finance", "healthcare", "education", "research", "creative", "public_service", "other"]
        .map((value, index) => ({ value, label: ["科技", "金融", "医疗健康", "教育", "科研", "文化创意", "公共服务", "其他"][index] })),
    },
    {
      id: "city", group: "life_plan", label: "所在城市", input: "text", required: false,
      hardFilterEnabled: true, defaultVisibility: "after_match", filterKind: "one_of", placeholder: "例如 San Francisco",
    },
    {
      id: "usStatus", group: "life_plan", label: "在美身份", input: "single_select", required: false,
      hardFilterEnabled: true, sensitive: true, defaultVisibility: "matching_only", filterKind: "one_of",
      options: [
        ["citizen", "美国公民"], ["permanent_resident", "永久居民"], ["h1b", "H-1B"],
        ["f1", "F-1"], ["j1", "J-1"], ["o1", "O-1"], ["dependent", "家属签证"],
        ["other", "其他"], ["prefer_not_to_say", "暂不透露"],
      ].map(([value, label]) => ({ value, label })),
    },
    {
      id: "returnIntent", group: "life_plan", label: "未来回国意愿", input: "single_select", required: false,
      hardFilterEnabled: true, sensitive: true, defaultVisibility: "matching_only", filterKind: "one_of",
      options: [
        ["plan_to_return", "计划回国"], ["open_to_return", "愿意考虑回国"],
        ["plan_to_stay", "计划留美"], ["undecided", "尚未决定"], ["prefer_not_to_say", "暂不透露"],
      ].map(([value, label]) => ({ value, label })),
    },
    {
      id: "maritalHistory", group: "life_plan", label: "婚姻经历", input: "single_select", required: false,
      hardFilterEnabled: true, sensitive: true, defaultVisibility: "matching_only", filterKind: "one_of",
      options: [
        ["never_married", "未婚"], ["divorced", "离异"], ["widowed", "丧偶"],
        ["separated", "分居中"], ["prefer_not_to_say", "暂不透露"],
      ].map(([value, label]) => ({ value, label })),
    },
    {
      id: "childrenStatus", group: "life_plan", label: "是否有孩子", input: "single_select", required: false,
      hardFilterEnabled: true, sensitive: true, defaultVisibility: "matching_only", filterKind: "one_of",
      options: [["no_children", "没有"], ["has_children", "有"], ["prefer_not_to_say", "暂不透露"]]
        .map(([value, label]) => ({ value, label })),
    },
    {
      id: "childrenIntent", group: "life_plan", label: "未来是否想要孩子", input: "single_select", required: false,
      hardFilterEnabled: true, sensitive: true, defaultVisibility: "matching_only", filterKind: "one_of",
      options: [["yes", "想要"], ["no", "不想要"], ["open", "可以讨论"], ["undecided", "尚未决定"]]
        .map(([value, label]) => ({ value, label })),
    },
    {
      id: "relationshipGoal", group: "life_plan", label: "关系期待", input: "single_select", required: false,
      hardFilterEnabled: true, defaultVisibility: "after_match", filterKind: "one_of",
      options: [["marriage", "以婚姻为目标"], ["long_term", "长期稳定关系"], ["getting_to_know", "先认真了解彼此"]]
        .map(([value, label]) => ({ value, label })),
    },
    {
      id: "marriageTimeline", group: "life_plan", label: "结婚时间预期", input: "single_select", required: false,
      hardFilterEnabled: true, sensitive: true, defaultVisibility: "matching_only", filterKind: "one_of",
      options: [
        ["within_1_year", "希望 1 年内"], ["one_to_three_years", "希望 1–3 年内"],
        ["three_to_five_years", "希望 3–5 年内"], ["no_timeline", "没有固定时间表"], ["undecided", "尚未决定"],
      ].map(([value, label]) => ({ value, label })),
    },
    {
      id: "relocationIntent", group: "life_plan", label: "异地或搬迁意愿", input: "single_select", required: false,
      hardFilterEnabled: true, defaultVisibility: "matching_only", filterKind: "one_of",
      options: [["yes", "愿意"], ["maybe", "视情况而定"], ["no", "暂不考虑"]]
        .map(([value, label]) => ({ value, label })),
    },
    {
      id: "smoking", group: "lifestyle", label: "吸烟习惯", input: "single_select", required: false,
      hardFilterEnabled: true, defaultVisibility: "after_match", filterKind: "one_of",
      options: [["never", "不吸烟"], ["socially", "偶尔"], ["regularly", "经常"], ["quit", "已戒烟"]]
        .map(([value, label]) => ({ value, label })),
    },
    {
      id: "drinking", group: "lifestyle", label: "饮酒习惯", input: "single_select", required: false,
      hardFilterEnabled: true, defaultVisibility: "after_match", filterKind: "one_of",
      options: [["never", "不饮酒"], ["socially", "社交场合"], ["regularly", "经常"]]
        .map(([value, label]) => ({ value, label })),
    },
    {
      id: "religion", group: "lifestyle", label: "宗教信仰", input: "text", required: false,
      hardFilterEnabled: true, sensitive: true, defaultVisibility: "matching_only", filterKind: "one_of",
    },
    {
      id: "languages", group: "lifestyle", label: "常用语言", input: "multi_select", required: false,
      hardFilterEnabled: true, defaultVisibility: "after_match", filterKind: "contains_any",
      options: [["zh-CN", "普通话"], ["zh-TW", "粤语/其他中文"], ["en", "英语"], ["es", "西班牙语"], ["other", "其他"]]
        .map(([value, label]) => ({ value, label })),
    },
  ],
};

export const HARD_FILTER_GUIDANCE = {
  title: "把范围聚焦在你真正愿意见面的人",
  body: "这些“必要条件”只帮助我们聚焦彼此都愿意认识的范围，不代表任何选择更好或更差。条件越具体，可能需要等待更久；保留一些弹性，通常会带来更多相遇机会。你可以随时调整。",
  promise: "系统不会越过你标记为“必须”的条件。",
  rangeLabels: {
    broad: "范围较宽",
    balanced: "比较聚焦",
    focused: "非常聚焦",
  },
} as const;

export const profileFieldById = Object.fromEntries(
  profileFieldConfig.fields.map((field) => [field.id, field]),
) as Record<ProfileFieldId, ProfileFieldDefinition>;

export const filterableProfileFields = profileFieldConfig.fields.filter(
  (field): field is ProfileFieldDefinition & { id: OptionalProfileFieldId; filterKind: HardFilterRule["kind"] } =>
    field.hardFilterEnabled && field.filterKind !== undefined,
);

export function getFilterRangeLabel(enabledOptionalFilterCount: number): keyof typeof HARD_FILTER_GUIDANCE.rangeLabels {
  if (enabledOptionalFilterCount <= 2) return "broad";
  if (enabledOptionalFilterCount <= 5) return "balanced";
  return "focused";
}
