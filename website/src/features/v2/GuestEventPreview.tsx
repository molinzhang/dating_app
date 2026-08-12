import { useEffect, useState } from "react";
import { CalendarDays, Heart, LockKeyhole, MapPin, ShieldCheck, UsersRound } from "lucide-react";
import type { PoolDetails } from "./domain";
import { datingService } from "./service";
import { Card, Pill, V2Button } from "./ui";

export function GuestEventPreview({ eventId, onLogin, onRegister }: { eventId: string; onLogin: () => void; onRegister: () => void }) {
  const [pool, setPool] = useState<PoolDetails | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    datingService.getPool(eventId).then(setPool).catch(() => setFailed(true));
  }, [eventId]);

  if (failed) return <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">这个活动不存在，或邀请链接已经失效。</div>;
  if (!pool) return <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">正在打开活动邀请…</div>;

  const location = pool.location?.mode === "online" ? "线上活动" : [pool.location?.city, pool.location?.venue].filter(Boolean).join(" · ") || "地点待定";
  const dateLabel = pool.startsAt ? new Intl.DateTimeFormat("zh-CN", { timeZone: pool.timeZone, month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(pool.startsAt)) : "时间待定";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card"><div className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6"><span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary text-white"><Heart size={18} fill="currentColor" /></span><span className="ml-2 font-display text-lg font-bold">Common Ground</span><div className="ml-auto"><Pill tone="purple">活动邀请</Pill></div></div></header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="rounded-[2rem] bg-gradient-to-br from-orange-100 via-white to-violet-100 p-6 sm:p-10">
          <div className="flex flex-wrap gap-2"><Pill tone={pool.visibility === "public" ? "green" : "purple"}>{pool.visibility === "public" ? "公开活动" : "凭邀请参加"}</Pill><Pill>{pool.matchingMode === "profileAndQuestionnaire" ? "价值观匹配" : "资料相似度"}</Pill></div>
          <h1 className="mt-6 max-w-3xl text-3xl font-bold sm:text-5xl">{pool.name}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{pool.summary}</p>
          <div className="mt-7 flex flex-wrap gap-4 text-sm font-semibold"><span className="flex items-center gap-2"><CalendarDays size={18} />{dateLabel} · {pool.timeZone}</span><span className="flex items-center gap-2"><MapPin size={18} />{location}</span><span className="flex items-center gap-2"><UsersRound size={18} />{pool.confirmedCount}/{pool.participantLimit ?? "不限"} 人</span></div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
          <Card className="p-6 sm:p-8"><h2 className="text-xl font-bold">关于这场活动</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-muted-foreground">{pool.description || pool.summary}</p><div className="mt-6 rounded-2xl bg-muted/40 p-4 text-sm leading-6"><ShieldCheck size={18} className="mr-2 inline text-emerald-700" />报名后，你可以为本场单独确认必要条件和联系方式规则；这些设置不会改写全局资料。</div></Card>
          <Card className="p-6"><div className="flex items-center gap-2"><LockKeyhole size={19} className="text-primary" /><h2 className="text-lg font-bold">登录后继续报名</h2></div><p className="mt-3 text-sm leading-6 text-muted-foreground">登录或建立账号后，我们会带你回到这个邀请链接，再补齐资料和活动问题。</p><div className="mt-5 grid gap-3"><V2Button onClick={onLogin}>登录并继续</V2Button><V2Button variant="secondary" onClick={onRegister}>建立账号</V2Button></div></Card>
        </div>
      </main>
    </div>
  );
}
