import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft, CalendarDays, Check, CheckCircle2, ChevronRight, CircleHelp, Clock3,
  Eye, EyeOff, GraduationCap, HeartHandshake, Link2, LockKeyhole, MapPin,
  Plus, Settings2, ShieldCheck, Sparkles, UserRound, UsersRound, X, Zap,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import type {
  ContactReleasePolicy, CreatePoolInput, CustomQuestion, CustomQuestionType,
  HardFilterRule, MatchCriteria, MatchingMode, OptionalProfileFieldId, OrganizerRunReport, PoolDetails, PoolMembership, PoolSummary, PoolVisibility, ProfileFieldId,
} from "./domain";
import { filterableProfileFields, profileFieldById } from "./field-config";
import { useV2 } from "./useV2";
import { Card, cx, EmptyState, FormField, NativeSelect, PageHeading, Pill, TextArea, TextInput, V2Button } from "./ui";

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿", open: "报名中", registration_closed: "报名已截止", matching: "匹配中",
  ready: "待揭晓", revealed: "已匹配", archived: "已结束",
};

const TONE_CLASS = {
  coral: "from-orange-100 via-rose-50 to-amber-50 text-orange-950",
  cobalt: "from-blue-100 via-indigo-50 to-white text-blue-950",
  violet: "from-violet-100 via-fuchsia-50 to-white text-violet-950",
  green: "from-emerald-100 via-teal-50 to-white text-emerald-950",
};

function formatDate(value?: string, timeZone?: string) {
  if (!value) return "时间待定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间待定";
  return new Intl.DateTimeFormat("zh-CN", { timeZone, month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function zonedLocalToUtc(value: string, timeZone: string) {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return "";
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  if ([year, month, day, hour, minute].some(Number.isNaN)) return "";
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const partsAt = (instant: number) => Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(instant)).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  let instant = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const actual = partsAt(instant);
    instant += target - Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
  }
  return new Date(instant).toISOString();
}

function eventPath(pool: PoolSummary | PoolDetails) {
  return `/events/${pool.slug || pool.id}`;
}

function RegistrationQuestionInput({
  question,
  value,
  onChange,
}: {
  question: CustomQuestion;
  value: string | number | boolean | string[] | null | undefined;
  onChange: (value: string | boolean | string[]) => void;
}) {
  if (question.type === "longText") {
    return <TextArea value={String(value ?? "")} onChange={event => onChange(event.target.value)} />;
  }

  if (question.type === "boolean") {
    return (
      <NativeSelect
        value={value === true ? "true" : value === false ? "false" : ""}
        onChange={event => onChange(event.target.value === "" ? "" : event.target.value === "true")}
      >
        <option value="">请选择</option>
        <option value="true">是</option>
        <option value="false">否</option>
      </NativeSelect>
    );
  }

  if (question.type === "singleSelect") {
    return (
      <NativeSelect value={typeof value === "string" ? value : ""} onChange={event => onChange(event.target.value)}>
        <option value="">请选择</option>
        {question.options?.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </NativeSelect>
    );
  }

  if (question.type === "multiSelect") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex min-h-11 flex-wrap gap-2 rounded-2xl border border-border bg-input-background p-2">
        {question.options?.map(option => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id])}
            className={cx("min-h-11 rounded-xl px-3 text-xs font-semibold", selected.includes(option.id) ? "bg-primary text-white" : "bg-card text-muted-foreground")}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  return <TextInput value={typeof value === "string" ? value : ""} onChange={event => onChange(event.target.value)} />;
}

function EventCard({ pool, relation }: { pool: PoolSummary; relation?: "joined" | "organized" }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(eventPath(pool))} className="group overflow-hidden rounded-3xl border border-border bg-card text-left shadow-[0_10px_40px_rgba(44,35,28,0.04)] transition-transform hover:-translate-y-1">
      <div className={cx("relative min-h-36 bg-gradient-to-br p-5", TONE_CLASS[pool.coverTone])}>
        <div className="flex items-start justify-between gap-3"><Pill tone={pool.visibility === "public" ? "green" : "purple"}>{pool.visibility === "public" ? "公开活动" : "私密邀请"}</Pill><Pill>{STATUS_LABELS[pool.status] ?? pool.status}</Pill></div>
        <div className="mt-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/75 shadow-sm"><HeartHandshake size={24} /></div>
      </div>
      <div className="p-5">
        <div className="mb-2 flex items-center gap-2">{relation ? <Pill tone={relation === "organized" ? "orange" : "blue"}>{relation === "organized" ? "我发起的" : "已报名"}</Pill> : null}<Pill tone={pool.matchingMode === "profileAndQuestionnaire" ? "purple" : "neutral"}>{pool.matchingMode === "profileAndQuestionnaire" ? "价值观匹配" : "资料相似度"}</Pill></div>
        <h2 className="text-xl font-bold group-hover:text-primary">{pool.name}</h2>
        <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{pool.summary}</p>
        <div className="mt-4 space-y-2 text-xs text-muted-foreground"><p className="flex items-center gap-2"><CalendarDays size={14} />{formatDate(pool.startsAt, pool.timeZone)}</p><p className="flex items-center gap-2"><MapPin size={14} />{pool.location?.mode === "online" ? "线上活动" : [pool.location?.city, pool.location?.venue].filter(Boolean).join(" · ") || "地点待定"}</p></div>
        <div className="mt-5 flex items-center justify-between border-t border-border pt-4"><span className="text-xs text-muted-foreground"><UsersRound size={14} className="mr-1 inline" />{pool.confirmedCount}/{pool.participantLimit ?? "不限"} 人</span><span className="flex items-center gap-1 text-xs font-bold text-primary">查看活动<ChevronRight size={14} /></span></div>
      </div>
    </button>
  );
}

export function EventsHubPage() {
  const { profile, pools } = useV2();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"discover" | "joined" | "organized">("discover");

  const visiblePools = useMemo(() => pools.filter(pool => {
    if (pool.type !== "event") return false;
    if (tab === "discover") return pool.visibility === "public" && pool.status === "open";
    if (tab === "joined") return pool.myMembership?.role === "participant" && pool.myMembership.status !== "withdrawn";
    return pool.organizerId === profile?.id;
  }), [pools, profile?.id, tab]);

  return (
    <div>
      <PageHeading eyebrow="活动与圈子" title="借一个共同的场合，认真认识一个人" description="参加公开活动，或通过邀请码进入私密活动。每个活动都有独立的条件、同意和匹配结果。" action={<V2Button onClick={() => navigate("/events/new")}><Plus size={18} />发起活动</V2Button>} />

      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
        {([ ["discover", "发现活动"], ["joined", "我参加的"], ["organized", "我发起的"] ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={cx("min-h-11 shrink-0 rounded-2xl px-4 text-sm font-bold", tab === id ? "bg-foreground text-background" : "border border-border bg-card text-muted-foreground")}>{label}</button>)}
      </div>

      {visiblePools.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{visiblePools.map(pool => <EventCard key={pool.id} pool={pool} relation={pool.organizerId === profile?.id ? "organized" : pool.myMembership ? "joined" : undefined} />)}</div> : <EmptyState icon={<CalendarDays size={26} />} title={tab === "discover" ? "暂时没有新的公开活动" : tab === "joined" ? "你还没有报名活动" : "从发起第一场活动开始"} description={tab === "discover" ? "稍后再来看看，或创建一场你真正想参加的相遇。" : tab === "joined" ? "公开活动和私密邀请都会出现在这里。" : "邀请一群认真认识彼此的人，系统会帮你完成报名与一次匹配。"} action={tab === "organized" ? <V2Button onClick={() => navigate("/events/new")}>发起活动</V2Button> : undefined} />}

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <Card className="relative overflow-hidden p-6 opacity-80"><div className="absolute right-4 top-4"><Pill>Coming soon</Pill></div><GraduationCap size={28} className="text-blue-600" /><h2 className="mt-5 text-xl font-bold">学校匹配圈</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">通过学校身份加入长期圈子，在每一轮认识新的校友。</p></Card>
        <Card className="relative overflow-hidden p-6 opacity-80"><div className="absolute right-4 top-4"><Pill>Coming soon</Pill></div><UsersRound size={28} className="text-violet-600" /><h2 className="mt-5 text-xl font-bold">公司与社群</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">为可信组织创建持续、多轮的小范围匹配。</p></Card>
      </div>
    </div>
  );
}

function EventPrivacySummary({ pool }: { pool: PoolDetails | PoolSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl bg-muted/40 p-4"><div className="flex items-center gap-2 text-sm font-bold">{pool.resultPolicy.organizerCanViewPairs ? <Eye size={16} /> : <EyeOff size={16} />}主办方配对权限</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{pool.resultPolicy.organizerCanViewPairs ? "主办方可以查看配对昵称，但看不到联系方式。" : "主办方只能看到成功对数和未匹配人数。"}</p></div>
      <div className="rounded-2xl bg-muted/40 p-4"><div className="flex items-center gap-2 text-sm font-bold"><LockKeyhole size={16} />联系方式</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{pool.resultPolicy.contactReleasePolicy === "immediate" ? "匹配揭晓后立即向双方开放。" : "双方都点击“想认识”后才开放。"}</p></div>
    </div>
  );
}

export function EventDetailPage() {
  const { eventId = "" } = useParams();
  const { profile, service } = useV2();
  const navigate = useNavigate();
  const [pool, setPool] = useState<PoolDetails | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    service.getPool(eventId).then(setPool).catch(errorValue => setError(errorValue instanceof Error ? errorValue.message : "活动不存在"));
  }, [eventId, service]);

  if (error) return <EmptyState icon={<CircleHelp size={26} />} title="找不到这场活动" description={error} action={<V2Button onClick={() => navigate("/events")}>返回活动广场</V2Button>} />;
  if (!pool) return <div className="py-20 text-center text-sm text-muted-foreground">正在加载活动…</div>;

  const isOrganizer = pool.organizerId === profile?.id;
  const membership = pool.myMembership;
  const canRegister = pool.status === "open" && (!membership || membership.status === "withdrawn");

  return (
    <div className="mx-auto max-w-6xl">
      <button type="button" onClick={() => navigate("/events")} className="mb-5 flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={17} />返回活动</button>
      <div className={cx("overflow-hidden rounded-[2rem] bg-gradient-to-br p-6 sm:p-10", TONE_CLASS[pool.coverTone])}>
        <div className="flex flex-wrap items-center gap-2"><Pill tone={pool.visibility === "public" ? "green" : "purple"}>{pool.visibility === "public" ? "公开活动" : "仅限邀请"}</Pill><Pill>{STATUS_LABELS[pool.status]}</Pill><Pill tone={pool.matchingMode === "profileAndQuestionnaire" ? "purple" : "blue"}>{pool.matchingMode === "profileAndQuestionnaire" ? "价值观问卷匹配" : "资料相似度匹配"}</Pill></div>
        <h1 tabIndex={-1} className="mt-7 max-w-3xl text-3xl font-bold leading-tight outline-none sm:text-5xl">{pool.name}</h1><p className="mt-3 max-w-2xl text-base leading-7 opacity-75">{pool.summary}</p>
        <div className="mt-8 grid gap-3 text-sm sm:grid-cols-3"><div className="rounded-2xl bg-white/60 p-4"><CalendarDays size={18} /><p className="mt-2 font-bold">{formatDate(pool.startsAt, pool.timeZone)}</p><p className="mt-1 text-xs opacity-60">{pool.timeZone}</p></div><div className="rounded-2xl bg-white/60 p-4"><MapPin size={18} /><p className="mt-2 font-bold">{pool.location?.mode === "online" ? "线上活动" : [pool.location?.city, pool.location?.venue].filter(Boolean).join(" · ") || "地点待定"}</p></div><div className="rounded-2xl bg-white/60 p-4"><UsersRound size={18} /><p className="mt-2 font-bold">{pool.confirmedCount}/{pool.participantLimit ?? "不限"} 人已确认</p></div></div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-6 sm:p-8"><h2 className="text-xl font-bold">关于活动</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-muted-foreground">{pool.description || pool.summary}</p></Card>
          <Card className="p-6 sm:p-8"><div className="mb-4 flex items-center gap-2"><ShieldCheck size={19} className="text-emerald-700" /><h2 className="text-xl font-bold">报名之前，你会清楚知道结果如何使用</h2></div><EventPrivacySummary pool={pool} /><p className="mt-4 text-xs leading-5 text-muted-foreground">主办方的这两项设置会在第一位参与者确认报名后锁定。你的标准资料默认不会向主办方展示。</p></Card>
          {pool.customQuestions.length ? <Card className="p-6 sm:p-8"><h2 className="text-xl font-bold">本场报名还会询问</h2><div className="mt-4 flex flex-wrap gap-2">{pool.customQuestions.map(question => <Pill key={question.id}>{question.label}</Pill>)}</div><p className="mt-3 text-xs text-muted-foreground">这些活动题只用于报名，不参与算法或必要条件。</p></Card> : null}
        </div>
        <aside>
          <Card className="sticky top-28 p-5">
            {isOrganizer ? <><Pill tone="orange">你是主办方</Pill><h2 className="mt-4 text-xl font-bold">活动控制台</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">查看报名进度，并在准备好后手动结束报名、运行一次匹配。</p><V2Button className="mt-5 w-full" onClick={() => navigate(`/events/${pool.id}/manage`)}><Settings2 size={17} />管理活动</V2Button>{pool.status === "open" ? <V2Button className="mt-3 w-full" variant="secondary" onClick={() => navigate(`/events/${pool.id}/register`)}>{membership?.participatesInMatching ? membership.status === "confirmed" ? "已单独报名参加匹配" : "继续我的参与报名" : "我也要参加匹配"}</V2Button> : null}<div className="mt-3 rounded-2xl bg-muted/40 p-3">{pool.visibility === "invite_only" ? <p className="mb-2 text-xs text-muted-foreground">邀请码 <strong className="ml-1 text-foreground">{pool.joinCode}</strong></p> : null}<V2Button className="w-full" variant="secondary" onClick={() => { const invitation = `${window.location.origin}${eventPath(pool)}${pool.visibility === "invite_only" && pool.joinCode ? `\n邀请码：${pool.joinCode}` : ""}`; navigator.clipboard.writeText(invitation).then(() => toast.success("活动邀请已复制")); }}><Link2 size={16} />复制活动邀请</V2Button></div></> : membership && membership.status !== "withdrawn" ? <><Pill tone="green">{membership.status === "confirmed" ? "已确认参加" : "报名未完成"}</Pill><h2 className="mt-4 text-xl font-bold">你已加入这场活动</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">活动匹配会使用你为本场确认的资料、条件和隐私授权。</p>{membership.status !== "confirmed" ? <V2Button className="mt-5 w-full" onClick={() => navigate(`/events/${pool.id}/register`)}>继续报名</V2Button> : <V2Button className="mt-5 w-full" variant="secondary" onClick={() => navigate("/matches")}>查看匹配中心</V2Button>}</> : <><Pill tone={canRegister ? "green" : "neutral"}>{canRegister ? "正在报名" : "报名已结束"}</Pill><h2 className="mt-4 text-xl font-bold">参加本次匹配</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">需要站内账号和完整基础资料。你可以为本场单独调整目标性别和必要条件。</p><V2Button disabled={!canRegister} className="mt-5 w-full" onClick={() => navigate(`/events/${pool.id}/register`)}>开始报名</V2Button></>}
          </Card>
        </aside>
      </div>
    </div>
  );
}

const CREATE_STEPS = ["基本信息", "可见性", "报名表", "匹配方式", "结果权限", "确认发布"];

export function EventCreatePage() {
  const { service } = useV2();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("2026-09-12T18:30");
  const [registrationClosesAt, setRegistrationClosesAt] = useState("2026-09-10T20:00");
  const [timeZone, setTimeZone] = useState("America/Los_Angeles");
  const [city, setCity] = useState("San Francisco");
  const [venue, setVenue] = useState("");
  const [participantLimit, setParticipantLimit] = useState(24);
  const [visibility, setVisibility] = useState<PoolVisibility>("public");
  const [requiredFields, setRequiredFields] = useState<ProfileFieldId[]>(["city", "relationshipGoal"]);
  const [customQuestions, setCustomQuestions] = useState<CustomQuestion[]>([]);
  const [matchingMode, setMatchingMode] = useState<MatchingMode>("profileAndQuestionnaire");
  const [organizerCanViewPairs, setOrganizerCanViewPairs] = useState(false);
  const [contactReleasePolicy, setContactReleasePolicy] = useState<ContactReleasePolicy>("mutualInterest");

  const addQuestion = () => {
    if (customQuestions.length >= 10) return toast.error("每场活动最多添加 10 道自定义题");
    setCustomQuestions(current => [...current, { id: `question-${Date.now()}`, label: "", type: "shortText", required: false }]);
  };

  const updateQuestion = (id: string, patchValue: Partial<CustomQuestion>) => setCustomQuestions(current => current.map(question => question.id === id ? { ...question, ...patchValue } : question));

  const publish = async () => {
    if (!name.trim() || !summary.trim()) { setStep(0); toast.error("请填写活动名称和一句话介绍"); return; }
    if (!startsAt || !registrationClosesAt || new Date(zonedLocalToUtc(registrationClosesAt, timeZone)) >= new Date(zonedLocalToUtc(startsAt, timeZone))) { setStep(0); toast.error("匹配报名截止时间需要早于活动开始时间"); return; }
    if (customQuestions.some(question => !question.label.trim())) { setStep(2); toast.error("请补全所有报名题目"); return; }
    setSaving(true);
    try {
      const input: CreatePoolInput = {
        type: "event", name: name.trim(), summary: summary.trim(), description: description.trim(), coverTone: "coral",
        visibility, joinCode: visibility === "public" ? undefined : `CG-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        startsAt: zonedLocalToUtc(startsAt, timeZone), registrationClosesAt: zonedLocalToUtc(registrationClosesAt, timeZone), timeZone, location: { mode: "in_person", city: city.trim(), venue: venue.trim() }, participantLimit,
        requiredFieldIds: requiredFields, allowCriteriaOverride: true, matchingMode,
        resultPolicy: { organizerCanViewPairs, contactReleasePolicy }, customQuestions,
      };
      const created = await service.createPool(input);
      await service.updatePool(created.id, { status: "open" });
      toast.success("活动已发布");
      navigate(`/events/${created.id}/manage`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发布失败，请重试");
    } finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <button type="button" onClick={() => navigate("/events")} className="mb-4 flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground"><ArrowLeft size={17} />取消创建</button>
      <PageHeading eyebrow="发起活动" title="把一场相遇，安排得清楚又安心" description="六个步骤设置报名方式、匹配依据和结果权限。第一位参与者确认后，隐私规则将被锁定。" />
      <div className="mb-6 grid grid-cols-3 gap-1 rounded-3xl border border-border bg-card p-2 sm:grid-cols-6">{CREATE_STEPS.map((label, index) => <button key={label} type="button" aria-current={step === index ? "step" : undefined} onClick={() => setStep(index)} className={cx("min-h-12 rounded-2xl px-1 text-[10px] font-bold sm:text-xs", step === index ? "bg-foreground text-background" : index < step ? "bg-emerald-50 text-emerald-700" : "text-muted-foreground hover:bg-muted/50")}><span className="hidden sm:inline">{index + 1}. </span>{label}</button>)}</div>

      <Card className="p-5 sm:p-8">
        {step === 0 ? <div><h2 className="text-2xl font-bold">基本信息</h2><div className="mt-6 grid gap-5 md:grid-cols-2"><div className="md:col-span-2"><FormField label="活动名称"><TextInput value={name} onChange={event => setName(event.target.value)} placeholder="例如：湾区秋日散步与晚餐" /></FormField></div><div className="md:col-span-2"><FormField label="一句话介绍"><TextInput value={summary} onChange={event => setSummary(event.target.value)} placeholder="让参与者快速理解活动氛围" /></FormField></div><div className="md:col-span-2"><FormField label="详细说明" optional><TextArea value={description} onChange={event => setDescription(event.target.value)} placeholder="活动安排、适合的人群、注意事项……" /></FormField></div><FormField label="开始时间"><TextInput type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></FormField><FormField label="匹配报名截止"><TextInput type="datetime-local" value={registrationClosesAt} onChange={event => setRegistrationClosesAt(event.target.value)} /></FormField><FormField label="活动时区"><NativeSelect value={timeZone} onChange={event => setTimeZone(event.target.value)}><option value="America/Los_Angeles">美国太平洋时间</option><option value="America/New_York">美国东部时间</option><option value="Asia/Shanghai">中国标准时间</option><option value="UTC">UTC</option></NativeSelect></FormField><FormField label="人数上限"><TextInput type="number" min={2} max={200} value={participantLimit} onChange={event => setParticipantLimit(Number(event.target.value))} /></FormField><FormField label="城市"><TextInput value={city} onChange={event => setCity(event.target.value)} /></FormField><FormField label="地点"><TextInput value={venue} onChange={event => setVenue(event.target.value)} placeholder="确认后可再补充" /></FormField></div></div> : null}

        {step === 1 ? <div><h2 className="text-2xl font-bold">谁可以看到和加入</h2><p className="mt-2 text-sm text-muted-foreground">无论公开或私密，报名都需要登录站内账号。</p><div className="mt-6 grid gap-4 md:grid-cols-2">{([ ["public", "公开活动", "出现在活动广场，任何站内用户都可报名。", Eye], ["invite_only", "私密邀请", "只通过站内邀请链接或邀请码进入。", LockKeyhole] ] as const).map(([value, label, descriptionValue, Icon]) => <button key={value} type="button" onClick={() => setVisibility(value)} className={cx("rounded-3xl border p-6 text-left", visibility === value ? "border-primary bg-orange-50 ring-2 ring-primary/10" : "border-border")}><Icon size={24} className={visibility === value ? "text-primary" : "text-muted-foreground"} /><h3 className="mt-5 text-lg font-bold">{label}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{descriptionValue}</p>{visibility === value ? <p className="mt-4 flex items-center gap-2 text-xs font-bold text-primary"><Check size={15} />已选择</p> : null}</button>)}</div></div> : null}

        {step === 2 ? <div><h2 className="text-2xl font-bold">报名需要哪些信息</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">标准资料只用于确认完成度和匹配，主办方默认看不到具体值。自定义活动题答案会对主办方可见，但不进入算法。</p><h3 className="mt-7 font-bold">要求完成的标准资料</h3><div className="mt-3 flex flex-wrap gap-2">{filterableProfileFields.map(field => { const selected = requiredFields.includes(field.id); return <button key={field.id} type="button" onClick={() => setRequiredFields(current => selected ? current.filter(id => id !== field.id) : [...current, field.id])} className={cx("min-h-11 rounded-xl border px-3 text-xs font-semibold", selected ? "border-primary bg-primary text-white" : "border-border")}>{selected ? <Check size={13} className="mr-1 inline" /> : null}{field.label}</button>; })}</div><div className="mt-8 flex items-center justify-between"><div><h3 className="font-bold">活动自定义题</h3><p className="mt-1 text-xs text-muted-foreground">最多 10 题；当前 {customQuestions.length} 题</p></div><V2Button type="button" variant="secondary" onClick={addQuestion}><Plus size={16} />添加问题</V2Button></div><div className="mt-4 space-y-3">{customQuestions.map((question, index) => <div key={question.id} className="grid gap-3 rounded-2xl bg-muted/35 p-4 md:grid-cols-[36px_1fr_170px_auto]"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-card text-xs font-bold">{index + 1}</span><TextInput aria-label={`问题 ${index + 1}`} value={question.label} onChange={event => updateQuestion(question.id, { label: event.target.value })} placeholder="输入报名问题" /><NativeSelect aria-label={`问题 ${index + 1} 类型`} value={question.type} onChange={event => { const type = event.target.value as CustomQuestionType; updateQuestion(question.id, { type, options: type === "singleSelect" || type === "multiSelect" ? question.options ?? [{ id: `${question.id}-a`, label: "选项 A" }, { id: `${question.id}-b`, label: "选项 B" }] : undefined }); }}><option value="shortText">短文本</option><option value="longText">长文本</option><option value="singleSelect">单选</option><option value="multiSelect">多选</option><option value="boolean">是非题</option></NativeSelect><button type="button" onClick={() => setCustomQuestions(current => current.filter(item => item.id !== question.id))} className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-red-50 hover:text-red-600" aria-label="删除问题"><X size={17} /></button><label className="md:col-start-2 flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold"><input type="checkbox" checked={question.required} onChange={event => updateQuestion(question.id, { required: event.target.checked })} className="h-4 w-4 accent-primary" />设为必答题</label>{question.type === "singleSelect" || question.type === "multiSelect" ? <TextInput className="md:col-span-2" aria-label={`问题 ${index + 1} 选项`} value={(question.options ?? []).map(option => option.label).join("，")} onChange={event => updateQuestion(question.id, { options: event.target.value.split(/[，,]/).map((label, optionIndex) => ({ id: `${question.id}-${optionIndex + 1}`, label: label.trim() })).filter(option => option.label) })} placeholder="用逗号分隔至少两个选项" /> : null}</div>)}</div></div> : null}

        {step === 3 ? <div><h2 className="text-2xl font-bold">如何决定彼此更合适</h2><div className="mt-6 grid gap-4 md:grid-cols-2">{([ ["profileAndQuestionnaire", "价值观问卷匹配", "先执行双方必要条件，再使用 24 题价值观问卷排序。未完成问卷的人不会进入本轮。", Sparkles], ["profileSimilarity", "资料相似度匹配", "先执行双方必要条件，再按照平台统一权重比较结构化资料。", UsersRound] ] as const).map(([value, label, descriptionValue, Icon]) => <button key={value} type="button" onClick={() => setMatchingMode(value)} className={cx("rounded-3xl border p-6 text-left", matchingMode === value ? "border-primary bg-orange-50 ring-2 ring-primary/10" : "border-border")}><Icon size={24} className={matchingMode === value ? "text-primary" : "text-muted-foreground"} /><h3 className="mt-5 text-lg font-bold">{label}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{descriptionValue}</p></button>)}</div><div className="mt-6 rounded-2xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"><strong>两种方式都会遵守：</strong>目标性别互指、取向兼容、年龄与双方全部必要条件。系统宁可留下未匹配，也不会越过任何一方的“必须”。</div></div> : null}

        {step === 4 ? <div><h2 className="text-2xl font-bold">结果权限</h2><p className="mt-2 text-sm text-muted-foreground">两项设置相互独立，并会在第一位参与者确认后锁定。</p><div className="mt-6 space-y-4"><label className="flex cursor-pointer items-start gap-4 rounded-3xl border border-border p-5"><input type="checkbox" className="mt-1 h-5 w-5 accent-primary" checked={organizerCanViewPairs} onChange={event => setOrganizerCanViewPairs(event.target.checked)} /><span><strong className="block">主办方可以查看配对名单</strong><span className="mt-1 block text-sm leading-6 text-muted-foreground">只显示配对昵称，不包含联系方式或具体筛选原因。</span></span></label><div className="rounded-3xl border border-border p-5"><p className="font-bold">联系方式何时开放</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{([ ["mutualInterest", "双方都想认识后", "隐私优先（默认）"], ["immediate", "匹配揭晓后立即", "适合现场活动"] ] as const).map(([value, label, descriptionValue]) => <button key={value} type="button" onClick={() => setContactReleasePolicy(value)} className={cx("min-h-20 rounded-2xl border p-4 text-left", contactReleasePolicy === value ? "border-primary bg-orange-50" : "border-border")}><strong className="text-sm">{label}</strong><span className="mt-1 block text-xs text-muted-foreground">{descriptionValue}</span></button>)}</div></div></div></div> : null}

        {step === 5 ? <div><h2 className="text-2xl font-bold">确认并发布</h2><div className={cx("mt-6 rounded-3xl bg-gradient-to-br p-6", TONE_CLASS.coral)}><Pill tone={visibility === "public" ? "green" : "purple"}>{visibility === "public" ? "公开活动" : "私密邀请"}</Pill><h3 className="mt-5 text-2xl font-bold">{name || "未命名活动"}</h3><p className="mt-2 text-sm opacity-70">{summary || "还没有填写一句话介绍"}</p><div className="mt-5 flex flex-wrap gap-2"><Pill>{formatDate(zonedLocalToUtc(startsAt, timeZone), timeZone)}</Pill><Pill>{participantLimit} 人上限</Pill><Pill tone="purple">{matchingMode === "profileAndQuestionnaire" ? "价值观匹配" : "资料相似度"}</Pill></div></div><div className="mt-5"><EventPrivacySummary pool={{ resultPolicy: { organizerCanViewPairs, contactReleasePolicy } } as PoolSummary} /></div><div className="mt-5 rounded-2xl bg-amber-50 p-4 text-xs leading-5 text-amber-900">发布后可以继续修改活动说明；第一位参与者确认后，结果权限将不可更改。</div></div> : null}
      </Card>

      <div className="mt-6 flex items-center justify-between"><V2Button variant="secondary" disabled={step === 0} onClick={() => setStep(value => Math.max(0, value - 1))}>上一步</V2Button>{step < CREATE_STEPS.length - 1 ? <V2Button onClick={() => setStep(value => Math.min(CREATE_STEPS.length - 1, value + 1))}>继续<ChevronRight size={17} /></V2Button> : <V2Button disabled={saving} onClick={publish}>{saving ? "发布中…" : "确认发布活动"}</V2Button>}</div>
    </div>
  );
}

export function EventRegistrationPage({ questionnaireComplete }: { questionnaireComplete: boolean }) {
  const { eventId = "" } = useParams();
  const { loading, profile, criteria, service } = useV2();
  const navigate = useNavigate();
  const [pool, setPool] = useState<PoolDetails | null>(null);
  const [loadError, setLoadError] = useState("");
  const [answers, setAnswers] = useState<PoolMembership["registrationAnswers"]>({});
  const [criteriaMode, setCriteriaMode] = useState<"inherit" | "custom">("inherit");
  const [targetGender, setTargetGender] = useState(criteria?.targetGender ?? "female");
  const [ageRange, setAgeRange] = useState(criteria?.ageRange ?? { min: 18, max: 99 });
  const [optionalOverride, setOptionalOverride] = useState<MatchCriteria["optional"]>(criteria?.optional ?? {});
  const [contact, setContact] = useState<"email" | "wechat" | "instagram">("email");
  const [joinCode, setJoinCode] = useState("");
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPool(null);
    setLoadError("");
    service.getPool(eventId).then(nextPool => {
      if (cancelled) return;
      setPool(nextPool);
      const membership = nextPool.myMembership;
      if (membership) setCriteriaMode(membership.criteriaMode);
      if (membership?.criteriaOverride) {
        setTargetGender(membership.criteriaOverride.targetGender);
        setAgeRange(membership.criteriaOverride.ageRange);
        setOptionalOverride(membership.criteriaOverride.optional);
      }
      setAnswers(membership?.registrationAnswers ?? {});
      const savedContact = membership?.sharedContactTypes.find(channel => channel === "email" || channel === "wechat" || channel === "instagram");
      if (savedContact) setContact(savedContact);
      if (membership?.consentedAt) setConsent(true);
    }).catch(error => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : "活动不存在");
    });
    return () => { cancelled = true; };
  }, [eventId, service]);
  useEffect(() => { if (criteria) { setTargetGender(criteria.targetGender); setAgeRange(criteria.ageRange); setOptionalOverride(criteria.optional); } }, [criteria]);
  if (loadError) return <EmptyState icon={<CircleHelp size={26} />} title="无法打开报名表" description={loadError} action={<V2Button onClick={() => navigate("/events")}>返回活动广场</V2Button>} />;
  if (!loading && (!profile || !criteria)) return <EmptyState icon={<UserRound size={26} />} title="匹配资料还没准备好" description="请先完成基础资料和匹配条件，再回来报名活动。" action={<V2Button onClick={() => navigate(`/profile?returnTo=${encodeURIComponent(`/events/${eventId}/register`)}`)}>完善匹配资料</V2Button>} />;
  if (!pool || !profile || !criteria) return <div className="py-20 text-center text-sm text-muted-foreground">正在准备报名表…</div>;

  const questionnaireBlocked = pool.matchingMode === "profileAndQuestionnaire" && !questionnaireComplete;
  const toggleOptionalOverride = (fieldId: OptionalProfileFieldId) => {
    const field = filterableProfileFields.find(item => item.id === fieldId);
    if (!field) return;
    setOptionalOverride(current => {
      const next = { ...current };
      if (next[fieldId]) delete next[fieldId];
      else if (field.filterKind === "range") next[fieldId] = { kind: "range" };
      else if (field.filterKind === "contains_any") next[fieldId] = { kind: "contains_any", values: [] };
      else next[fieldId] = { kind: "one_of", values: [] };
      return next;
    });
  };
  const updateOptionalOverride = (fieldId: OptionalProfileFieldId, rule: HardFilterRule) => setOptionalOverride(current => ({ ...current, [fieldId]: rule }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (questionnaireBlocked) return toast.error("请先完成价值观问卷");
    if (!consent) return toast.error("请确认已了解本场活动的数据与结果规则");
    if (pool.customQuestions.some(question => question.required && !valueIsFilled(answers[question.id]))) return toast.error("请完成所有必填活动问题");
    setSaving(true);
    try {
      const customCriteria: MatchCriteria | undefined = criteriaMode === "custom" ? { ...criteria, targetGender, ageRange, optional: optionalOverride, updatedAt: new Date().toISOString() } : undefined;
      await service.joinPool(pool.id, { joinCode: joinCode || undefined });
      await service.savePoolRegistration(pool.id, { ...answers, contactChannel: contact });
      await service.setPoolCriteria(pool.id, criteriaMode, customCriteria);
      await service.confirmPoolParticipation(pool.id);
      toast.success("报名已确认");
      navigate(`/events/${pool.id}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "报名失败，请重试"); }
    finally { setSaving(false); }
  };

  return (
    <div className="mx-auto max-w-4xl"><button type="button" onClick={() => navigate(eventPath(pool))} className="mb-4 flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground"><ArrowLeft size={17} />返回活动</button><PageHeading eyebrow="活动报名" title={pool.name} description="确认本场使用的资料、必要条件和结果权限。活动条件不会修改你的全局设置。" />
      <form onSubmit={submit} className="space-y-6">
        <Card className="p-5 sm:p-7"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">1. 匹配资格</h2><p className="mt-1 text-sm text-muted-foreground">基础资料已完成；本场还会检查主办方要求的资料。</p></div><Pill tone="green">资料可用</Pill></div>{pool.visibility === "invite_only" && !pool.myMembership ? <div className="mt-5 max-w-sm"><FormField label="活动邀请码"><TextInput value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())} placeholder="例如 CG-HELLO" /></FormField></div> : null}<div className="mt-5 flex flex-wrap gap-2">{pool.requiredFieldIds.map(id => <Pill key={id}>{profileFieldById[id]?.label ?? id}</Pill>)}</div>{questionnaireBlocked ? <div className="mt-5 rounded-2xl bg-amber-50 p-4"><p className="text-sm font-bold text-amber-900">本场要求完成价值观问卷</p><p className="mt-1 text-xs leading-5 text-amber-800">完成 24 题后再回来确认报名，已有活动答案会保留。</p><V2Button type="button" variant="secondary" className="mt-3" onClick={() => navigate("/questionnaire")}>去完成问卷</V2Button></div> : pool.matchingMode === "profileAndQuestionnaire" ? <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 size={17} />价值观问卷已完成</p> : null}</Card>
        <Card className="p-5 sm:p-7">
          <h2 className="text-xl font-bold">2. 本场必要条件</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" aria-pressed={criteriaMode === "inherit"} onClick={() => setCriteriaMode("inherit")} className={cx("rounded-2xl border p-4 text-left", criteriaMode === "inherit" ? "border-primary bg-orange-50" : "border-border")}><p className="font-bold">沿用全局设置</p><p className="mt-1 text-xs text-muted-foreground">目标 {criteria.targetGender === "male" ? "男性" : "女性"} · {criteria.ageRange.min}–{criteria.ageRange.max} 岁 · {Object.keys(criteria.optional).length} 项选填条件</p></button>
            <button type="button" aria-pressed={criteriaMode === "custom"} onClick={() => setCriteriaMode("custom")} className={cx("rounded-2xl border p-4 text-left", criteriaMode === "custom" ? "border-primary bg-orange-50" : "border-border")}><p className="font-bold">为本场单独调整</p><p className="mt-1 text-xs text-muted-foreground">只影响本次活动，不改全局资料。</p></button>
          </div>
          {criteriaMode === "custom" ? (
            <div className="mt-4 rounded-2xl bg-muted/35 p-4 sm:p-5">
              <div className="grid gap-4 md:grid-cols-3">
                <FormField label="本场目标性别" hint={profile.orientation === "bisexual" ? "双性恋在每场活动只能选择一个目标性别。" : "由性取向自动确定。"}><NativeSelect value={targetGender} disabled={profile.orientation !== "bisexual"} onChange={event => setTargetGender(event.target.value as MatchCriteria["targetGender"])}><option value="male">男</option><option value="female">女</option><option disabled>其他性别（Coming soon）</option></NativeSelect></FormField>
                <FormField label="最低年龄"><TextInput type="number" min={18} max={99} value={ageRange.min} onChange={event => setAgeRange(current => ({ ...current, min: Number(event.target.value) }))} /></FormField>
                <FormField label="最高年龄"><TextInput type="number" min={18} max={99} value={ageRange.max} onChange={event => setAgeRange(current => ({ ...current, max: Number(event.target.value) }))} /></FormField>
              </div>
              <div className="mt-6 border-t border-border pt-5"><div className="flex items-center justify-between gap-3"><div><h3 className="font-bold">选填必要条件</h3><p className="mt-1 text-xs text-muted-foreground">本场已启用 {Object.keys(optionalOverride).length} 项；未填写的信息不会由系统猜测。</p></div><Pill>{Object.keys(optionalOverride).length ? "已单独调整" : "保持弹性"}</Pill></div>
                <div className="mt-4 max-h-[30rem] space-y-3 overflow-y-auto pr-1">
                  {filterableProfileFields.map(field => {
                    const rule = optionalOverride[field.id];
                    return <div key={field.id} className="rounded-2xl border border-border bg-card p-3"><button type="button" onClick={() => toggleOptionalOverride(field.id)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left"><span className="text-sm font-semibold">{field.label}</span><Pill tone={rule ? "orange" : "neutral"}>{rule ? "必须" : "不限"}</Pill></button>{rule ? <div className="mt-3 border-t border-border pt-3">{rule.kind === "range" ? <div className="grid grid-cols-2 gap-2"><TextInput aria-label={`${field.label}最低值`} type="number" min={field.min} max={field.max} placeholder="最低" value={rule.min ?? ""} onChange={event => updateOptionalOverride(field.id, { ...rule, min: event.target.value ? Number(event.target.value) : undefined })} /><TextInput aria-label={`${field.label}最高值`} type="number" min={field.min} max={field.max} placeholder="最高" value={rule.max ?? ""} onChange={event => updateOptionalOverride(field.id, { ...rule, max: event.target.value ? Number(event.target.value) : undefined })} /></div> : field.options?.length ? <div className="flex flex-wrap gap-2">{field.options.map(option => { const selected = "values" in rule && rule.values.includes(option.value); const values = "values" in rule ? rule.values : []; return <button key={option.value} type="button" onClick={() => updateOptionalOverride(field.id, { kind: rule.kind === "contains_any" ? "contains_any" : "one_of", values: selected ? values.filter(value => value !== option.value) : [...values, option.value] })} className={cx("min-h-11 rounded-xl border px-3 text-xs font-semibold", selected ? "border-primary bg-primary text-white" : "border-border")}>{option.label}</button>; })}</div> : <TextInput aria-label={`${field.label}可接受值`} placeholder="多个值用逗号分隔" value={"values" in rule ? rule.values.join(", ") : ""} onChange={event => updateOptionalOverride(field.id, { kind: "one_of", values: event.target.value.split(",").map(value => value.trim()).filter(Boolean) })} />}</div> : null}</div>;
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </Card>
        {pool.customQuestions.length ? <Card className="p-5 sm:p-7"><h2 className="text-xl font-bold">3. 活动问题</h2><p className="mt-1 text-sm text-muted-foreground">答案仅供主办方筹备活动，不参与匹配算法。</p><div className="mt-5 space-y-5">{pool.customQuestions.map(question => <FormField key={question.id} label={question.label} optional={!question.required}><RegistrationQuestionInput question={question} value={answers[question.id]} onChange={value => setAnswers(current => ({ ...current, [question.id]: value }))} /></FormField>)}</div></Card> : null}
        <Card className="p-5 sm:p-7"><h2 className="text-xl font-bold">4. 联系方式与同意</h2><div className="mt-4 grid gap-3 sm:grid-cols-3">{([ ["email", `邮箱 · ${profile.contacts.email}`], ["wechat", profile.contacts.wechat ? `微信 · ${profile.contacts.wechat}` : "微信 · 未填写"], ["instagram", profile.contacts.instagram ? `Instagram · ${profile.contacts.instagram}` : "Instagram · 未填写"] ] as const).map(([value, label]) => <button key={value} type="button" disabled={value !== "email" && !profile.contacts[value]} onClick={() => setContact(value)} className={cx("min-h-16 rounded-2xl border p-3 text-left text-xs font-semibold disabled:opacity-40", contact === value ? "border-primary bg-orange-50" : "border-border")}>{contact === value ? <Check size={14} className="mr-1 inline text-primary" /> : null}{label}</button>)}</div><div className="mt-5"><EventPrivacySummary pool={pool} /></div><label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl bg-muted/40 p-4"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-1 h-5 w-5 accent-primary" /><span className="text-sm leading-6">我已了解本场活动的资料用途、主办方可见范围和联系方式开放规则，并同意将当前资料快照用于本次匹配。</span></label></Card>
        <div className="flex justify-end"><V2Button type="submit" disabled={saving || questionnaireBlocked}>{saving ? "确认中…" : "确认报名"}</V2Button></div>
      </form>
    </div>
  );
}

function valueIsFilled(value: unknown) { return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0); }

function formatQuestionAnswer(question: CustomQuestion, value: unknown) {
  if (value === true) return "是";
  if (value === false) return "否";
  const optionLabel = (id: string) => question.options?.find(option => option.id === id)?.label ?? id;
  if (Array.isArray(value)) return value.map(item => optionLabel(String(item))).join("、");
  return valueIsFilled(value) ? optionLabel(String(value)) : "未填写";
}

export function EventManagePage() {
  const { eventId = "" } = useParams();
  const { profile, service } = useV2();
  const navigate = useNavigate();
  const [pool, setPool] = useState<PoolDetails | null>(null);
  const [loadError, setLoadError] = useState("");
  const [runReport, setRunReport] = useState<OrganizerRunReport | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const nextPool = await service.getPool(eventId);
      setPool(nextPool);
      if (nextPool.latestRun && nextPool.status === "revealed") {
        setRunReport(await service.getOrganizerRunReport(nextPool.latestRun.id));
      } else {
        setRunReport(null);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "活动不存在或你没有管理权限");
    }
  }, [eventId, service]);
  useEffect(() => { void load(); }, [load]);
  if (loadError) return <EmptyState icon={<CircleHelp size={26} />} title="无法打开主办方控制台" description={loadError} action={<V2Button onClick={() => navigate("/events")}>返回活动广场</V2Button>} />;
  if (!pool) return <div className="py-20 text-center text-sm text-muted-foreground">正在加载主办方控制台…</div>;
  if (pool.organizerId !== profile?.id) return <EmptyState icon={<ShieldCheck size={26} />} title="只有主办方可以管理" description="你可以返回活动详情查看公开信息。" action={<V2Button onClick={() => navigate(eventPath(pool))}>返回活动</V2Button>} />;

  const participantMembers = pool.members.filter(member => member.participatesInMatching);
  const confirmed = participantMembers.filter(member => member.status === "confirmed");
  const eligibleCount = confirmed.length;
  const projectedPairs = Math.floor(eligibleCount / 2);
  const profileCompletionRate = participantMembers.length ? Math.round((confirmed.length / participantMembers.length) * 100) : 0;
  const questionnaireCompletion = pool.matchingMode === "profileAndQuestionnaire" ? `${profileCompletionRate}%` : "不要求";

  const runMatching = async () => {
    setRunning(true);
    try {
      await service.closePoolRegistration(pool.id);
      const run = await service.runPoolMatching(pool.id);
      await service.revealMatchRun(run.id);
      toast.success("本场匹配已经揭晓");
      setShowConfirm(false);
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "匹配运行失败"); }
    finally { setRunning(false); }
  };

  return (
    <div className="mx-auto max-w-6xl"><button type="button" onClick={() => navigate(eventPath(pool))} className="mb-4 flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground"><ArrowLeft size={17} />查看活动详情</button><PageHeading eyebrow="主办方控制台" title={pool.name} description="只展示筹备活动所需的信息。参与者标准资料与具体筛选原因不会向主办方开放。" action={<Pill tone={pool.status === "revealed" ? "green" : "orange"}>{STATUS_LABELS[pool.status]}</Pill>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[ { label: "报名人数", value: participantMembers.length, Icon: UsersRound }, { label: "资料完成率", value: `${profileCompletionRate}%`, Icon: CheckCircle2 }, { label: "问卷完成率", value: questionnaireCompletion, Icon: CircleHelp }, { label: "可进入匹配", value: eligibleCount, Icon: HeartHandshake } ].map(({ label, value, Icon }) => <Card key={label} className="p-5"><Icon size={20} className="text-primary" /><p className="mt-4 text-3xl font-bold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></Card>)}</div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="overflow-hidden"><div className="border-b border-border p-5 sm:p-6"><h2 className="text-xl font-bold">报名与完成情况</h2><p className="mt-1 text-sm text-muted-foreground">具体标准资料不会显示；活动自定义题答案仅用于主办方筹备。</p></div><div className="divide-y divide-border">{participantMembers.map((member, index) => <div key={member.id} className="p-5"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-bold">{index + 1}</span><div><p className="text-sm font-bold">参与者 {String(index + 1).padStart(2, "0")}</p><p className="text-xs text-muted-foreground">{Object.keys(member.registrationAnswers).length}/{pool.customQuestions.length + 1} 项活动信息</p></div></div><Pill tone={member.status === "confirmed" ? "green" : "amber"}>{member.status === "confirmed" ? "已确认" : "未完成"}</Pill></div>{pool.customQuestions.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{pool.customQuestions.map(question => <div key={question.id} className="rounded-xl bg-muted/35 px-3 py-2"><p className="text-[11px] text-muted-foreground">{question.label}</p><p className="mt-0.5 text-xs font-semibold">{formatQuestionAnswer(question, member.registrationAnswers[question.id])}</p></div>)}</div> : null}</div>)}{!participantMembers.length ? <p className="p-8 text-center text-sm text-muted-foreground">还没有人报名</p> : null}</div></Card>
        <div className="space-y-6"><Card className="p-5 sm:p-6"><div className="flex items-center gap-2"><Zap size={20} className="text-primary" /><h2 className="text-xl font-bold">手动运行匹配</h2></div>{pool.status === "revealed" ? <><p className="mt-3 text-sm leading-6 text-muted-foreground">这场活动已经完成一次匹配。已发布结果不会被覆盖。</p><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-emerald-50 p-4"><p className="text-2xl font-bold text-emerald-800">{runReport?.matchedPairCount ?? pool.latestRun?.matchIds.length ?? 0}</p><p className="text-xs text-emerald-700">成功配对</p></div><div className="rounded-2xl bg-muted/40 p-4"><p className="text-2xl font-bold">{runReport?.unmatchedCount ?? pool.latestRun?.unmatchedUserIds.length ?? 0}</p><p className="text-xs text-muted-foreground">本轮未匹配</p></div></div>{pool.resultPolicy.organizerCanViewPairs && runReport?.pairs ? <div className="mt-4 space-y-2">{runReport.pairs.map((pair, index) => <div key={pair.matchId} className="rounded-xl bg-muted/40 px-3 py-2 text-xs font-semibold">配对 {String(index + 1).padStart(2, "0")} · {pair.displayNames[0]} × {pair.displayNames[1]}</div>)}</div> : null}</> : <><p className="mt-3 text-sm leading-6 text-muted-foreground">点击后会立即关闭匹配报名，并锁定当前合格参与者快照。每场活动只发布一轮结果。</p><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-muted/40 p-4"><p className="text-2xl font-bold">{eligibleCount}</p><p className="text-xs text-muted-foreground">预计进入快照</p></div><div className="rounded-2xl bg-muted/40 p-4"><p className="text-2xl font-bold">{projectedPairs}</p><p className="text-xs text-muted-foreground">理论最多配对</p></div></div><V2Button className="mt-5 w-full" disabled={eligibleCount < 2} onClick={() => setShowConfirm(true)}>结束报名并立即匹配</V2Button></>}</Card><Card className="p-5 sm:p-6"><h2 className="font-bold">本场隐私规则</h2><div className="mt-4"><EventPrivacySummary pool={pool} /></div><p className="mt-3 text-xs text-muted-foreground">首位参与者确认后不可更改。</p></Card></div>
      </div>
      {showConfirm ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="run-match-title" onKeyDown={event => { if (event.key === "Escape" && !running) setShowConfirm(false); }}><Card className="w-full max-w-lg p-6 sm:p-7"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-primary"><Zap size={22} /></div><h2 id="run-match-title" className="mt-5 text-2xl font-bold">确认结束报名并运行？</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">系统将冻结 {eligibleCount} 位已确认参与者，预计最多形成 {projectedPairs} 对。未完成资料的人不会进入本轮，结果发布后不能重跑或覆盖。</p><div className="mt-6 flex gap-3"><V2Button autoFocus variant="secondary" className="flex-1" onClick={() => setShowConfirm(false)}>继续等待</V2Button><V2Button className="flex-1" disabled={running} onClick={runMatching}>{running ? "匹配中…" : "确认运行"}</V2Button></div></Card></div> : null}
    </div>
  );
}
