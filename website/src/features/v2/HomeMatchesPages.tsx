import { useEffect, useState } from "react";
import {
  ArrowRight, CalendarDays, Check, CheckCircle2, Clock3, Copy, Heart,
  History, Info, LockKeyhole, MessageCircleHeart, Settings2, ShieldCheck,
  Sparkles, UserRound, UsersRound, Zap,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import type { MatchView } from "./domain";
import { profileFieldById } from "./field-config";
import { useV2 } from "./useV2";
import { Card, cx, EmptyState, LinkButton, PageHeading, Pill, V2Button } from "./ui";

export interface LegacyWeeklyMatch {
  id: string;
  matchedUser: { displayName: string; email?: string; photoUrl?: string };
  compatibilitySummary: string;
  recommendationDate: string;
  nextRefreshDate: string;
  responseStatus: "unseen" | "viewed" | "interested" | "skipped";
}

export interface HomeBridgeProps {
  weeklyStatus: "active" | "inactive";
  questionnaireStatus: "not_started" | "in_progress" | "completed";
  weeklyMatch: LegacyWeeklyMatch | null;
  nextRefreshDate?: string | null;
  onWeeklyToggle: () => void;
}

export function HomePage({ weeklyStatus, questionnaireStatus, weeklyMatch, nextRefreshDate, onWeeklyToggle }: HomeBridgeProps) {
  const { profile, criteria, pools, matches } = useV2();
  const navigate = useNavigate();
  if (!profile || !criteria) return null;

  const optionalCount = Object.values(profile.details).filter(value => value !== undefined && value !== "" && (!Array.isArray(value) || value.length)).length;
  const activeCriteria = Object.keys(criteria.optional).length;
  const joinedEvents = pools.filter(pool => pool.myMembership?.participatesInMatching && pool.myMembership.status !== "withdrawn");
  const profileReady = Boolean(profile.legalName && profile.displayName && profile.birthDate);

  return (
    <div>
      <PageHeading eyebrow="首页" title={`你好，${profile.displayName}`} description="每周匹配与活动匹配彼此独立，你可以按自己的节奏参加。" action={<button type="button" onClick={onWeeklyToggle} className={cx("flex min-h-11 items-center gap-3 rounded-2xl border px-3.5 text-sm font-bold", weeklyStatus === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-card text-muted-foreground")}><span className={cx("h-2.5 w-2.5 rounded-full", weeklyStatus === "active" ? "bg-emerald-500" : "bg-muted-foreground")} />每周匹配{weeklyStatus === "active" ? "已开启" : "已暂停"}</button>} />

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-[#fff0e8] via-white to-[#f2edff] p-6 sm:p-8">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div><div className="mb-3 flex items-center gap-2"><Pill tone={profileReady ? "green" : "amber"}>{profileReady ? "基础资料已完成" : "需要补齐资料"}</Pill><Pill>{optionalCount} 项选填资料</Pill></div><h2 className="text-2xl font-bold">你的匹配资料</h2><p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">当前寻找{criteria.targetGender === "male" ? "男性" : "女性"}，年龄 {criteria.ageRange.min}–{criteria.ageRange.max} 岁，启用 {activeCriteria} 项选填必要条件。</p></div>
                <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[2rem] bg-card shadow-sm"><div className="text-center"><p className="text-3xl font-bold text-primary">{Math.min(100, 55 + optionalCount * 4)}%</p><p className="text-[10px] text-muted-foreground">资料完整度</p></div></div>
              </div>
              <div className="mt-6 flex flex-wrap gap-3"><V2Button onClick={() => navigate("/profile")}><UserRound size={17} />完善资料</V2Button><V2Button variant="secondary" onClick={() => navigate("/profile?tab=criteria")}><Settings2 size={17} />调整必要条件</V2Button></div>
            </div>
          </Card>

          <Card className="p-6 sm:p-8">
            <div className="flex items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">每周匹配</p><h2 className="mt-2 text-2xl font-bold">{weeklyMatch ? "本周推荐已经准备好" : questionnaireStatus === "completed" ? "下一次推荐正在准备中" : "先完成价值观问卷"}</h2></div><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700"><Heart size={22} /></div></div>
            {weeklyMatch ? <div className="mt-6 flex flex-col gap-5 rounded-3xl bg-blue-50/55 p-5 sm:flex-row sm:items-center"><div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-xl font-bold text-white">{weeklyMatch.matchedUser.displayName.slice(0, 1)}</div><div className="flex-1"><p className="text-lg font-bold">{weeklyMatch.matchedUser.displayName}</p><p className="mt-1 text-sm text-muted-foreground">{weeklyMatch.compatibilitySummary}</p></div><V2Button onClick={() => navigate("/matches/current")}>查看推荐<ArrowRight size={16} /></V2Button></div> : questionnaireStatus !== "completed" ? <div className="mt-5 rounded-2xl bg-muted/40 p-5"><p className="text-sm leading-6 text-muted-foreground">24 道价值观问题会成为每周推荐的排序依据，也可以用于主办方选择的活动匹配。</p><V2Button className="mt-4" onClick={() => navigate("/questionnaire")}>{questionnaireStatus === "in_progress" ? "继续问卷" : "开始问卷"}<ArrowRight size={16} /></V2Button></div> : <div className="mt-5 flex items-start gap-3 rounded-2xl bg-muted/40 p-5"><Clock3 size={20} className="mt-0.5 text-muted-foreground" /><div><p className="font-bold">保持期待，也允许等待</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{nextRefreshDate ? `下一轮预计在 ${nextRefreshDate} 更新。` : "推荐会在下一轮统一更新。"}系统不会越过任何一方标记为必要的条件。</p></div></div>}
          </Card>

          <Card className="p-6 sm:p-8">
            <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">最近活动</p><h2 className="mt-2 text-2xl font-bold">借共同场合认识彼此</h2></div><LinkButton onClick={() => navigate("/events")}>查看全部</LinkButton></div>
            {joinedEvents.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2">{joinedEvents.slice(0, 2).map(pool => <button key={pool.id} type="button" onClick={() => navigate(`/events/${pool.slug}`)} className="rounded-2xl border border-border p-4 text-left hover:bg-muted/35"><div className="flex items-center justify-between"><Pill tone="blue">{pool.status === "revealed" ? "已匹配" : "已报名"}</Pill><span className="text-xs text-muted-foreground">{pool.confirmedCount} 人</span></div><h3 className="mt-3 font-bold">{pool.name}</h3><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{pool.summary}</p></button>)}</div> : <div className="mt-5 rounded-2xl border border-dashed border-border p-6 text-center"><CalendarDays size={23} className="mx-auto text-muted-foreground" /><p className="mt-3 text-sm text-muted-foreground">你还没有参加活动</p><V2Button className="mt-4" variant="secondary" onClick={() => navigate("/events")}>发现活动</V2Button></div>}
          </Card>
        </div>

        <aside className="space-y-6">
          <Card className="p-6"><h2 className="text-lg font-bold">现在可以做什么</h2><div className="mt-4 space-y-3">{[ { done: profileReady, label: "完成基础匹配资料", path: "/profile" }, { done: questionnaireStatus === "completed", label: "完成价值观问卷", path: "/questionnaire" }, { done: joinedEvents.length > 0, label: "报名一场线下活动", path: "/events" } ].map(item => <button key={item.label} type="button" onClick={() => navigate(item.path)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-muted/35 p-3 text-left hover:bg-muted/60"><span className={cx("flex h-8 w-8 items-center justify-center rounded-full", item.done ? "bg-emerald-100 text-emerald-700" : "bg-card text-muted-foreground")}>{item.done ? <Check size={16} /> : <ArrowRight size={16} />}</span><span className="flex-1 text-sm font-semibold">{item.label}</span>{item.done ? <Pill tone="green">完成</Pill> : null}</button>)}</div></Card>
          <Card className="p-6"><div className="flex items-center gap-2"><ShieldCheck size={19} className="text-emerald-700" /><h2 className="font-bold">你的选择有明确边界</h2></div><p className="mt-3 text-sm leading-6 text-muted-foreground">所有必要条件都会双向执行。资料只按你的可见性设置展示；主办方不会看到具体筛选原因。</p></Card>
          {matches.length ? <Card className="p-6"><div className="flex items-center justify-between"><h2 className="font-bold">活动匹配结果</h2><Pill tone="purple">{matches.length}</Pill></div><p className="mt-2 text-sm leading-6 text-muted-foreground">你有来自活动的匹配结果，可以在匹配中心统一查看。</p><V2Button className="mt-4 w-full" variant="secondary" onClick={() => navigate("/matches")}>打开匹配中心</V2Button></Card> : null}
        </aside>
      </div>
    </div>
  );
}

export function MatchesPage({ weeklyMatch }: { weeklyMatch: LegacyWeeklyMatch | null }) {
  const { matches, pools } = useV2();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"all" | "weekly" | "events">("all");
  const showWeekly = tab !== "events";
  const showEvents = tab !== "weekly";
  const unmatchedPools = pools.filter(pool =>
    pool.status === "revealed" &&
    pool.myMembership?.participatesInMatching &&
    Boolean(pool.latestRun?.unmatchedUserIds.includes(pool.myMembership.userId)),
  );
  const hasVisibleResults = (showWeekly && Boolean(weeklyMatch)) || (showEvents && (matches.length > 0 || unmatchedPools.length > 0));

  return (
    <div><PageHeading eyebrow="匹配中心" title="每一次推荐，都有清楚的来源" description="在这里统一查看每周推荐与不同活动的独立结果。感兴趣、跳过和联系方式权限都只属于当前匹配。" />
      <div className="mb-6 flex gap-2 overflow-x-auto pb-1">{([ ["all", "全部"], ["weekly", "每周匹配"], ["events", "活动匹配"] ] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={cx("min-h-11 shrink-0 rounded-2xl px-4 text-sm font-bold", tab === id ? "bg-foreground text-background" : "border border-border bg-card text-muted-foreground")}>{label}</button>)}</div>
      <div className="space-y-4">
        {showWeekly && weeklyMatch ? <Card className="p-5 sm:p-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-center"><div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-2xl font-bold text-white">{weeklyMatch.matchedUser.displayName.slice(0, 1)}</div><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><Pill tone="blue">每周匹配</Pill><Pill>{weeklyMatch.recommendationDate}</Pill></div><h2 className="mt-3 text-xl font-bold">{weeklyMatch.matchedUser.displayName}</h2><p className="mt-1 text-sm text-muted-foreground">{weeklyMatch.compatibilitySummary}</p></div><V2Button onClick={() => navigate("/matches/current")}>查看详情<ArrowRight size={16} /></V2Button></div></Card> : null}
        {showEvents ? matches.map(match => <Card key={match.id} className="p-5 sm:p-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-center"><div className="relative"><div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-300 to-rose-400 text-2xl font-bold text-white">{match.partner.displayName.slice(0, 1)}</div><span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-violet-600 text-white"><CalendarDays size={13} /></span></div><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><Pill tone="purple">{match.pool.name}</Pill><Pill tone={match.contactsUnlocked ? "green" : "neutral"}>{match.contactsUnlocked ? "联系方式已开放" : "等待双方回应"}</Pill></div><h2 className="mt-3 text-xl font-bold">{match.partner.displayName} · {match.partner.age} 岁</h2><p className="mt-1 text-sm text-muted-foreground">{match.compatibilitySummary}</p></div><V2Button onClick={() => navigate(`/matches/${match.id}`)}>查看详情<ArrowRight size={16} /></V2Button></div></Card>) : null}
        {showEvents ? unmatchedPools.map(pool => <Card key={`${pool.id}-unmatched`} className="p-5 sm:p-6"><div className="flex items-start gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><CalendarDays size={21} /></div><div><div className="flex flex-wrap items-center gap-2"><Pill tone="purple">{pool.name}</Pill><Pill>本轮未匹配</Pill></div><h2 className="mt-3 text-lg font-bold">这一次先把期待留到下一场</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">这一轮还没有找到同时符合双方必要条件的人。你的选择没有对错，可以保留，也可以在下一场活动中调整。</p></div></div></Card>) : null}
        {!hasVisibleResults ? <EmptyState icon={<Heart size={26} />} title={tab === "weekly" ? "本周还没有新的推荐" : tab === "events" ? "还没有活动匹配结果" : "新的结果还在路上"} description={tab === "weekly" ? "每周推荐会按固定节奏更新，系统不会为了填满列表而越过任何一方的必要条件。" : tab === "events" ? "报名活动并等待主办方结束报名、发布本轮结果后，匹配会出现在这里。" : "完成匹配资料与价值观问卷，或报名一场活动。系统只会推荐双方都愿意认识的人。"} action={tab === "weekly" ? <V2Button variant="secondary" onClick={() => setTab("all")}>查看全部结果</V2Button> : <V2Button onClick={() => navigate("/events")}>发现活动</V2Button>} /> : null}
      </div>
    </div>
  );
}

export function EventMatchDetailPage() {
  const { matchId = "" } = useParams();
  const { loading, matches, service } = useV2();
  const navigate = useNavigate();
  const [selectedMatch, setMatch] = useState<MatchView | null>(() => matches.find(item => item.id === matchId) ?? null);
  const [responding, setResponding] = useState(false);

  useEffect(() => {
    const found = matches.find(item => item.id === matchId);
    if (found) {
      setMatch(found);
      if (found.myResponse === "unseen") service.markMatchViewed(matchId).then(setMatch).catch(() => {});
    }
  }, [matchId, matches, service]);

  const match = selectedMatch?.id === matchId ? selectedMatch : matches.find(item => item.id === matchId) ?? null;
  if (loading && !match) return <div className="py-20 text-center text-sm text-muted-foreground">正在加载匹配详情…</div>;
  if (!match) return <EmptyState icon={<Info size={26} />} title="找不到这条匹配" description="它可能尚未揭晓，或已经不再有效。" action={<V2Button onClick={() => navigate("/matches")}>返回匹配中心</V2Button>} />;

  const respond = async (response: "interested" | "passed") => {
    setResponding(true);
    try { setMatch(await service.respondToMatch(match.id, response)); toast.success(response === "interested" ? "已表达想认识" : "已跳过这次匹配"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "操作失败"); }
    finally { setResponding(false); }
  };

  const visibleDetails = Object.entries(match.partner.details).filter(([, value]) => value !== undefined);
  const sharedContacts = Object.entries(match.partner.contacts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0);
  const contactLabels: Record<string, string> = { email: "邮箱", wechat: "微信", instagram: "Instagram", xiaohongshu: "小红书", linkedin: "LinkedIn" };

  return (
    <div className="mx-auto max-w-5xl"><button type="button" onClick={() => navigate("/matches")} className="mb-4 flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground"><ArrowRight size={17} className="rotate-180" />返回匹配中心</button>
      <div className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#fff0e8] via-white to-[#eee9ff] p-6 text-center sm:p-10"><Pill tone="purple">来自 · {match.pool.name}</Pill><div className="mx-auto mt-7 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-orange-300 to-rose-400 text-4xl font-bold text-white shadow-lg">{match.partner.displayName.slice(0, 1)}</div><h1 tabIndex={-1} className="mt-5 text-3xl font-bold outline-none">{match.partner.displayName} · {match.partner.age} 岁</h1><p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{match.compatibilitySummary}</p><div className="mt-5 inline-flex items-center gap-2 rounded-full bg-card px-4 py-2 text-sm font-bold"><Sparkles size={16} className="text-primary" />匹配参考 {Math.round(match.compatibilityScore)}%</div></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6"><Card className="p-6"><h2 className="text-xl font-bold">可以从这些话题开始</h2><div className="mt-4 space-y-3">{match.conversationStarters.map((starter, index) => <div key={starter} className="flex gap-3 rounded-2xl bg-muted/35 p-4"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card text-xs font-bold text-primary">{index + 1}</span><p className="text-sm leading-6">{starter}</p></div>)}</div></Card>{match.partner.partnerIntro ? <Card className="p-6"><h2 className="text-xl font-bold">希望遇见怎样的人</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{match.partner.partnerIntro}</p><p className="mt-3 text-xs text-muted-foreground">这是一段软性介绍，不代表系统额外添加了筛选条件。</p></Card> : null}<Card className="p-6"><h2 className="text-xl font-bold">{match.partner.displayName} 愿意分享的资料</h2>{visibleDetails.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{visibleDetails.map(([key, value]) => <div key={key} className="rounded-2xl bg-muted/35 p-4"><p className="text-xs text-muted-foreground">{profileFieldById[key as keyof typeof profileFieldById]?.label ?? key}</p><p className="mt-1 text-sm font-bold">{Array.isArray(value) ? value.join("、") : String(value)}</p></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">对方选择只展示基础信息；你们可以在见面时慢慢了解。</p>}</Card></div>
        <aside className="space-y-6"><Card className="p-6"><div className="flex items-center gap-2"><MessageCircleHeart size={20} className="text-primary" /><h2 className="text-xl font-bold">你的回应</h2></div>{match.myResponse === "interested" ? <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"><CheckCircle2 size={17} className="mr-2 inline" />你已表达想认识</div> : match.myResponse === "passed" ? <div className="mt-4 rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">你已跳过这次匹配。</div> : <div className="mt-5 grid gap-3"><V2Button disabled={responding} onClick={() => respond("interested")}><Heart size={17} />我想认识 TA</V2Button><V2Button disabled={responding} variant="secondary" onClick={() => respond("passed")}>这次先跳过</V2Button></div>}{match.contactsUnlocked && sharedContacts.length ? <div className="mt-5 border-t border-border pt-5"><Pill tone="green">联系方式已开放</Pill><div className="mt-3 space-y-2">{sharedContacts.map(([channel, value]) => <button key={channel} type="button" onClick={() => navigator.clipboard.writeText(value).then(() => toast.success(`已复制${contactLabels[channel] ?? "联系方式"}`))} className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-muted/40 px-4 text-left"><span className="text-xs text-muted-foreground">{contactLabels[channel] ?? channel}</span><span className="flex-1 truncate text-sm font-semibold">{value}</span><Copy size={16} /></button>)}</div></div> : <div className="mt-5 flex gap-3 rounded-2xl bg-muted/40 p-4"><LockKeyhole size={18} className="shrink-0 text-muted-foreground" /><p className="text-xs leading-5 text-muted-foreground">{match.pool.resultPolicy.contactReleasePolicy === "immediate" ? "本场会在匹配揭晓后立即开放双方报名时选择的联系方式。" : `本场设置为双方都表达“想认识”后开放联系方式。对方当前状态：${match.partnerSignal === "interested" ? "已感兴趣" : match.partnerSignal === "seen" ? "已查看" : "未查看"}。`}</p></div>}</Card><Card className="p-6"><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-emerald-700" /><h2 className="font-bold">尊重彼此的边界</h2></div><p className="mt-2 text-xs leading-5 text-muted-foreground">匹配是对话的起点，不是任何承诺。请在对方明确同意的范围内联系和见面。</p></Card></aside>
      </div>
    </div>
  );
}
