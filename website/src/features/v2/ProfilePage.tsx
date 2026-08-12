import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, Info, LockKeyhole, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import type {
  FieldVisibility,
  HardFilterRule,
  MatchCriteria,
  MatchProfile,
  OptionalProfileFieldId,
  ProfileDetails,
  ProfileFieldId,
  UpdateProfileInput,
} from "./domain";
import { calculateAge, oppositeGender } from "./domain";
import {
  filterableProfileFields,
  getFilterRangeLabel,
  HARD_FILTER_GUIDANCE,
  profileFieldConfig,
  PROFILE_FIELD_CONFIG_VERSION,
} from "./field-config";
import { useV2 } from "./useV2";
import { Card, cx, FormField, NativeSelect, PageHeading, Pill, TextArea, TextInput, V2Button } from "./ui";

type ProfileTab = "identity" | "criteria" | "privacy";

const TAB_ITEMS: Array<{ id: ProfileTab; step: string; label: string }> = [
  { id: "identity", step: "01", label: "关于我" },
  { id: "criteria", step: "02", label: "希望遇见的人" },
  { id: "privacy", step: "03", label: "隐私与联系方式" },
];

function ageCutoffDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date.toISOString().slice(0, 10);
}

function valueIsPresent(value: unknown) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

function optionLabel(fieldId: OptionalProfileFieldId, value: unknown) {
  const field = profileFieldConfig.fields.find(item => item.id === fieldId);
  return field?.options?.find(option => option.value === value)?.label ?? String(value ?? "");
}

export function ProfilePage() {
  const { loading, profile, criteria, service } = useV2();
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ProfileTab>(() => {
    const requested = new URLSearchParams(location.search).get("tab");
    return requested === "criteria" || requested === "privacy" ? requested : "identity";
  });
  const [draft, setDraft] = useState<MatchProfile | null>(null);
  const [criteriaDraft, setCriteriaDraft] = useState<MatchCriteria | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) setDraft(profile);
  }, [profile]);

  useEffect(() => {
    if (criteria) setCriteriaDraft(criteria);
  }, [criteria]);

  useEffect(() => {
    const requested = new URLSearchParams(location.search).get("tab");
    if (requested === "identity" || requested === "criteria" || requested === "privacy") setTab(requested);
  }, [location.search]);

  const changeTab = (nextTab: ProfileTab) => {
    const params = new URLSearchParams(location.search);
    params.set("tab", nextTab);
    navigate(`${location.pathname}?${params.toString()}`);
  };

  const requiredComplete = Boolean(
    draft?.legalName.trim() &&
    draft?.displayName.trim() &&
    draft?.birthDate &&
    calculateAge(draft.birthDate) >= 18,
  );
  const optionalAnswered = useMemo(
    () => draft ? Object.values(draft.details).filter(valueIsPresent).length : 0,
    [draft],
  );
  const enabledFilterCount = criteriaDraft ? Object.keys(criteriaDraft.optional).length : 0;
  const rangeKey = getFilterRangeLabel(enabledFilterCount);

  if (loading || !draft || !criteriaDraft) {
    return <div className="flex min-h-[55vh] items-center justify-center text-sm text-muted-foreground">正在准备你的匹配资料…</div>;
  }

  const setProfile = <K extends keyof MatchProfile>(key: K, value: MatchProfile[K]) => {
    setDraft(current => current ? { ...current, [key]: value } : current);
  };

  const setDetail = (key: OptionalProfileFieldId, value: ProfileDetails[OptionalProfileFieldId] | undefined) => {
    setDraft(current => current ? { ...current, details: { ...current.details, [key]: value } } : current);
  };

  const changeOrientation = (orientation: MatchProfile["orientation"]) => {
    setDraft(current => {
      if (!current) return current;
      const seekingGender = orientation === "straight"
        ? oppositeGender(current.gender)
        : orientation === "gay"
          ? current.gender
          : current.seekingGender;
      setCriteriaDraft(active => active ? { ...active, targetGender: seekingGender } : active);
      return { ...current, orientation, seekingGender };
    });
  };

  const changeGender = (gender: MatchProfile["gender"]) => {
    setDraft(current => {
      if (!current) return current;
      const seekingGender = current.orientation === "straight"
        ? oppositeGender(gender)
        : current.orientation === "gay"
          ? gender
          : current.seekingGender;
      setCriteriaDraft(active => active ? { ...active, targetGender: seekingGender } : active);
      return { ...current, gender, seekingGender };
    });
  };

  const changeSeekingGender = (seekingGender: MatchProfile["seekingGender"]) => {
    setProfile("seekingGender", seekingGender);
    setCriteriaDraft(current => current ? { ...current, targetGender: seekingGender } : current);
  };

  const toggleFilter = (fieldId: OptionalProfileFieldId, enabled: boolean) => {
    const definition = filterableProfileFields.find(field => field.id === fieldId);
    setCriteriaDraft(current => {
      if (!current || !definition) return current;
      const optional = { ...current.optional };
      if (!enabled) {
        delete optional[fieldId];
      } else if (definition.filterKind === "range") {
        optional[fieldId] = { kind: "range" };
      } else if (definition.filterKind === "contains_any") {
        optional[fieldId] = { kind: "contains_any", values: [] };
      } else {
        optional[fieldId] = { kind: "one_of", values: [] };
      }
      return { ...current, optional };
    });
  };

  const updateRule = (fieldId: OptionalProfileFieldId, rule: HardFilterRule) => {
    setCriteriaDraft(current => current ? { ...current, optional: { ...current.optional, [fieldId]: rule } } : current);
  };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!requiredComplete) {
      toast.error("请先完成真实姓名、对外称呼和有效出生日期");
      changeTab("identity");
      return;
    }
    setSaving(true);
    try {
      const profilePatch: UpdateProfileInput = {
        legalName: draft.legalName.trim(),
        displayName: draft.displayName.trim(),
        gender: draft.gender,
        orientation: draft.orientation,
        seekingGender: draft.seekingGender,
        birthDate: draft.birthDate,
        bio: draft.bio,
        partnerIntro: draft.partnerIntro,
        details: draft.details,
        contacts: draft.contacts,
        fieldVisibility: draft.fieldVisibility,
        profileSchemaVersion: PROFILE_FIELD_CONFIG_VERSION,
      };
      await Promise.all([
        service.saveProfile(profilePatch),
        service.saveCriteria({ ...criteriaDraft, targetGender: draft.seekingGender, updatedAt: new Date().toISOString() }),
      ]);
      toast.success("匹配资料已保存");
      const returnTo = new URLSearchParams(location.search).get("returnTo");
      if (returnTo?.startsWith("/events/")) navigate(returnTo);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        eyebrow="我的资料"
        title="让每一次相遇，都从清楚的期待开始"
        description="本人资料、必要条件和展示权限彼此独立。你可以认真表达需要，也可以随时保留弹性。"
        action={<div className="flex items-center gap-2"><Pill tone={requiredComplete ? "green" : "amber"}>{requiredComplete ? "基础资料已完成" : "还需补充必填项"}</Pill><Pill>{optionalAnswered} 项选填资料</Pill></div>}
      />

      <div className="mb-6 grid grid-cols-3 gap-2 rounded-3xl border border-border bg-card p-2">
        {TAB_ITEMS.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => changeTab(item.id)}
            aria-current={tab === item.id ? "step" : undefined}
            className={cx("min-h-14 rounded-2xl px-2 py-2 text-left transition-colors sm:px-4", tab === item.id ? "bg-primary text-white shadow-sm" : "hover:bg-muted/60")}
          >
            <span className={cx("mr-2 hidden text-xs font-bold sm:inline", tab === item.id ? "text-white/70" : "text-muted-foreground")}>{item.step}</span>
            <span className="text-xs font-semibold sm:text-sm">{item.label}</span>
          </button>
        ))}
      </div>

      <form onSubmit={save}>
        {tab === "identity" ? (
          <div className="space-y-6">
            <Card className="p-5 sm:p-7">
              <div className="mb-6 flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-primary"><UserRound size={21} /></div>
                <div><h2 className="text-xl font-bold">身份与称呼</h2><p className="mt-1 text-sm text-muted-foreground">真实姓名只用于身份确认，匹配对象只会看到你的对外称呼。</p></div>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <FormField label="真实姓名" hint="仅用于账号和活动身份确认，不会对其他参与者展示。"><TextInput value={draft.legalName} onChange={event => setProfile("legalName", event.target.value)} placeholder="请输入真实姓名" /></FormField>
                <FormField label="对外称呼" hint="匹配成功后对方看到的名字。"><TextInput value={draft.displayName} onChange={event => setProfile("displayName", event.target.value)} placeholder="例如 小林" /></FormField>
                <FormField label="性别"><NativeSelect value={draft.gender} onChange={event => changeGender(event.target.value as MatchProfile["gender"])}><option value="male">男</option><option value="female">女</option><option disabled>其他性别（Coming soon）</option></NativeSelect></FormField>
                <FormField label="性取向"><NativeSelect value={draft.orientation} onChange={event => changeOrientation(event.target.value as MatchProfile["orientation"])}><option value="straight">异性恋</option><option value="gay">同性恋</option><option value="bisexual">双性恋</option></NativeSelect></FormField>
                <FormField label="出生日期" hint={draft.birthDate ? `匹配对象只会看到年龄：${calculateAge(draft.birthDate)} 岁` : "需要年满 18 岁。"}><TextInput type="date" max={ageCutoffDate()} value={draft.birthDate} onChange={event => setProfile("birthDate", event.target.value)} /></FormField>
                <FormField label="本轮想匹配的性别" hint={draft.orientation === "bisexual" ? "双性恋用户每个匹配池可以单独选择一种目标性别。" : "该选项由你的性取向自动确定。"}>
                  <NativeSelect value={draft.seekingGender} disabled={draft.orientation !== "bisexual"} onChange={event => changeSeekingGender(event.target.value as MatchProfile["seekingGender"])}><option value="male">男</option><option value="female">女</option><option disabled>其他性别（Coming soon）</option></NativeSelect>
                </FormField>
              </div>
              <div className="mt-5 rounded-2xl bg-violet-50 p-4 text-sm leading-6 text-violet-900">
                <strong>双向匹配规则：</strong>选择同性时，只会进入同性恋或同样选择同性的双性恋候选池；选择异性时，只会进入异性恋或同样选择异性的双性恋候选池。双方目标必须互相指向。
              </div>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <FormField label="关于我" optional hint="匹配后可作为自我介绍展示，不参与必要条件。"><TextArea value={draft.bio ?? ""} onChange={event => setProfile("bio", event.target.value)} placeholder="简单介绍你的生活、兴趣和当下状态" /></FormField>
                <FormField label="希望遇见怎样的人" optional hint="这是一段软性介绍，系统不会从中推测或生成硬性筛选条件。"><TextArea value={draft.partnerIntro ?? ""} onChange={event => setProfile("partnerIntro", event.target.value)} placeholder="写下你对相处方式或关系氛围的期待" /></FormField>
              </div>
            </Card>

            <Card className="p-5 sm:p-7">
              <div className="mb-6"><h2 className="text-xl font-bold">选填资料</h2><p className="mt-1 text-sm text-muted-foreground">填写更完整，能让彼此更准确地确认是否符合对方的必要条件；未填写的信息不会由系统猜测。</p></div>
              {profileFieldConfig.groups.filter(group => !["identity"].includes(group.id)).map(group => {
                const fields = profileFieldConfig.fields.filter(field => field.group === group.id && !field.required && !["legalName", "displayName", "gender", "orientation", "seekingGender", "birthDate"].includes(field.id));
                if (!fields.length) return null;
                return (
                  <div key={group.id} className="mb-8 last:mb-0">
                    <h3 className="mb-1 font-bold">{group.label}</h3><p className="mb-4 text-xs text-muted-foreground">{group.description}</p>
                    <div className="grid gap-5 md:grid-cols-2">
                      {fields.map(field => {
                        const fieldId = field.id as OptionalProfileFieldId;
                        const value = draft.details[fieldId];
                        if (field.input === "single_select") {
                          return <FormField key={field.id} label={field.label} optional><NativeSelect value={String(value ?? "")} onChange={event => setDetail(fieldId, event.target.value || undefined)}><option value="">暂不填写</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect></FormField>;
                        }
                        if (field.input === "multi_select") {
                          const selected = Array.isArray(value) ? value as string[] : [];
                          return <FormField key={field.id} label={field.label} optional><div className="flex min-h-11 flex-wrap gap-2 rounded-2xl border border-border bg-input-background p-2">{field.options?.map(option => <button key={option.value} type="button" onClick={() => setDetail(fieldId, selected.includes(option.value) ? selected.filter(item => item !== option.value) : [...selected, option.value])} className={cx("min-h-11 rounded-xl px-3 text-xs font-semibold", selected.includes(option.value) ? "bg-primary text-white" : "bg-card text-muted-foreground")}>{option.label}</button>)}</div></FormField>;
                        }
                        return <FormField key={field.id} label={field.label} optional><TextInput type={field.input === "number" ? "number" : "text"} min={field.min} max={field.max} step={field.step} value={value === undefined ? "" : String(value)} placeholder={field.placeholder} onChange={event => setDetail(fieldId, field.input === "number" ? (event.target.value ? Number(event.target.value) : undefined) : event.target.value || undefined)} /></FormField>;
                      })}
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        ) : null}

        {tab === "criteria" ? (
          <div className="space-y-6">
            <Card className="overflow-hidden">
              <div className="bg-gradient-to-br from-orange-50 via-white to-violet-50 p-6 sm:p-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-2xl"><div className="mb-3 flex items-center gap-2 text-primary"><Sparkles size={19} /><span className="text-sm font-bold">必要条件</span></div><h2 className="text-2xl font-bold">{HARD_FILTER_GUIDANCE.title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{HARD_FILTER_GUIDANCE.body}</p></div>
                  <Pill tone={rangeKey === "broad" ? "green" : rangeKey === "balanced" ? "amber" : "purple"}>{HARD_FILTER_GUIDANCE.rangeLabels[rangeKey]}</Pill>
                </div>
                <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-foreground"><ShieldCheck size={16} className="text-emerald-600" />{HARD_FILTER_GUIDANCE.promise}</p>
              </div>
            </Card>

            <Card className="p-5 sm:p-7">
              <h2 className="text-xl font-bold">始终生效</h2><p className="mt-1 text-sm text-muted-foreground">目标性别、取向兼容和年龄范围不会被系统越过。</p>
              <div className="mt-5 grid gap-5 md:grid-cols-3">
                <FormField label="目标性别"><NativeSelect value={criteriaDraft.targetGender} disabled={draft.orientation !== "bisexual"} onChange={event => changeSeekingGender(event.target.value as MatchProfile["seekingGender"])}><option value="male">男</option><option value="female">女</option><option disabled>其他性别（Coming soon）</option></NativeSelect></FormField>
                <FormField label="最低年龄"><TextInput type="number" min={18} max={99} value={criteriaDraft.ageRange.min} onChange={event => setCriteriaDraft(current => current ? { ...current, ageRange: { ...current.ageRange, min: Number(event.target.value) } } : current)} /></FormField>
                <FormField label="最高年龄"><TextInput type="number" min={18} max={99} value={criteriaDraft.ageRange.max} onChange={event => setCriteriaDraft(current => current ? { ...current, ageRange: { ...current.ageRange, max: Number(event.target.value) } } : current)} /></FormField>
              </div>
            </Card>

            <Card className="divide-y divide-border overflow-hidden">
              {filterableProfileFields.map(field => {
                const rule = criteriaDraft.optional[field.id];
                const enabled = Boolean(rule);
                const myValue = draft.details[field.id];
                return (
                  <div key={field.id} className="p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{field.label}</h3>{field.sensitive ? <Pill>敏感信息</Pill> : null}{!valueIsPresent(myValue) ? <Pill tone="amber">本人资料未填写</Pill> : null}</div><p className="mt-1 text-xs text-muted-foreground">我的资料：{valueIsPresent(myValue) ? Array.isArray(myValue) ? myValue.map(value => optionLabel(field.id, value)).join("、") : optionLabel(field.id, myValue) : "暂未填写"}</p></div>
                      <button type="button" role="switch" aria-label={`将${field.label}设为必要条件`} aria-checked={enabled} onClick={() => toggleFilter(field.id, !enabled)} className={cx("relative h-11 w-14 shrink-0 rounded-full transition-colors", enabled ? "bg-primary" : "bg-muted")}><span className={cx("absolute top-2 h-7 w-7 rounded-full bg-white shadow-sm transition-all", enabled ? "left-6" : "left-1")} /></button>
                    </div>
                    {enabled && rule ? (
                      <div className="mt-4 rounded-2xl bg-muted/35 p-4">
                        {rule.kind === "range" ? (
                          <div className="grid grid-cols-2 gap-3"><TextInput aria-label={`${field.label}最低值`} type="number" min={field.min} max={field.max} placeholder={`最低${field.unit ?? ""}`} value={rule.min ?? ""} onChange={event => updateRule(field.id, { ...rule, min: event.target.value ? Number(event.target.value) : undefined })} /><TextInput aria-label={`${field.label}最高值`} type="number" min={field.min} max={field.max} placeholder={`最高${field.unit ?? ""}`} value={rule.max ?? ""} onChange={event => updateRule(field.id, { ...rule, max: event.target.value ? Number(event.target.value) : undefined })} /></div>
                        ) : field.options?.length ? (
                          <div className="flex flex-wrap gap-2">{field.options.map(option => { const selected = "values" in rule && rule.values.includes(option.value); return <button key={option.value} type="button" onClick={() => { const values = "values" in rule ? rule.values : []; updateRule(field.id, { kind: rule.kind === "contains_any" ? "contains_any" : "one_of", values: selected ? values.filter(value => value !== option.value) : [...values, option.value] }); }} className={cx("min-h-11 rounded-xl border px-3 text-xs font-semibold", selected ? "border-primary bg-primary text-white" : "border-border bg-card text-muted-foreground")}>{selected ? <Check size={13} className="mr-1 inline" /> : null}{option.label}</button>; })}</div>
                        ) : (
                          <TextInput aria-label={`${field.label}可接受值`} placeholder="输入可接受的值，多个值用逗号分隔" value={"values" in rule ? rule.values.join(", ") : ""} onChange={event => updateRule(field.id, { kind: "one_of", values: event.target.value.split(",").map(value => value.trim()).filter(Boolean) })} />
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">候选人没有填写这一项时，会被视为不符合该必要条件。</p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </Card>
          </div>
        ) : null}

        {tab === "privacy" ? (
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="p-5 sm:p-7">
              <div className="mb-5 flex items-start gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><LockKeyhole size={21} /></div><div><h2 className="text-xl font-bold">逐项决定是否展示</h2><p className="mt-1 text-sm text-muted-foreground">“仅用于匹配”仍会参与算法，但不会出现在对方资料卡上。</p></div></div>
              <div className="divide-y divide-border">
                {profileFieldConfig.fields.filter(field => !field.required && valueIsPresent(draft.details[field.id as OptionalProfileFieldId])).map(field => {
                  const visibility = draft.fieldVisibility[field.id] ?? field.defaultVisibility;
                  return (
                    <div key={field.id} className="flex items-center justify-between gap-4 py-4">
                      <div><p className="text-sm font-semibold">{field.label}</p><p className="mt-0.5 text-xs text-muted-foreground">{visibility === "matching_only" ? "只参与匹配，不向对方展示" : "匹配后可见"}</p></div>
                      <button type="button" onClick={() => setDraft(current => current ? { ...current, fieldVisibility: { ...current.fieldVisibility, [field.id]: visibility === "matching_only" ? "after_match" : "matching_only" } } : current)} className="flex min-h-11 items-center gap-2 rounded-2xl border border-border px-3 text-xs font-semibold hover:bg-muted/50">
                        {visibility === "matching_only" ? <EyeOff size={16} /> : <Eye size={16} />}{visibility === "matching_only" ? "仅匹配" : "匹配后可见"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </Card>

            <div className="space-y-6">
              <Card className="p-5 sm:p-7"><h2 className="text-xl font-bold">联系方式</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">报名活动时可从这里选择至少一种联系方式，并按照活动规则释放。</p><div className="mt-5 space-y-4"><FormField label="邮箱"><TextInput type="email" value={draft.contacts.email} onChange={event => setDraft(current => current ? { ...current, contacts: { ...current.contacts, email: event.target.value } } : current)} /></FormField><FormField label="微信" optional><TextInput value={draft.contacts.wechat ?? ""} onChange={event => setDraft(current => current ? { ...current, contacts: { ...current.contacts, wechat: event.target.value } } : current)} /></FormField><FormField label="Instagram" optional><TextInput value={draft.contacts.instagram ?? ""} onChange={event => setDraft(current => current ? { ...current, contacts: { ...current.contacts, instagram: event.target.value } } : current)} /></FormField></div></Card>
              <Card className="p-5 sm:p-7"><div className="flex items-center gap-2 text-emerald-700"><ShieldCheck size={19} /><h2 className="font-bold">始终私密</h2></div><ul className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground"><li>• 真实姓名与完整出生日期不会提供给匹配对象。</li><li>• 主办方默认只能查看活动题答案和资料完成度。</li><li>• 系统不会告诉任何人具体是哪项条件让一对候选未能匹配。</li></ul></Card>
            </div>
          </div>
        ) : null}

        <div className="sticky bottom-20 z-20 mt-6 flex items-center justify-between gap-3 rounded-3xl border border-border bg-card/95 p-3 shadow-xl backdrop-blur md:bottom-4">
          <div className="hidden items-center gap-2 pl-2 text-xs text-muted-foreground sm:flex"><Info size={15} />更改会用于下一次尚未运行的匹配。</div>
          <div className="ml-auto flex gap-2">
            {tab !== "identity" ? <V2Button type="button" variant="secondary" onClick={() => changeTab(tab === "privacy" ? "criteria" : "identity")}>上一步</V2Button> : null}
            {tab !== "privacy" ? <V2Button type="button" onClick={() => changeTab(tab === "identity" ? "criteria" : "privacy")}>继续</V2Button> : <V2Button type="submit" disabled={saving}>{saving ? "保存中…" : "保存全部设置"}</V2Button>}
          </div>
        </div>
      </form>
    </div>
  );
}
