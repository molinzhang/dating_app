import React, { useState, useEffect, createContext, useContext, useCallback } from "react";
import {
  Eye, EyeOff, Check, ChevronRight, ChevronLeft, Menu, X,
  Copy, Flag, LogOut, CheckCircle, Archive, ArrowRight,
  Clock, AlertTriangle, Sparkles, SkipForward, Lock, Star,
  Heart, RotateCcw, Info, BadgeCheck, Zap, Shield, BookOpen, Camera, Pencil
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { Navigate, useLocation, useNavigate } from "react-router";
import { api, ApiError, getToken, setToken, resolvePhotoUrl } from "../lib/api";
import exampleBoyPhoto from "../../example_boy.webp";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "./components/ui/select";

const V2Experience = React.lazy(() => import("../features/v2/V2Experience").then(module => ({ default: module.V2Experience })));
const GuestEventPreview = React.lazy(() => import("../features/v2/GuestEventPreview").then(module => ({ default: module.GuestEventPreview })));

// ============================================================
// TYPES
// ============================================================

type Route = string;

type MatchPreference =
  | "any"
  | "same"
  | "same_or_neutral"
  | "different"
  | "different_or_neutral";

interface AppUser {
  id: string; displayName: string; email: string; gender: "男" | "女";
  wechat?: string; instagram?: string; xiaohongshu?: string; linkedin?: string;
  status: "active" | "inactive";
  questionnaireStatus: "not_started" | "in_progress" | "completed";
  createdAt: string;
  photoUrl?: string;
  bio?: string;
  matchPreference?: string;
  birthDate?: string;
  /** Derived server-side from birthDate — never stored, so it can't go stale. */
  age?: number | null;
  orientation?: Orientation;
  /** Which gender's pool this account is matched in. */
  seekingGender?: "男" | "女";
  preferredAgeMin?: number | null;
  preferredAgeMax?: number | null;
}

// Same vocabulary as the backend (orientation.py) and V2 (features/v2/orientation.ts).
type Orientation = "straight" | "gay" | "bisexual";

interface RegisterData {
  email: string;
  password: string;
  gender: "男" | "女";
  birthDate: string;
  orientation: Orientation;
  seekingGender: "男" | "女";
  wechat?: string;
  instagram?: string;
  xiaohongshu?: string;
  linkedin?: string;
}

const ORIENTATION_LABELS: Record<Orientation, string> = {
  straight: "异性恋",
  gay: "同性恋",
  bisexual: "双性恋",
};

const oppositeGender = (gender: "男" | "女") => (gender === "男" ? "女" : "男");

/**
 * Only a bisexual user actually chooses; for the others the target gender
 * follows from their own, and letting them pick would just create rows the
 * backend has to reject.
 */
export function resolveSeekingGender(
  orientation: Orientation,
  gender: "男" | "女",
  chosen: "男" | "女" | "",
): "男" | "女" {
  if (orientation === "bisexual") return (chosen || oppositeGender(gender)) as "男" | "女";
  return orientation === "gay" ? gender : oppositeGender(gender);
}

/** Whole years, counting whether this year's birthday has passed. */
export function ageFromBirthDate(birthDate: string, now: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const born = new Date(Date.UTC(year, month - 1, day));
  // Rejects things like 2026-02-30, which Date silently rolls forward.
  if (born.getUTCFullYear() !== year || born.getUTCMonth() !== month - 1 || born.getUTCDate() !== day) {
    return null;
  }
  if (born.getTime() > now.getTime()) return null;
  const hadBirthday =
    now.getUTCMonth() + 1 > month ||
    (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day);
  return now.getUTCFullYear() - year - (hadBirthday ? 0 : 1);
}

const V2_DEMO_MODE = (import.meta as any).env?.VITE_DATING_SERVICE_MODE !== "api";
const V2_DEMO_SESSION_KEY = "cg_v2_demo_session";
const V2_DEMO_USER: AppUser = {
  id: "user-lin-zhixia",
  displayName: "林知夏",
  email: "demo@commonground.local",
  gender: "女",
  status: "active",
  questionnaireStatus: "completed",
  createdAt: "2025-08-11T12:00:00.000Z",
  bio: "喜欢城市散步、独立书店和认真但不紧绷的对话。",
};

interface QuestionnaireResponse {
  id: string; version: number;
  answers: Record<number, number>;
  matchPreferences: Record<number, MatchPreference>;
  importantQuestionIds: number[];
  startedAt: string; completedAt?: string;
  status: "draft" | "current" | "archived";
  currentSection: number;
}

type MatchState = { state: "pending" | "unmatched"; nextRefreshDate: string | null };

interface WeeklyMatch {
  id: string;
  // Contact fields are omitted by the API once the match is skipped.
  matchedUser: { displayName: string; email?: string; wechat?: string; instagram?: string; photoUrl?: string; };
  compatibilitySummary: string;
  dimensionComparisons: Array<{
    dimension: string; userScore: number; matchScore: number;
    category: "close" | "complementary" | "discuss";
  }>;
  recommendationDate: string; nextRefreshDate: string;
  responseStatus: "unseen" | "viewed" | "interested" | "skipped";
  // Coarse view of the other person's response. A skip is reported as "seen",
  // never disclosed as a rejection.
  partnerSignal?: "interested" | "seen" | "unseen";
  // Words your stated expectations share with their bio. Empty when either
  // side wrote nothing, or once the match is skipped.
  sharedInterests?: string[];
}

// ============================================================
// STATIC DATA
// ============================================================

const SECTIONS = [
  { id: 1, name: "生活方式", questionIds: [1,2,3,4,5,6] },
  { id: 2, name: "人生方向", questionIds: [7,8,9,10,11,12] },
  { id: 3, name: "社会与世界", questionIds: [13,14,15,16,17,18] },
  { id: 4, name: "情感与沟通", questionIds: [19,20,21,22] },
  { id: 5, name: "亲密关系", questionIds: [23,24] },
];

const QUESTIONS = [
  { id:1, topic:"稳定与变化", left:"我更喜欢可预测、有规律的生活", right:"我更喜欢变化、探索和新的体验" },
  { id:2, topic:"计划与随性", left:"重要事情最好提前规划并按计划推进", right:"保留弹性、根据当下情况决定更适合我" },
  { id:3, topic:"风险态度", left:"我倾向于选择可靠稳妥的道路", right:"为了更大的可能性，我愿意承担不确定性" },
  { id:4, topic:"秩序与自由", left:"清晰的规则和秩序能让生活运行得更好", right:"个人自由和具体情况比统一规则更重要" },
  { id:5, topic:"独立与陪伴", left:"我需要较多独处时间和个人空间", right:"我更喜欢经常与亲近的人一起活动" },
  { id:6, topic:"社交范围", left:"我更愿意维持少数稳定而深入的关系", right:"我喜欢认识不同的人并扩大社交圈" },
  { id:7, topic:"成就与从容", left:"不断成长、取得成果对我的人生很重要", right:"生活舒适从容、不被成就压力支配更重要" },
  { id:8, topic:"工作与生活", left:"遇到重要机会时，我愿意暂时把事业放在生活前面", right:"即使影响事业发展，我也会优先保障个人生活" },
  { id:9, topic:"储蓄与体验", left:"收入更应该用于积累储蓄和未来保障", right:"在能力范围内，收入应该更多用于当下体验" },
  { id:10, topic:"财富的意义", left:"经济条件是安全感和人生选择权的重要基础", right:"金钱够用即可，不应成为衡量人生的重要标准" },
  { id:11, topic:"竞争与合作", left:"适度竞争能推动个人成长和社会进步", right:"合作共赢通常比相互竞争更有价值" },
  { id:12, topic:"认可与内在满足", left:"自己的努力获得认可和影响力很重要", right:"即使无人认可，做自己觉得有意义的事就足够" },
  { id:13, topic:"公平与贡献", left:"公平更接近让每个人获得相对平等的结果", right:"公平更接近按照投入、能力和贡献分配" },
  { id:14, topic:"原则与情境", left:"做人应该坚持稳定的原则，不能轻易因情况改变", right:"同一件事在不同情境中可能需要不同判断" },
  { id:15, topic:"传统与更新", left:"经过长期形成的传统通常有值得尊重的道理", right:"传统也需要不断接受质疑和重新选择" },
  { id:16, topic:"责任范围", left:"人的责任应优先从家人和身边人开始", right:"即使是陌生人，也应该得到相对平等的关心" },
  { id:17, topic:"信任与谨慎", left:"大多数人在获得信任后，会愿意善意相待", right:"信任应当逐步建立，不能轻易假定他人善意" },
  { id:18, topic:"努力与环境", left:"个人长期努力通常能够显著改变人生处境", right:"家庭背景、机遇和社会环境往往更能决定处境" },
  { id:19, topic:"理性与感受", left:"做重要决定时，我更相信事实、逻辑和长期结果", right:"做重要决定时，我也很重视直觉和内心感受" },
  { id:20, topic:"直接与委婉", left:"有问题时，直接清楚地说出来更有利于解决", right:"表达问题时，应优先照顾对方感受和关系氛围" },
  { id:21, topic:"冲突节奏", left:"发生矛盾后，我希望尽快沟通解决", right:"发生矛盾后，我通常需要先独处和整理情绪" },
  { id:22, topic:"表达与行动", left:"爱与关心需要经常通过语言和情绪表达出来", right:"可靠的行动和实际承担比语言表达更重要" },
  { id:23, topic:"共同体与个人边界", left:"长期伴侣应当深度参与彼此的重要决定和生活", right:"即使关系亲密，双方也应保留较强的个人自主权" },
  { id:24, topic:"坚持与止损", left:"关系遇到长期困难时，应尽最大努力磨合和修复", right:"如果核心需求长期无法满足，及时结束也很负责" },
];

const SIDE_PREFERENCES: MatchPreference[] = [
  "same", "same_or_neutral", "different", "different_or_neutral",
];

function normalizeMatchPreferences(
  preferences?: Partial<Record<number, MatchPreference>> | null,
  answers?: Record<number, number> | null,
): Record<number, MatchPreference> {
  return Object.fromEntries(QUESTIONS.map(({ id }) => {
    if (answers && (answers[id] === undefined || answers[id] === 4)) return [id, "any"];
    const preference = preferences?.[id];
    return [id, preference && SIDE_PREFERENCES.includes(preference) ? preference : "any"];
  })) as Record<number, MatchPreference>;
}

function normalizeQuestionnaireResponse(response: any): QuestionnaireResponse | null {
  if (!response) return null;
  return {
    ...response,
    matchPreferences: normalizeMatchPreferences(response.matchPreferences, response.answers),
  };
}

const VALUE_DIMENSIONS = [
  { name:"探索开放 ↔ 稳定守序", leftLabel:"稳定守序", rightLabel:"探索开放", questionIds:[1,2,3], color:"#E85D26" },
  { name:"独立空间 ↔ 社交联结", leftLabel:"独立空间", rightLabel:"社交联结", questionIds:[4,5,6], color:"#2B5CE6" },
  { name:"成就驱动 ↔ 生活从容", leftLabel:"成就驱动", rightLabel:"生活从容", questionIds:[7,8], color:"#7C3AED" },
  { name:"储蓄保障 ↔ 当下体验", leftLabel:"储蓄保障", rightLabel:"当下体验", questionIds:[9,10], color:"#059669" },
  { name:"竞争贡献 ↔ 平等合作", leftLabel:"竞争贡献", rightLabel:"平等合作", questionIds:[11,12], color:"#DC2626" },
  { name:"原则传统 ↔ 情境更新", leftLabel:"原则传统", rightLabel:"情境更新", questionIds:[14,15], color:"#D97706" },
  { name:"直接表达 ↔ 关系照顾", leftLabel:"直接表达", rightLabel:"关系照顾", questionIds:[20,21,22], color:"#EC4899" },
];

// Fallback spectrum used only by the landing-page illustration, which renders
// before anyone is logged in and has no real answers to draw.
const SAMPLE_ANSWERS: Record<number, number> = {
  1:5,2:3,3:5,4:4,5:3,6:3,7:6,8:4,9:3,10:4,
  11:4,12:5,13:4,14:5,15:4,16:3,17:4,18:5,
  19:4,20:6,21:5,22:4,23:3,24:4
};

// ============================================================
// CONTEXT
// ============================================================

interface AppCtx {
  route: Route;
  user: AppUser | null;
  questionnaire: QuestionnaireResponse | null;
  archivedQuestionnaires: QuestionnaireResponse[];
  weeklyMatch: WeeklyMatch | null;
  matchState: MatchState | null;
  booting: boolean;
  navigate: (r: Route) => void;
  enterDemo: (destination?: Route) => void;
  login: (email: string, pw: string) => Promise<string | null>;
  register: (data: RegisterData) => Promise<string | null>;
  logout: () => void;
  updateUser: (u: Partial<AppUser>) => Promise<void>;
  uploadPhoto: (file: File) => Promise<void>;
  saveAnswers: (answers: Record<number, number>, matchPreferences: Record<number, MatchPreference>, section: number) => void;
  submitQuestionnaire: (importantIds: number[], matchPreferences: Record<number, MatchPreference>) => Promise<void>;
  retakeQuestionnaire: () => Promise<void>;
  refreshMatch: () => Promise<void>;
  updateMatchResponse: (status: WeeklyMatch["responseStatus"]) => void;
  dislikeMatch: () => Promise<void>;
}

const Ctx = createContext<AppCtx>(null!);
const useApp = () => useContext(Ctx);

function AppProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const route = location.pathname;
  const [user, setUser] = useState<AppUser | null>(null);
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireResponse | null>(null);
  const [archivedQuestionnaires, setArchived] = useState<QuestionnaireResponse[]>([]);
  const [weeklyMatch, setWeeklyMatch] = useState<WeeklyMatch | null>(null);
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [booting, setBooting] = useState(true);

  const applyBootstrap = useCallback((payload: any) => {
    setUser(payload.user);
    setQuestionnaire(normalizeQuestionnaireResponse(payload.questionnaire));
    setArchived((payload.archivedQuestionnaires ?? []).map((q: any) => normalizeQuestionnaireResponse(q)!));
    setWeeklyMatch(payload.weeklyMatch ?? null);
    setMatchState(payload.matchState ?? null);
  }, []);

  const clearSession = useCallback(() => {
    setToken(null);
    localStorage.removeItem(V2_DEMO_SESSION_KEY);
    setUser(null); setQuestionnaire(null); setArchived([]); setWeeklyMatch(null); setMatchState(null);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      applyBootstrap(await api.me());
    } catch {
      clearSession();
    }
  }, [applyBootstrap, clearSession]);

  // Restore session from a stored token on first load.
  useEffect(() => {
    if (!getToken()) {
      if (V2_DEMO_MODE && localStorage.getItem(V2_DEMO_SESSION_KEY) === "1") {
        setUser({ ...V2_DEMO_USER });
      }
      setBooting(false);
      return;
    }
    refreshMe().finally(() => setBooting(false));
  }, [refreshMe]);

  const navigate = useCallback((r: Route) => {
    const protectedRoutes = ["/dashboard", "/home", "/profile", "/matches", "/questionnaire", "/questionnaire/complete", "/results", "/results/archive", "/matches/current"];
    if (protectedRoutes.some(path => r === path || r.startsWith(`${path}/`)) && !user) {
      routerNavigate("/login");
      return;
    }
    routerNavigate(r);
    window.scrollTo(0,0);
  }, [routerNavigate, user]);

  const enterDemo = useCallback((destination?: Route) => {
    if (!V2_DEMO_MODE) return;
    setToken(null);
    localStorage.setItem(V2_DEMO_SESSION_KEY, "1");
    setUser({ ...V2_DEMO_USER });
    setQuestionnaire(null);
    setArchived([]);
    setWeeklyMatch(null);
    setMatchState(null);
    const queryReturnTo = new URLSearchParams(location.search).get("returnTo");
    const nextRoute = destination ?? (queryReturnTo?.startsWith("/events/") ? queryReturnTo : "/home");
    routerNavigate(nextRoute);
  }, [location.search, routerNavigate]);

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    try {
      const payload = await api.login({ email, password });
      localStorage.removeItem(V2_DEMO_SESSION_KEY);
      setToken(payload.token);
      applyBootstrap(payload);
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      routerNavigate(returnTo?.startsWith("/events/") ? returnTo : "/home");
      return null;
    } catch (e) {
      // Distinguish wrong credentials from the server being unreachable —
      // reporting a network failure as "wrong password" sends people off
      // resetting a password that was fine.
      if (e instanceof ApiError && e.status === 401) return "邮箱或密码不正确，请重试。";
      return e instanceof ApiError ? e.message : "登录失败，请稍后再试。";
    }
  }, [applyBootstrap, routerNavigate]);

  const register = useCallback(async (data: RegisterData): Promise<string | null> => {
    try {
      const payload = await api.register(data);
      localStorage.removeItem(V2_DEMO_SESSION_KEY);
      setToken(payload.token);
      applyBootstrap(payload);
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      const suffix = returnTo?.startsWith("/events/") ? `&returnTo=${encodeURIComponent(returnTo)}` : "";
      routerNavigate(`/profile?onboarding=1${suffix}`);
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : "注册失败，请稍后再试";
    }
  }, [applyBootstrap, routerNavigate]);

  const logout = useCallback(() => {
    if (!(V2_DEMO_MODE && localStorage.getItem(V2_DEMO_SESSION_KEY) === "1")) api.logout().catch(() => {});
    clearSession();
    routerNavigate("/");
  }, [clearSession, routerNavigate]);

  const updateUser = useCallback(async (updates: Partial<AppUser>) => {
    if (V2_DEMO_MODE && localStorage.getItem(V2_DEMO_SESSION_KEY) === "1") {
      setUser(current => current ? { ...current, ...updates } : current);
      return;
    }
    const backendFields: {
      status?: string; bio?: string; matchPreference?: string;
      birthDate?: string; orientation?: Orientation; seekingGender?: "男" | "女";
      preferredAgeMin?: number | null; preferredAgeMax?: number | null;
    } = {};
    if (updates.status !== undefined) backendFields.status = updates.status;
    if (updates.bio !== undefined) backendFields.bio = updates.bio;
    if (updates.matchPreference !== undefined) backendFields.matchPreference = updates.matchPreference;
    if (updates.birthDate !== undefined) backendFields.birthDate = updates.birthDate;
    if (updates.orientation !== undefined) backendFields.orientation = updates.orientation;
    if (updates.seekingGender !== undefined) backendFields.seekingGender = updates.seekingGender;
    if (updates.preferredAgeMin !== undefined) backendFields.preferredAgeMin = updates.preferredAgeMin;
    if (updates.preferredAgeMax !== undefined) backendFields.preferredAgeMax = updates.preferredAgeMax;

    if (Object.keys(backendFields).length > 0) {
      try {
        await api.updateMe(backendFields);
      } catch {
        toast.error("保存失败，请重试");
        return;
      }
      await refreshMe();
    }
  }, [refreshMe]);

  const uploadPhoto = useCallback(async (file: File) => {
    try {
      const updated = await api.uploadPhoto(file);
      setUser(prev => prev ? { ...prev, ...updated } : prev);
    } catch {
      toast.error("上传失败，请重试");
    }
  }, []);

  const saveAnswers = useCallback((
    answers: Record<number, number>,
    matchPreferences: Record<number, MatchPreference>,
    section: number,
  ) => {
    const normalizedPreferences = normalizeMatchPreferences(matchPreferences, answers);
    api.saveAnswers({ answers, matchPreferences: normalizedPreferences, currentSection: section })
      .then((next: QuestionnaireResponse) => {
        setQuestionnaire({
          ...next,
          matchPreferences: normalizeMatchPreferences(
            next.matchPreferences ?? normalizedPreferences,
            next.answers ?? answers,
          ),
        });
        setUser(u => u ? { ...u, questionnaireStatus: "in_progress" } : u);
      })
      .catch(() => {});
  }, []);

  const submitQuestionnaire = useCallback(async (
    importantIds: number[],
    matchPreferences: Record<number, MatchPreference>,
  ) => {
    try {
      await api.submitQuestionnaire({
        importantQuestionIds: importantIds,
        matchPreferences: normalizeMatchPreferences(matchPreferences),
      });
      await refreshMe();
      routerNavigate("/questionnaire/complete");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "提交失败，请稍后再试");
    }
  }, [refreshMe, routerNavigate]);

  const retakeQuestionnaire = useCallback(async () => {
    try {
      await api.retakeQuestionnaire();
      await refreshMe();
      routerNavigate("/questionnaire");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败，请稍后再试");
    }
  }, [refreshMe, routerNavigate]);

  const refreshMatch = useCallback(async () => {
    try {
      const res = await api.matchCurrent();
      if (res && "state" in res) {
        setWeeklyMatch(null);
        setMatchState(res as MatchState);
      } else {
        setWeeklyMatch(res);
        setMatchState(null);
      }
    } catch {}
  }, []);

  const updateMatchResponse = useCallback((status: WeeklyMatch["responseStatus"]) => {
    api.matchResponse(status).then(setWeeklyMatch).catch(() => {
      setWeeklyMatch(prev => prev ? {...prev, responseStatus:status} : prev);
    });
  }, []);

  const dislikeMatch = useCallback(async () => {
    try {
      await api.matchDislike();
      setWeeklyMatch(null);
    } catch {
      toast.error("操作失败，请重试");
    }
  }, []);

  return (
    <Ctx.Provider value={{
      route, user, questionnaire, archivedQuestionnaires, weeklyMatch, matchState, booting,
      navigate, enterDemo, login, register, logout, updateUser, uploadPhoto,
      saveAnswers, submitQuestionnaire, retakeQuestionnaire, refreshMatch,
      updateMatchResponse, dislikeMatch,
    }}>
      {children}
    </Ctx.Provider>
  );
}

// ============================================================
// UTILITY COMPONENTS
// ============================================================

function cn(...cls: (string | boolean | undefined | null)[]) {
  return cls.filter(Boolean).join(" ");
}

function calcDimensionScore(answers: Record<number, number>, questionIds: number[]): number {
  const vals = questionIds.map(id => answers[id]).filter(Boolean);
  if (!vals.length) return 4;
  return vals.reduce((a,b) => a+b, 0) / vals.length;
}

function scoreToPercent(score: number): number {
  return Math.round(((score - 1) / 6) * 100);
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}
function Btn({ variant="primary", size="md", className, children, ...props }: ButtonProps) {
  const base = "inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] shadow-sm",
    secondary: "bg-secondary text-secondary-foreground border border-border hover:bg-muted",
    ghost: "text-foreground hover:bg-muted",
    danger: "bg-destructive text-destructive-foreground hover:opacity-90",
  };
  const sizes = { sm:"px-3 py-1.5 text-sm", md:"px-5 py-2.5", lg:"px-7 py-3.5 text-lg" };
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props}>{children}</button>;
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string; error?: string; helperText?: string;
}
function Input({ label, error, helperText, className, id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g,"-");
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={inputId} className="text-sm font-medium text-foreground">{label}</label>}
      <input
        id={inputId}
        className={cn(
          "w-full px-4 py-3 rounded-xl border bg-input-background text-foreground placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring transition-all",
          error ? "border-destructive" : "border-border",
          className
        )}
        {...props}
      />
      {error && <p className="text-destructive text-sm flex items-center gap-1"><AlertTriangle size={14}/>{error}</p>}
      {helperText && !error && <p className="text-muted-foreground text-sm">{helperText}</p>}
    </div>
  );
}

function PasswordInput({ label, error, ...props }: InputProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-foreground">{label}</label>}
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          className={cn(
            "w-full px-4 py-3 pr-12 rounded-xl border bg-input-background text-foreground placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring transition-all",
            error ? "border-destructive" : "border-border"
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
          aria-label={show ? "隐藏密码" : "显示密码"}
        >
          {show ? <EyeOff size={18}/> : <Eye size={18}/>}
        </button>
      </div>
      {error && <p className="text-destructive text-sm flex items-center gap-1"><AlertTriangle size={14}/>{error}</p>}
    </div>
  );
}

function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-card rounded-2xl shadow-2xl w-full max-w-md p-6 z-10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors">
            <X size={20}/>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusToggle({ status, onToggle }: { status: "active" | "inactive"; onToggle: () => void }) {
  const isActive = status === "active";
  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-all duration-200",
        isActive
          ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
          : "bg-muted border-border text-muted-foreground hover:bg-secondary"
      )}
      aria-label="切换每周匹配状态"
    >
      <span className={cn("w-2 h-2 rounded-full", isActive ? "bg-emerald-500" : "bg-muted-foreground")}/>
      {isActive ? "每周匹配已开启" : "每周匹配已暂停"}
    </button>
  );
}

function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-2 bg-muted rounded-full overflow-hidden", className)}>
      <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width:`${value}%` }}/>
    </div>
  );
}

function ValueDimensionBar({ name, score, color, compact }: { name: string; score: number; color: string; compact?: boolean }) {
  const pct = scoreToPercent(score);
  const parts = name.split(" ↔ ");
  return (
    <div className="bg-card rounded-2xl border border-border p-5 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-3">
        <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full text-white", compact ? "text-[10px]"  : "")} style={{ background:color }}>{parts[0]}</span>
        <span className="text-xs text-muted-foreground font-medium px-2 py-0.5 rounded-full bg-muted">{parts[1]}</span>
      </div>
      <div className="relative h-3 bg-muted rounded-full mt-2">
        <div className="absolute inset-y-0 left-0 rounded-full opacity-20" style={{ width:`${pct}%`, background:color }}/>
        <div
          className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-white shadow-md transition-all duration-700"
          style={{ left:`calc(${pct}% - 10px)`, background:color }}
        />
      </div>
      {!compact && (
        <div className="flex justify-between mt-3 text-xs text-muted-foreground">
          <span>{parts[0]}</span>
          <span>{parts[1]}</span>
        </div>
      )}
    </div>
  );
}

function SpectrumSlider({ value, onChange, leftLabel, rightLabel, disabled }: {
  value: number; onChange: (v: number) => void;
  leftLabel: string; rightLabel: string; disabled?: boolean;
}) {
  return (
    <div>
      <div className="hidden sm:flex justify-between gap-3 mb-4">
        <div className={cn("flex-1 p-4 rounded-xl border text-sm leading-relaxed transition-all", value <= 2 ? "border-primary bg-primary/5 text-foreground" : "border-border bg-muted/30 text-muted-foreground")}>
          {leftLabel}
        </div>
        <div className={cn("flex-1 p-4 rounded-xl border text-sm leading-relaxed transition-all text-right", value >= 6 ? "border-primary bg-primary/5 text-foreground" : "border-border bg-muted/30 text-muted-foreground")}>
          {rightLabel}
        </div>
      </div>
      <div className="sm:hidden space-y-2 mb-4">
        <div className={cn("p-4 rounded-xl border text-sm leading-relaxed transition-all", value <= 2 ? "border-primary bg-primary/5 text-foreground" : "border-border bg-muted/30 text-muted-foreground")}>
          <span className="text-xs font-medium text-muted-foreground block mb-1">← 偏向</span>
          {leftLabel}
        </div>
        <div className={cn("p-4 rounded-xl border text-sm leading-relaxed transition-all", value >= 6 ? "border-primary bg-primary/5 text-foreground" : "border-border bg-muted/30 text-muted-foreground")}>
          <span className="text-xs font-medium text-muted-foreground block mb-1">偏向 →</span>
          {rightLabel}
        </div>
      </div>
      <div className="flex items-center gap-2 px-1">
        {[1,2,3,4,5,6,7].map(v => (
          <button
            key={v}
            disabled={disabled}
            onClick={() => onChange(v)}
            className={cn(
              "flex-1 aspect-square rounded-full border-2 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[36px]",
              v === value
                ? "bg-primary border-primary scale-125 shadow-md"
                : "bg-card border-border hover:border-primary/50 hover:scale-110",
              v === 4 && v !== value ? "bg-muted" : ""
            )}
            aria-label={`选项 ${v}/7`}
            aria-pressed={v === value}
          />
        ))}
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-muted-foreground px-1">
        <span>完全偏左</span>
        <span>均衡</span>
        <span>完全偏右</span>
      </div>
    </div>
  );
}

// ============================================================
// LAYOUT COMPONENTS
// ============================================================

function Header() {
  const { user, navigate, logout, updateUser, route } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);

  const handleStatusToggle = () => {
    if (!user) return;
    if (user.status === "active") {
      setShowStatusModal(true);
    } else {
      updateUser({ status: "active" });
      toast.success("匹配已重新开启！每周推荐将恢复。");
    }
  };

  const confirmPause = () => {
    updateUser({ status: "inactive" });
    setShowStatusModal(false);
    toast("匹配已暂停。你随时可以重新开启。");
  };

  return (
    <>
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="font-display text-xl font-semibold text-foreground hover:text-primary transition-colors"
            style={{ fontFamily:"'Noto Serif SC', serif" }}
          >
            Common Ground
          </button>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {user ? (
              <>
                <Btn variant="ghost" size="sm" onClick={() => navigate("/home")}>首页</Btn>
                <Btn variant="ghost" size="sm" onClick={() => navigate("/events")}>活动</Btn>
                <Btn variant="ghost" size="sm" onClick={() => navigate("/profile")}>我的资料</Btn>
                <Btn variant="ghost" size="sm" onClick={() => navigate("/results")}>问卷结果</Btn>
                <StatusToggle status={user.status} onToggle={handleStatusToggle}/>
                <div className="relative ml-2">
                  <button
                    onClick={() => setMenuOpen(v => !v)}
                    className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-medium text-sm hover:opacity-90 transition-opacity overflow-hidden"
                  >
                    {user.photoUrl ? <img src={resolvePhotoUrl(user.photoUrl)} alt={user.displayName} className="w-full h-full object-cover"/> : user.displayName.slice(0,1)}
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-44 bg-card rounded-xl border border-border shadow-lg py-1 z-50">
                      <div className="px-3 py-2 border-b border-border">
                        <p className="text-sm font-medium">{user.displayName}</p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      </div>
                      <button onClick={logout} className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-muted transition-colors text-destructive">
                        <LogOut size={14}/>退出登录
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <Btn variant="ghost" size="sm" onClick={() => navigate("/")}>首页</Btn>
                <Btn variant="ghost" size="sm" onClick={() => navigate("/")}>关于匹配</Btn>
                <Btn variant="ghost" size="sm" onClick={() => navigate("/login")}>登录</Btn>
                <Btn variant="primary" size="sm" onClick={() => navigate("/register")}>开始探索</Btn>
              </>
            )}
          </nav>

          {/* Mobile menu button */}
          <button className="md:hidden p-2 rounded-lg hover:bg-muted transition-colors" onClick={() => setMenuOpen(v => !v)} aria-label="菜单">
            {menuOpen ? <X size={22}/> : <Menu size={22}/>}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-border bg-background px-4 py-4 flex flex-col gap-2">
            {user ? (
              <>
                <div className="flex items-center gap-3 pb-3 border-b border-border mb-1">
                  <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-medium overflow-hidden">
                    {user.photoUrl ? <img src={resolvePhotoUrl(user.photoUrl)} alt={user.displayName} className="w-full h-full object-cover"/> : user.displayName.slice(0,1)}
                  </div>
                  <div>
                    <p className="font-medium">{user.displayName}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                </div>
                <Btn variant="ghost" size="sm" onClick={() => { navigate("/home"); setMenuOpen(false); }}>首页</Btn>
                <Btn variant="ghost" size="sm" onClick={() => { navigate("/matches"); setMenuOpen(false); }}>匹配</Btn>
                <Btn variant="ghost" size="sm" onClick={() => { navigate("/events"); setMenuOpen(false); }}>活动</Btn>
                <Btn variant="ghost" size="sm" onClick={() => { navigate("/profile"); setMenuOpen(false); }}>我的资料</Btn>
                <Btn variant="ghost" size="sm" onClick={() => { navigate("/results"); setMenuOpen(false); }}>问卷结果</Btn>
                <StatusToggle status={user.status} onToggle={handleStatusToggle}/>
                <Btn variant="ghost" size="sm" onClick={logout} className="text-destructive justify-start">
                  <LogOut size={16}/>退出登录
                </Btn>
              </>
            ) : (
              <>
                <Btn variant="ghost" size="sm" onClick={() => { navigate("/"); setMenuOpen(false); }}>首页</Btn>
                <Btn variant="ghost" size="sm" onClick={() => { navigate("/login"); setMenuOpen(false); }}>登录</Btn>
                <Btn variant="primary" onClick={() => { navigate("/register"); setMenuOpen(false); }}>开始探索</Btn>
              </>
            )}
          </div>
        )}
      </header>

      <Modal open={showStatusModal} onClose={() => setShowStatusModal(false)} title="暂停每周匹配">
        <p className="text-muted-foreground text-sm leading-relaxed mb-6">
          暂停后，你不会收到每周推荐，也不会进入每周候选池。已经报名的活动不受影响；问卷和历史记录都会保留。
        </p>
        <div className="flex gap-3">
          <Btn variant="secondary" className="flex-1" onClick={() => setShowStatusModal(false)}>取消</Btn>
          <Btn variant="danger" className="flex-1" onClick={confirmPause}>确认暂停</Btn>
        </div>
      </Modal>
    </>
  );
}

function Footer() {
  const { navigate, user } = useApp();
  // Signed-in visitors shouldn't be pointed back at register/login.
  const accountLinks = user
    ? [{ label: "我的主页", r: "/dashboard" as Route }, { label: "问卷结果", r: "/results" as Route }]
    : [{ label: "登录", r: "/login" as Route }, { label: "注册", r: "/register" as Route }];
  return (
    <footer className="border-t border-border mt-24 bg-secondary">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2 md:col-span-1">
          <p className="font-display text-lg font-semibold mb-2" style={{ fontFamily:"'Noto Serif SC', serif" }}>Common Ground</p>
          <p className="text-sm text-muted-foreground">从三观开始，认识真实的人。</p>
        </div>
        {[
          { title:"产品", links:[{ label:"首页", r:"/" as Route },{ label:"关于匹配", r:"/" as Route }, ...(user ? [] : [{ label:"开始探索", r:"/register" as Route }])] },
          { title:"账号", links: accountLinks },
          { title:"关于", links:[{ label:"隐私政策", r:"/" as Route },{ label:"服务条款", r:"/" as Route },{ label:"联系我们", r:"/" as Route }] },
        ].map(col => (
          <div key={col.title}>
            <p className="font-medium mb-3 text-sm">{col.title}</p>
            <ul className="space-y-2">
              {col.links.map(l => (
                <li key={l.label}>
                  <button onClick={() => navigate(l.r)} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    {l.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>© 2026 Common Ground. 保留所有权利。</span>
          <span>没有正确答案，只有真实的你。</span>
        </div>
      </div>
    </footer>
  );
}

// ============================================================
// ABSTRACT VALUE VISUALIZATION (SVG)
// ============================================================

function ValueSpectrumViz({ userAnswers, matchAnswers, size = 320 }: {
  userAnswers?: Record<number, number>;
  matchAnswers?: Record<number, number>;
  size?: number;
}) {
  const cx = size / 2, cy = size / 2;
  const r = size * 0.35;
  const dims = VALUE_DIMENSIONS.slice(0, 6);
  const points = (answers: Record<number, number>) =>
    dims.map((d, i) => {
      const angle = (i / dims.length) * Math.PI * 2 - Math.PI / 2;
      const score = calcDimensionScore(answers, d.questionIds);
      const pct = scoreToPercent(score) / 100;
      const radius = r * (0.3 + pct * 0.7);
      return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    });

  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") + " Z";

  const ua = userAnswers || SAMPLE_ANSWERS;
  const ma = matchAnswers || { 1:3,2:5,3:4,4:3,5:5,6:4,7:3,8:5,9:5,10:3,11:5,12:4,13:5,14:3,15:5,16:4,17:3,18:5,19:3,20:5,21:4,22:3,23:5,24:4 };

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="max-w-full h-auto">
      {/* Background grid */}
      {[0.3, 0.55, 0.8, 1].map(scale => (
        <polygon key={scale}
          points={dims.map((_, i) => {
            const angle = (i / dims.length) * Math.PI * 2 - Math.PI / 2;
            return `${cx + Math.cos(angle) * r * scale},${cy + Math.sin(angle) * r * scale}`;
          }).join(" ")}
          fill="none" stroke="rgba(28,24,21,0.06)" strokeWidth="1"
        />
      ))}
      {/* Axes */}
      {dims.map((_, i) => {
        const angle = (i / dims.length) * Math.PI * 2 - Math.PI / 2;
        return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(angle) * r} y2={cy + Math.sin(angle) * r} stroke="rgba(28,24,21,0.08)" strokeWidth="1"/>;
      })}
      {/* Match profile */}
      <path d={toPath(points(ma))} fill="#2B5CE6" fillOpacity="0.15" stroke="#2B5CE6" strokeWidth="2" strokeOpacity="0.5"/>
      {/* User profile */}
      <path d={toPath(points(ua))} fill="#E85D26" fillOpacity="0.15" stroke="#E85D26" strokeWidth="2.5"/>
      {/* Center dot */}
      <circle cx={cx} cy={cy} r="3" fill="rgba(28,24,21,0.2)"/>
    </svg>
  );
}

// ============================================================
// LANDING PAGE
// ============================================================

function LandingPage() {
  const { navigate, user, enterDemo } = useApp();
  const DIMENSIONS_PREVIEW = ["探索与稳定","独立与联结","成就与生活","金钱与体验","公平与责任","信任与能动性","沟通与亲密"];

  // Send signed-in visitors to wherever they actually left off, rather than
  // back to a registration form they've already completed.
  const ctaRoute: Route = !user
    ? "/register"
    : user.questionnaireStatus === "completed"
      ? "/home"
      : "/questionnaire";
  const ctaLabel = !user
    ? "完成问卷，开启匹配"
    : user.questionnaireStatus === "completed"
      ? "进入匹配中心"
      : user.questionnaireStatus === "in_progress"
        ? "继续填写问卷"
        : "开始填写问卷";

  return (
    <div>
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <p className="text-sm font-medium text-primary tracking-wide uppercase mb-4">从三观开始认识一个人</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.15] mb-6 text-foreground" style={{ fontFamily:"'Noto Serif SC', serif" }}>
            比起猜你喜欢什么，我们更在意你如何看待生活。
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-8">
            用价值观问卷和双方都认可的必要条件，认真缩小彼此愿意认识的范围。你可以等待每周推荐，也可以借一场共同活动自然相遇。
          </p>
          {user ? (
            <Btn size="lg" onClick={() => navigate("/home")}>进入我的主页 <ArrowRight size={20}/></Btn>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Btn size="lg" onClick={() => navigate("/register")}>开始探索 <ArrowRight size={20}/></Btn>
              <Btn variant="secondary" size="lg" onClick={() => navigate("/login")}>登录</Btn>
              {V2_DEMO_MODE ? <Btn variant="ghost" size="lg" onClick={() => enterDemo("/home")}>直接体验演示</Btn> : null}
            </div>
          )}
        </div>
        <div className="flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#E85D26]/10 via-[#2B5CE6]/10 to-[#7C3AED]/10"/>
            <div className="relative p-8 rounded-3xl border border-border bg-card/50 backdrop-blur-sm">
              <ValueSpectrumViz size={300}/>
              <div className="absolute -top-3 -right-3 bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 rounded-full shadow-md">
                价值画像
              </div>
              <div className="absolute -bottom-3 -left-3 bg-[#2B5CE6] text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-md">
                本周推荐
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-secondary border-y border-border py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center mb-12" style={{ fontFamily:"'Noto Serif SC', serif" }}>怎么运作的？</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { n:1, icon:<BookOpen size={28}/>, title:"完成核心价值问卷", desc:"24道问题，约6–8分钟，探索你看待生活的方式。没有正确答案，只有真实的你。", color:"#E85D26" },
              { n:2, icon:<Star size={28}/>, title:"看见真实的个人价值画像", desc:"生成7个维度的价值画像，直观呈现你的倾向——不做判断，不比较高低。", color:"#2B5CE6" },
              { n:3, icon:<Heart size={28}/>, title:"每周收到一位认真筛选的推荐", desc:"完成问卷并开启匹配后，每七天收到一位当前最匹配的人，附上联系方式。", color:"#7C3AED" },
            ].map(step => (
              <div key={step.n} className="bg-card rounded-2xl border border-border p-6 relative overflow-hidden">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background:step.color+"20", color:step.color }}>
                  {step.icon}
                </div>
                <div className="absolute top-4 right-4 text-5xl font-bold opacity-5" style={{ color:step.color }}>{step.n}</div>
                <h3 className="font-semibold text-lg mb-2" style={{ fontFamily:"'Noto Serif SC', serif" }}>{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Questionnaire intro */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl font-bold mb-6" style={{ fontFamily:"'Noto Serif SC', serif" }}>关于这份问卷</h2>
            <div className="space-y-4">
              {[
                { icon:<BadgeCheck size={20} className="text-[#059669]"/>, text:"24道普适性问题，约6–8分钟完成" },
                { icon:<Info size={20} className="text-[#2B5CE6]"/>, text:"没有正确答案——所有倾向都有其价值" },
                { icon:<Clock size={20} className="text-primary"/>, text:"可以保存进度，随时继续" },
                { icon:<Shield size={20} className="text-[#7C3AED]"/>, text:"我们不评判你的选择，也不承诺完美伴侣" },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-4 bg-card rounded-xl border border-border">
                  {item.icon}
                  <span className="text-sm text-foreground">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-semibold mb-4 text-muted-foreground text-sm uppercase tracking-wide">七大价值维度</h3>
            <div className="flex flex-wrap gap-2">
              {DIMENSIONS_PREVIEW.map(d => (
                <span key={d} className="px-3 py-1.5 bg-card border border-border rounded-full text-sm text-foreground">
                  {d}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Two ways to meet */}
      <section className="bg-[#201B17] py-16 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-10">
            <p className="text-sm font-medium text-orange-300 tracking-wide uppercase mb-3">两种相遇方式</p>
            <h2 className="text-3xl font-bold mb-4" style={{ fontFamily:"'Noto Serif SC', serif" }}>认真等待，也可以主动创造一个场合</h2>
            <p className="text-white/65 leading-relaxed">每周推荐适合稳定探索；活动匹配则把一群有共同场景的人放进独立小池，在报名截止后完成一次匹配。</p>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-7">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-400/15 text-orange-300"><Sparkles size={24}/></div>
              <h3 className="mt-5 text-xl font-semibold">每周推荐</h3>
              <p className="mt-2 text-sm leading-6 text-white/60">完善资料和价值观问卷后，每周收到一位双向满足必要条件的推荐。</p>
              <Btn variant="secondary" className="mt-6" onClick={() => navigate(user ? "/matches" : "/register")}>查看匹配方式 <ArrowRight size={17}/></Btn>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-7">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-400/15 text-violet-300"><Heart size={24}/></div>
              <h3 className="mt-5 text-xl font-semibold">活动匹配</h3>
              <p className="mt-2 text-sm leading-6 text-white/60">报名公开或私密活动，为本场单独调整条件；主办方结束报名后手动运行一次匹配。</p>
              <Btn variant="secondary" className="mt-6" onClick={() => user ? navigate("/events") : V2_DEMO_MODE ? enterDemo("/events") : navigate("/register")}>{user ? "探索活动" : V2_DEMO_MODE ? "体验活动演示" : "探索活动"} <ArrowRight size={17}/></Btn>
            </div>
          </div>
        </div>
      </section>

      {/* Sample match */}
      <section className="bg-secondary border-y border-border py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3" style={{ fontFamily:"'Noto Serif SC', serif" }}>每周一次，认真推荐</h2>
            <p className="text-muted-foreground">完成问卷并开启匹配后，你将每七天收到一位当前最适合的推荐。</p>
          </div>
          <div className="max-w-md mx-auto bg-card rounded-2xl border border-border p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <img src={exampleBoyPhoto} alt="晓晨" className="w-12 h-12 rounded-full object-cover"/>
              <div>
                <p className="font-semibold">晓晨</p>
                <p className="text-xs text-muted-foreground">本周推荐 · 2026-07-07</p>
              </div>
              <span className="ml-auto text-xs px-2 py-1 bg-[#059669]/10 text-[#059669] rounded-full font-medium">本周推荐</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">你们在5个核心维度上高度接近</p>
            <ValueSpectrumViz size={220}/>
            <Btn variant="secondary" className="w-full mt-4" onClick={() => navigate(ctaRoute)}>
              {ctaLabel}
            </Btn>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="max-w-2xl mx-auto text-center">
          <Shield size={36} className="mx-auto mb-4 text-primary"/>
          <h2 className="text-2xl font-bold mb-4" style={{ fontFamily:"'Noto Serif SC', serif" }}>你的隐私，我们认真对待</h2>
          <p className="text-muted-foreground leading-relaxed mb-6">
            每周推荐和每场活动的结果彼此独立。活动中的联系方式会按照报名时确认的规则开放；主办方默认只看到汇总，不会看到你的标准资料与联系方式。
          </p>
          <div className="grid sm:grid-cols-2 gap-4 text-left">
            {[
              "真实姓名和完整出生日期始终私密",
              "每项选填资料可设为仅用于匹配",
              "暂停每周匹配不影响已报名活动",
              "不向第三方出售任何数据",
            ].map(t => (
              <div key={t} className="flex items-start gap-2 p-3 bg-card rounded-xl border border-border">
                <Check size={16} className="text-[#059669] mt-0.5 shrink-0"/>
                <span className="text-sm">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

// ============================================================
// AUTH PAGES
// ============================================================

function RegisterPage() {
  const { navigate, register } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [gender, setGender] = useState<"男" | "女" | "">("");
  const [birthDate, setBirthDate] = useState("");
  const [orientation, setOrientation] = useState<Orientation>("straight");
  const [seekingGender, setSeekingGender] = useState<"男" | "女" | "">("");
  const [wechat, setWechat] = useState("");
  const [instagram, setInstagram] = useState("");
  const [xiaohongshu, setXiaohongshu] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showContacts, setShowContacts] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const pwStrength = password.length === 0 ? 0 : password.length < 6 ? 1 : password.length < 10 ? 2 : 3;
  const pwLabels = ["", "偏弱", "中等", "较强"];
  const pwColors = ["", "bg-red-400", "bg-yellow-400", "bg-green-500"];

  const validate = () => {
    const e: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "请输入有效的邮箱地址";
    if (password.length < 8) e.password = "密码至少需要8位";
    if (password !== confirm) e.confirm = "两次密码不一致";
    if (!gender) e.gender = "请选择性别";
    if (!birthDate) {
      e.birthDate = "请填写出生日期";
    } else {
      const age = ageFromBirthDate(birthDate);
      if (age === null) e.birthDate = "请输入有效的出生日期";
      else if (age < 18) e.birthDate = "须满 18 岁才能注册";
      else if (age > 99) e.birthDate = "请检查出生日期";
    }
    // Bisexual is the only orientation where the target gender is a real
    // choice; for the others it follows from gender, so we don't ask.
    if (orientation === "bisexual" && !seekingGender) e.seekingGender = "请选择本轮希望匹配的性别";
    if (!agreed) e.agreed = "请同意服务条款";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    const errorMessage = await register({
      email, password, gender: gender as "男" | "女",
      birthDate, orientation,
      seekingGender: resolveSeekingGender(orientation, gender as "男" | "女", seekingGender),
      wechat, instagram, xiaohongshu, linkedin,
    });
    setSubmitting(false);
    if (errorMessage) setErrors(prev => ({ ...prev, email: errorMessage }));
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily:"'Noto Serif SC', serif" }}>创建账号</h1>
          <p className="text-muted-foreground">开始了解你自己，找到共同的土地。</p>
        </div>
        <form onSubmit={submit} className="bg-card rounded-2xl border border-border p-6 shadow-sm space-y-5">
          <Input label="邮箱" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" error={errors.email} autoComplete="email"/>
          <PasswordInput label="密码" value={password} onChange={e => setPassword(e.target.value)} placeholder="至少8位" error={errors.password} autoComplete="new-password"/>
          {password.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex gap-1 flex-1">
                {[1,2,3].map(l => <div key={l} className={cn("h-1 flex-1 rounded-full transition-all", l <= pwStrength ? pwColors[pwStrength] : "bg-muted")}/>)}
              </div>
              <span className="text-xs text-muted-foreground">{pwLabels[pwStrength]}</span>
            </div>
          )}
          <PasswordInput label="确认密码" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="再次输入密码" error={errors.confirm} autoComplete="new-password"/>

          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">性别</label>
            <div className="flex gap-3">
              {(["男","女"] as const).map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(g)}
                  className={cn(
                    "flex-1 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all",
                    gender === g ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/50"
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
            {errors.gender && <p className="text-destructive text-sm mt-1.5 flex items-center gap-1"><AlertTriangle size={14}/>{errors.gender}</p>}
          </div>

          <Input
            label="出生日期"
            type="date"
            value={birthDate}
            onChange={e => setBirthDate(e.target.value)}
            error={errors.birthDate}
            autoComplete="bday"
          />

          <div>
            <label className="text-sm font-medium text-foreground block mb-1.5">性取向</label>
            <div className="flex gap-2">
              {(["straight", "gay", "bisexual"] as const).map(o => (
                <button
                  key={o}
                  type="button"
                  onClick={() => { setOrientation(o); if (o !== "bisexual") setSeekingGender(""); }}
                  className={cn(
                    "flex-1 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all",
                    orientation === o ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/50"
                  )}
                >
                  {ORIENTATION_LABELS[o]}
                </button>
              ))}
            </div>
            {orientation === "bisexual" ? (
              <div className="mt-3">
                <label className="text-sm font-medium text-foreground block mb-1.5">本轮希望匹配</label>
                <div className="flex gap-3">
                  {(["男","女"] as const).map(g => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setSeekingGender(g)}
                      className={cn(
                        "flex-1 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all",
                        seekingGender === g ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/50"
                      )}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">每轮只进一个池子，之后可以在个人资料里改。</p>
                {errors.seekingGender && <p className="text-destructive text-sm mt-1.5 flex items-center gap-1"><AlertTriangle size={14}/>{errors.seekingGender}</p>}
              </div>
            ) : gender ? (
              <p className="text-xs text-muted-foreground mt-1.5">
                将为你匹配{resolveSeekingGender(orientation, gender, "")}性。同性和异性是两个互不重叠的池子。
              </p>
            ) : null}
          </div>

          <div className="border-t border-border pt-5">
            <button type="button" onClick={() => setShowContacts(v => !v)} className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left">
              <span>可选联系方式</span>
              <span className="ml-auto text-xs bg-muted px-2 py-0.5 rounded-full">可选</span>
            </button>
            {showContacts && (
              <div className="mt-4 space-y-4">
                <p className="text-xs text-muted-foreground p-3 bg-muted/50 rounded-xl leading-relaxed">
                  联系方式仅会在匹配成功或系统推荐场景中按规则展示。
                </p>
                <Input label="微信号" value={wechat} onChange={e => setWechat(e.target.value)} placeholder="你的微信号"/>
                <Input label="Instagram" value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="@username"/>
                <Input label="小红书" value={xiaohongshu} onChange={e => setXiaohongshu(e.target.value)} placeholder="你的小红书账号"/>
                <Input label="LinkedIn" value={linkedin} onChange={e => setLinkedin(e.target.value)} placeholder="LinkedIn URL"/>
              </div>
            )}
          </div>

          <div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-primary"/>
              <span className="text-sm text-muted-foreground leading-relaxed">
                我已阅读并同意 <button type="button" className="text-primary underline">服务条款</button> 和 <button type="button" className="text-primary underline">隐私政策</button>
              </span>
            </label>
            {errors.agreed && <p className="text-destructive text-sm mt-1 flex items-center gap-1"><AlertTriangle size={14}/>{errors.agreed}</p>}
          </div>

          <Btn type="submit" className="w-full" size="lg" disabled={submitting}>{submitting ? "创建中…" : "创建账号"}</Btn>
          <p className="text-center text-sm text-muted-foreground">
            已有账号？<button type="button" onClick={() => navigate("/login")} className="text-primary font-medium hover:underline">登录</button>
          </p>
        </form>
      </div>
    </div>
  );
}

function LoginPage() {
  const { navigate, login, enterDemo } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError("请填写邮箱和密码"); return; }
    setSubmitting(true);
    const errorMessage = await login(email, password);
    setSubmitting(false);
    if (errorMessage) setError(errorMessage);
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily:"'Noto Serif SC', serif" }}>欢迎回来</h1>
          <p className="text-muted-foreground">登录查看你的价值画像和本周推荐。</p>
        </div>
        <form onSubmit={submit} className="bg-card rounded-2xl border border-border p-6 shadow-sm space-y-5">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
              <AlertTriangle size={16}/>{error}
            </div>
          )}
          <Input label="邮箱" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" autoComplete="email"/>
          <PasswordInput label="密码" value={password} onChange={e => setPassword(e.target.value)} placeholder="你的密码" autoComplete="current-password"/>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="w-4 h-4 rounded accent-primary"/>
              记住我
            </label>
            <button type="button" className="text-sm text-primary hover:underline">忘记密码？</button>
          </div>
          <Btn type="submit" className="w-full" size="lg" disabled={submitting}>{submitting ? "登录中…" : "登录"}</Btn>
          {V2_DEMO_MODE ? (
            <div className="space-y-2 border-t border-border pt-5">
              <Btn type="button" variant="secondary" className="w-full" size="lg" onClick={() => enterDemo()}>无需账号，直接体验演示</Btn>
              <p className="text-center text-xs text-muted-foreground">演示资料和操作只保存在当前浏览器，不会发送给现有后端。</p>
            </div>
          ) : null}
          <p className="text-center text-sm text-muted-foreground">
            还没有账号？<button type="button" onClick={() => navigate("/register")} className="text-primary font-medium hover:underline">免费注册</button>
          </p>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// DASHBOARD
// ============================================================

function ProfileCard({ user, onUpdate, onUploadPhoto }: { user: AppUser; onUpdate: (u: Partial<AppUser>) => void; onUploadPhoto: (file: File) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState(user.bio ?? "");
  const [pref, setPref] = useState(user.matchPreference ?? "");
  const [birthDate, setBirthDate] = useState(user.birthDate ?? "");
  const [orientation, setOrientation] = useState<Orientation>(user.orientation ?? "straight");
  const [seekingGender, setSeekingGender] = useState<"男" | "女">(user.seekingGender ?? oppositeGender(user.gender));
  const [ageMin, setAgeMin] = useState(user.preferredAgeMin != null ? String(user.preferredAgeMin) : "");
  const [ageMax, setAgeMax] = useState(user.preferredAgeMax != null ? String(user.preferredAgeMax) : "");
  const [uploading, setUploading] = useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("请选择图片文件"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("图片不能超过 5 MB"); return; }
    setUploading(true);
    await onUploadPhoto(file);
    setUploading(false);
    toast.success("照片已保存");
  };

  const save = () => {
    if (birthDate) {
      const age = ageFromBirthDate(birthDate);
      if (age === null) { toast.error("出生日期格式不对"); return; }
      if (age < 18) { toast.error("须满 18 岁"); return; }
      if (age > 99) { toast.error("请检查出生日期"); return; }
    }
    // An empty box means "no preference", which is a real value the backend
    // needs to see as null rather than as an unchanged field.
    const min = ageMin.trim() === "" ? null : Number(ageMin);
    const max = ageMax.trim() === "" ? null : Number(ageMax);
    if (min !== null && (!Number.isInteger(min) || min < 18 || min > 99)) { toast.error("年龄下限需在 18-99 之间"); return; }
    if (max !== null && (!Number.isInteger(max) || max < 18 || max > 99)) { toast.error("年龄上限需在 18-99 之间"); return; }
    if (min !== null && max !== null && min > max) { toast.error("年龄下限不能大于上限"); return; }

    onUpdate({
      bio: bio.trim(),
      matchPreference: pref.trim(),
      ...(birthDate ? { birthDate } : {}),
      orientation,
      seekingGender: resolveSeekingGender(orientation, user.gender, seekingGender),
      preferredAgeMin: min,
      preferredAgeMax: max,
    });
    setEditing(false);
    toast.success("个人资料已保存");
  };

  const cancel = () => {
    setBio(user.bio ?? "");
    setPref(user.matchPreference ?? "");
    setBirthDate(user.birthDate ?? "");
    setOrientation(user.orientation ?? "straight");
    setSeekingGender(user.seekingGender ?? oppositeGender(user.gender));
    setAgeMin(user.preferredAgeMin != null ? String(user.preferredAgeMin) : "");
    setAgeMax(user.preferredAgeMax != null ? String(user.preferredAgeMax) : "");
    setEditing(false);
  };

  const currentPhoto = resolvePhotoUrl(user.photoUrl);

  return (
    <div className="bg-card rounded-2xl border border-border p-6 mb-8">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-semibold text-lg" style={{ fontFamily:"'Noto Serif SC', serif" }}>个人资料</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-xl hover:bg-muted"
          >
            <Pencil size={14}/>编辑
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-6">
        {/* Photo area */}
        <div className="flex flex-col items-center gap-3 shrink-0">
          <div className="relative group">
            <div className="w-28 h-28 rounded-2xl overflow-hidden border-2 border-border bg-muted flex items-center justify-center">
              {currentPhoto ? (
                <img src={currentPhoto} alt="头像" className="w-full h-full object-cover"/>
              ) : (
                <span className="text-4xl font-bold text-muted-foreground select-none" style={{ fontFamily:"'Noto Serif SC', serif" }}>
                  {user.displayName.slice(0,1)}
                </span>
              )}
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 rounded-2xl bg-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-xs font-medium"
              aria-label="上传头像"
            >
              <Camera size={16}/>上传
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhoto}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs text-primary hover:underline disabled:opacity-50"
          >
            {uploading ? "上传中…" : currentPhoto ? "更换照片" : "上传照片"}
          </button>
          <p className="text-[10px] text-muted-foreground text-center leading-relaxed">仅在匹配成功<br/>后对推荐对象可见</p>
        </div>

        {/* Text fields */}
        <div className="flex-1 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              自我介绍
            </label>
            {editing ? (
              <textarea
                value={bio}
                onChange={e => setBio(e.target.value)}
                maxLength={300}
                rows={4}
                placeholder="简单介绍一下自己，让匹配对象对你有个初步印象……"
                className="w-full px-4 py-3 rounded-xl border border-border bg-input-background text-foreground placeholder:text-muted-foreground text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-all"
              />
            ) : (
              <p className={cn("text-sm leading-relaxed min-h-[60px]", bio ? "text-foreground" : "text-muted-foreground italic")}>
                {bio || "还没有自我介绍，点击编辑添加……"}
              </p>
            )}
            {editing && (
              <p className="text-right text-xs text-muted-foreground mt-1">{bio.length}/300</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              对 TA 的期待
            </label>
            {editing ? (
              <textarea
                value={pref}
                onChange={e => setPref(e.target.value)}
                maxLength={300}
                rows={4}
                placeholder="描述你希望匹配对象的样子，可以包括外貌、性格、生活习惯、价值观侧重……不设门槛，随心写。"
                className="w-full px-4 py-3 rounded-xl border border-border bg-input-background text-foreground placeholder:text-muted-foreground text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-all"
              />
            ) : (
              <p className={cn("text-sm leading-relaxed min-h-[60px]", pref ? "text-foreground" : "text-muted-foreground italic")}>
                {pref || "还没有填写期待，点击编辑添加……"}
              </p>
            )}
            {editing && (
              <p className="text-right text-xs text-muted-foreground mt-1">{pref.length}/300</p>
            )}
          </div>

          <div className="border-t border-border pt-5 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">出生日期</label>
              {editing ? (
                <input
                  type="date"
                  value={birthDate}
                  onChange={e => setBirthDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-input-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                />
              ) : (
                <p className={cn("text-sm", user.age != null ? "text-foreground" : "text-muted-foreground italic")}>
                  {user.age != null ? `${user.age} 岁（${user.birthDate}）` : "还没有填写出生日期"}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">期待的年龄段</label>
              {editing ? (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={18} max={99} inputMode="numeric"
                      value={ageMin} onChange={e => setAgeMin(e.target.value)} placeholder="不限"
                      className="w-24 px-3 py-2.5 rounded-xl border border-border bg-input-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <span className="text-muted-foreground text-sm">到</span>
                    <input
                      type="number" min={18} max={99} inputMode="numeric"
                      value={ageMax} onChange={e => setAgeMax(e.target.value)} placeholder="不限"
                      className="w-24 px-3 py-2.5 rounded-xl border border-border bg-input-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <span className="text-muted-foreground text-sm">岁</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    这是硬筛选：范围外的人不会被推荐给你。留空表示不限。填了范围后，没写出生日期的人也会被排除。
                  </p>
                </>
              ) : (
                <p className={cn("text-sm", (user.preferredAgeMin != null || user.preferredAgeMax != null) ? "text-foreground" : "text-muted-foreground italic")}>
                  {user.preferredAgeMin == null && user.preferredAgeMax == null
                    ? "不限"
                    : `${user.preferredAgeMin ?? 18} - ${user.preferredAgeMax ?? 99} 岁`}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">性取向</label>
              {editing ? (
                <>
                  <div className="flex gap-2">
                    {(["straight", "gay", "bisexual"] as const).map(o => (
                      <button
                        key={o} type="button"
                        onClick={() => {
                          setOrientation(o);
                          if (o !== "bisexual") setSeekingGender(resolveSeekingGender(o, user.gender, ""));
                        }}
                        className={cn(
                          "flex-1 px-3 py-2 rounded-xl border text-sm font-medium transition-all",
                          orientation === o ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/50"
                        )}
                      >
                        {ORIENTATION_LABELS[o]}
                      </button>
                    ))}
                  </div>
                  {orientation === "bisexual" && (
                    <div className="flex gap-2 mt-2">
                      {(["男","女"] as const).map(g => (
                        <button
                          key={g} type="button" onClick={() => setSeekingGender(g)}
                          className={cn(
                            "flex-1 px-3 py-2 rounded-xl border text-sm transition-all",
                            seekingGender === g ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/50"
                          )}
                        >
                          本轮匹配{g}性
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1.5">
                    同性和异性是两个互不重叠的池子。改了会立刻重新配对，本周推荐会换人。
                  </p>
                </>
              ) : (
                <p className="text-sm text-foreground">
                  {ORIENTATION_LABELS[user.orientation ?? "straight"]}
                  <span className="text-muted-foreground">
                    {" "}· 匹配{user.seekingGender ?? oppositeGender(user.gender)}性
                  </span>
                </p>
              )}
            </div>
          </div>

          {editing && (
            <div className="flex gap-3 pt-1">
              <Btn onClick={save}>保存</Btn>
              <Btn variant="secondary" onClick={cancel}>取消</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DashboardPage() {
  const { user, questionnaire, weeklyMatch, matchState, navigate, updateUser, uploadPhoto } = useApp();
  const [showPauseModal, setShowPauseModal] = useState(false);

  if (!user) return null;

  const isActive = user.status === "active";

  const handleStatusToggle = () => {
    if (isActive) setShowPauseModal(true);
    else { updateUser({ status:"active" }); toast.success("匹配已重新开启！"); }
  };

  // Derive state
  const qs = user.questionnaireStatus;
  const hasMatch = !!weeklyMatch && isActive;
  const isSkipped = weeklyMatch?.responseStatus === "skipped";

  const totalAnswered = questionnaire ? Object.keys(questionnaire.answers).length : 0;
  const pct = Math.round((totalAnswered / 24) * 100);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily:"'Noto Serif SC', serif" }}>你好，{user.displayName}</h1>
          <p className="text-muted-foreground text-sm mt-1">{user.email}</p>
        </div>
        <StatusToggle status={user.status} onToggle={handleStatusToggle}/>
      </div>

      {/* Profile card */}
      <ProfileCard user={user} onUpdate={updateUser} onUploadPhoto={uploadPhoto}/>

      {/* State A — not started */}
      {qs === "not_started" && (
        <div className="mb-8 rounded-3xl overflow-hidden" style={{ background:"linear-gradient(135deg, #E85D26 0%, #7C3AED 60%, #2B5CE6 100%)" }}>
          <div className="p-8 md:p-12 text-white">
            <Sparkles size={32} className="mb-4 opacity-80"/>
            <h2 className="text-3xl font-bold mb-3" style={{ fontFamily:"'Noto Serif SC', serif" }}>从认识自己开始</h2>
            <p className="opacity-90 text-lg mb-2">完成24道核心价值问题，生成你的个人价值画像，并开启每周匹配。</p>
            <p className="opacity-70 text-sm mb-8">约6–8分钟 · 没有正确答案 · 可随时保存</p>
            <Btn
              size="lg"
              className="shadow-lg hover:brightness-95"
              style={{ backgroundColor:"#FFFFFF", color:"#9A3412" }}
              onClick={() => navigate("/questionnaire")}
            >
              开始填写问卷 <ArrowRight size={20}/>
            </Btn>
          </div>
        </div>
      )}

      {/* State B — in progress */}
      {qs === "in_progress" && questionnaire && (
        <div className="mb-8 bg-card rounded-2xl border border-border p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Zap size={24} className="text-primary"/>
            </div>
            <div className="flex-1">
              <h2 className="font-semibold text-lg mb-1">继续完成你的问卷</h2>
              <p className="text-muted-foreground text-sm mb-3">
                第{questionnaire.currentSection}阶段 · 已完成 {totalAnswered}/24 题
              </p>
              <ProgressBar value={pct} className="mb-4"/>
              <div className="flex gap-3">
                <Btn onClick={() => navigate("/questionnaire")}>继续填写 <ArrowRight size={16}/></Btn>
                <Btn variant="secondary" size="sm" onClick={() => navigate("/questionnaire")}>
                  <RotateCcw size={14}/>重新开始
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* State C/D/E — completed */}
      {qs === "completed" && (
        <div className="space-y-6">
          {/* State C — has match */}
          {hasMatch && weeklyMatch && !isSkipped && (
            <div className="bg-card rounded-2xl border border-[#2B5CE6]/30 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <Heart size={16} className="text-[#2B5CE6]"/>
                <span className="text-sm font-medium text-[#2B5CE6]">本周推荐</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-6 items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    {weeklyMatch.matchedUser.photoUrl ? (
                      <img src={resolvePhotoUrl(weeklyMatch.matchedUser.photoUrl)} alt={weeklyMatch.matchedUser.displayName} className="w-14 h-14 rounded-full object-cover"/>
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#2B5CE6] to-[#7C3AED] flex items-center justify-center text-white font-bold text-xl">
                        {weeklyMatch.matchedUser.displayName.slice(0,1)}
                      </div>
                    )}
                    <div>
                      <h2 className="font-bold text-xl">{weeklyMatch.matchedUser.displayName}</h2>
                      <p className="text-sm text-muted-foreground">{weeklyMatch.compatibilitySummary}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">推荐于 {weeklyMatch.recommendationDate} · 下一次推荐将在 {weeklyMatch.nextRefreshDate} 更新</p>
                  <Btn onClick={() => navigate("/matches/current")}>查看本周推荐 <ArrowRight size={16}/></Btn>
                </div>
                <div className="hidden sm:block">
                  <ValueSpectrumViz size={180}/>
                </div>
              </div>
            </div>
          )}

          {/* Skipped — kept visible so it's clear who was skipped and until when */}
          {hasMatch && weeklyMatch && isSkipped && (
            <div className="bg-muted/40 rounded-2xl border border-border p-6">
              <div className="flex items-center gap-2 mb-4">
                <SkipForward size={16} className="text-muted-foreground"/>
                <span className="text-sm font-medium text-muted-foreground">本周推荐已跳过</span>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground font-bold text-lg grayscale">
                  {weeklyMatch.matchedUser.photoUrl ? (
                    <img src={resolvePhotoUrl(weeklyMatch.matchedUser.photoUrl)} alt={weeklyMatch.matchedUser.displayName} className="w-full h-full rounded-full object-cover opacity-50"/>
                  ) : weeklyMatch.matchedUser.displayName.slice(0,1)}
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">你跳过了 {weeklyMatch.matchedUser.displayName}</p>
                  <p className="text-xs text-muted-foreground">本周不再显示 TA 的联系方式</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                下次推荐将在 {weeklyMatch.nextRefreshDate} 更新。跳过只影响本周，之后你们仍可能再次匹配。
              </p>
            </div>
          )}

          {/* State D — waiting */}
          {qs === "completed" && isActive && !weeklyMatch && (
            <div className="bg-card rounded-2xl border border-border p-6">
              {matchState?.state === "unmatched" ? (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <Info size={20} className="text-[#D97706]"/>
                    <h2 className="font-semibold">本周没有找到合适的人选</h2>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    本周的匹配已经完成，但这一轮没有为你找到合适的对象。
                    {matchState.nextRefreshDate
                      ? ` 下一轮匹配将在 ${matchState.nextRefreshDate} 进行，敬请期待。`
                      : " 请期待下一轮匹配。"}
                  </p>
                  <p className="text-muted-foreground text-xs mt-2">
                    我们只做双向合适的推荐，宁缺毋滥。随着更多人加入，匹配到的机会会变大。
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <Clock size={20} className="text-muted-foreground"/>
                    <h2 className="font-semibold">新的推荐正在准备中</h2>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    推荐每七天更新一次
                    {matchState?.nextRefreshDate ? `，下一轮将在 ${matchState.nextRefreshDate} 进行` : ""}
                    。耐心等待，只推荐认真筛选的人。
                  </p>
                </>
              )}
            </div>
          )}

          {/* State E — inactive */}
          {!isActive && (
            <div className="bg-muted/50 rounded-2xl border border-border p-6">
              <h2 className="font-semibold mb-2">匹配已暂停</h2>
              <p className="text-muted-foreground text-sm mb-4">重新开启后，你将恢复每周推荐。你的问卷结果和历史记录完好保留。</p>
              <Btn onClick={() => { updateUser({ status:"active" }); toast.success("匹配已重新开启！"); }}>
                开启匹配 <ArrowRight size={16}/>
              </Btn>
            </div>
          )}

          {/* Value summary */}
          {questionnaire && (
            <div className="bg-card rounded-2xl border border-border p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-semibold text-lg" style={{ fontFamily:"'Noto Serif SC', serif" }}>我的价值画像</h2>
                <div className="text-xs text-muted-foreground">完成于 {questionnaire.completedAt?.slice(0,10)}</div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 mb-5">
                {VALUE_DIMENSIONS.slice(0,4).map(d => {
                  const score = calcDimensionScore(questionnaire.answers, d.questionIds);
                  return <ValueDimensionBar key={d.name} name={d.name} score={score} color={d.color} compact/>;
                })}
              </div>
              <div className="flex gap-3 flex-wrap">
                <Btn variant="secondary" onClick={() => navigate("/results")}>查看完整结果 <ArrowRight size={16}/></Btn>
                <Btn variant="ghost" size="sm" onClick={() => navigate("/questionnaire")} className="text-muted-foreground">
                  <RotateCcw size={14}/>重新填写
                </Btn>
              </div>
            </div>
          )}

          {/* Optional topic packs */}
          <div className="bg-card rounded-2xl border border-border p-6 opacity-60">
            <div className="flex items-center gap-2 mb-4">
              <Lock size={16} className="text-muted-foreground"/>
              <h2 className="font-semibold">专项题库</h2>
              <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full ml-auto">即将开放</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {["家庭关系","育儿观念","金钱与财务","亲密关系"].map(t => (
                <span key={t} className="px-3 py-1.5 border border-border rounded-full text-sm text-muted-foreground">{t}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Locked previews for state A */}
      {qs === "not_started" && (
        <div className="grid sm:grid-cols-3 gap-4">
          {["我的价值画像","本周推荐","专项题库"].map(t => (
            <div key={t} className="bg-card rounded-2xl border border-border p-6 opacity-40 pointer-events-none">
              <div className="flex items-center gap-2 mb-3">
                <Lock size={16} className="text-muted-foreground"/>
                <span className="font-medium text-sm">{t}</span>
              </div>
              <div className="h-24 bg-muted rounded-xl"/>
            </div>
          ))}
        </div>
      )}

      <Modal open={showPauseModal} onClose={() => setShowPauseModal(false)} title="暂停匹配">
        <p className="text-muted-foreground text-sm leading-relaxed mb-6">
          暂停后，你不会收到每周推荐、匹配邀请，也不会被推荐给其他用户。你的问卷和历史记录会保留。
        </p>
        <div className="flex gap-3">
          <Btn variant="secondary" className="flex-1" onClick={() => setShowPauseModal(false)}>取消</Btn>
          <Btn variant="danger" className="flex-1" onClick={() => { updateUser({ status:"inactive" }); setShowPauseModal(false); toast("匹配已暂停。"); }}>
            确认暂停
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================
// QUESTIONNAIRE
// ============================================================

function QuestionnairePage() {
  const { questionnaire, saveAnswers, submitQuestionnaire, navigate } = useApp();
  const [currentSection, setCurrentSection] = useState(questionnaire?.currentSection ?? 1);
  const [answers, setAnswers] = useState<Record<number, number>>(questionnaire?.answers ?? {});
  const [matchPreferences, setMatchPreferences] = useState<Record<number, MatchPreference>>(
    () => normalizeMatchPreferences(questionnaire?.matchPreferences, questionnaire?.answers),
  );
  const [showImportance, setShowImportance] = useState(false);
  const [importantIds, setImportantIds] = useState<number[]>(questionnaire?.importantQuestionIds ?? []);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [unansweredWarning, setUnansweredWarning] = useState(false);

  const section = SECTIONS.find(s => s.id === currentSection)!;
  const sectionQuestions = QUESTIONS.filter(q => section.questionIds.includes(q.id));
  const totalAnswered = Object.keys(answers).length;
  const overallPct = Math.round((totalAnswered / 24) * 100);

  const sectionAnswered = sectionQuestions.filter(q => answers[q.id] !== undefined).length;
  const sectionComplete = sectionAnswered === sectionQuestions.length;

  // Autosave
  useEffect(() => {
    const timer = setTimeout(() => {
      saveAnswers(answers, matchPreferences, currentSection);
    }, 1000);
    return () => clearTimeout(timer);
  }, [answers, currentSection, matchPreferences, saveAnswers]);

  const handleAnswer = (questionId: number, value: number) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
    if (value === 4) {
      setMatchPreferences(prev => (
        prev[questionId] === "any" ? prev : { ...prev, [questionId]: "any" }
      ));
    }
    setUnansweredWarning(false);
  };

  const handleMatchPreference = (questionId: number, preference: MatchPreference) => {
    setMatchPreferences(prev => ({ ...prev, [questionId]: preference }));
  };

  const goNext = () => {
    if (!sectionComplete) { setUnansweredWarning(true); return; }
    if (currentSection === 5) { setShowImportance(true); return; }
    setCurrentSection(s => s + 1);
    setUnansweredWarning(false);
    window.scrollTo(0,0);
  };

  const goPrev = () => {
    if (showImportance) { setShowImportance(false); return; }
    if (currentSection > 1) setCurrentSection(s => s - 1);
    window.scrollTo(0,0);
  };

  const toggleImportant = (id: number) => {
    setImportantIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 5) { toast.error("最多选择5项"); return prev; }
      return [...prev, id];
    });
  };

  const handleSubmit = () => {
    if (importantIds.length < 3) { toast.error("请至少选择3项"); return; }
    setShowConfirm(true);
  };

  const confirmSubmit = () => {
    setShowConfirm(false);
    submitQuestionnaire(importantIds, matchPreferences);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => setShowExitConfirm(true)} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-muted">
              <ChevronLeft size={20}/>
            </button>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">核心价值问卷</span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Check size={12} className="text-[#059669]"/>已自动保存
                  <span>{overallPct}%</span>
                </div>
              </div>
              <ProgressBar value={overallPct}/>
            </div>
          </div>
          {/* Section indicators */}
          <div className="flex gap-1 mt-2">
            {SECTIONS.map(s => {
              const done = s.questionIds.every(id => answers[id] !== undefined);
              const current = s.id === currentSection && !showImportance;
              return (
                <div
                  key={s.id}
                  className={cn(
                    "flex-1 flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all",
                    done ? "bg-[#059669]/10 text-[#059669]" : current ? "bg-primary/10 text-primary" : "text-muted-foreground"
                  )}
                >
                  {done ? <Check size={10}/> : <span className="w-3 h-3 rounded-full border border-current flex items-center justify-center text-[9px]">{s.id}</span>}
                  <span className="hidden sm:inline truncate">{s.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">
        {!showImportance ? (
          <>
            <div className="mb-8">
              <p className="text-sm text-muted-foreground mb-1">第{currentSection}阶段 · {section.name}</p>
              <h2 className="text-2xl font-bold" style={{ fontFamily:"'Noto Serif SC', serif" }}>{section.name}</h2>
            </div>

            <div className="space-y-10">
              {sectionQuestions.map(q => {
                const answer = answers[q.id];
                const matchPreference = matchPreferences[q.id] ?? "any";
                const preferenceDisabled = answer === undefined || answer === 4;
                const isHardFilter = matchPreference === "same" || matchPreference === "different";

                return (
                  <div key={q.id} className="bg-card rounded-2xl border border-border p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-xs text-muted-foreground font-medium">Q{q.id}</span>
                      <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{q.topic}</span>
                      {answers[q.id] !== undefined && <Check size={14} className="text-[#059669] ml-auto"/>}
                    </div>
                    <SpectrumSlider
                      value={answers[q.id] ?? 0}
                      onChange={v => handleAnswer(q.id, v)}
                      leftLabel={q.left}
                      rightLabel={q.right}
                    />
                    <div className="mt-6 pt-5 border-t border-border/70">
                      <label className="block text-sm font-medium mb-2" id={`match-preference-label-${q.id}`}>
                        我希望对方……
                      </label>
                      <Select
                        value={matchPreference}
                        onValueChange={value => handleMatchPreference(q.id, value as MatchPreference)}
                        disabled={preferenceDisabled}
                      >
                        <SelectTrigger
                          className="h-11 rounded-xl bg-card"
                          aria-labelledby={`match-preference-label-${q.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">无所谓</SelectItem>
                          <SelectItem value="same_or_neutral">偏向同一边（可接受中立）</SelectItem>
                          <SelectItem value="same">必须同一边</SelectItem>
                          <SelectItem value="different_or_neutral">偏向不同边（可接受中立）</SelectItem>
                          <SelectItem value="different">必须不同边</SelectItem>
                        </SelectContent>
                      </Select>
                      {answer === undefined && (
                        <p className="mt-2 text-xs text-muted-foreground">请先完成上方的本人选择。</p>
                      )}
                      {answer === 4 && (
                        <p className="mt-2 text-xs text-muted-foreground">中间值不设置左右匹配限制。</p>
                      )}
                      {isHardFilter && (
                        <p className="mt-2 text-xs leading-relaxed text-[#B45309]">
                          此选项为硬性筛选条件，多多包容会大大增加匹配率哟~
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {unansweredWarning && (
              <div className="mt-4 flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-800 text-sm">
                <AlertTriangle size={16}/>
                还有 {sectionQuestions.length - sectionAnswered} 道题未作答，请完成后继续。
              </div>
            )}
          </>
        ) : (
          // Importance selection
          <div>
            <div className="mb-8">
              <h2 className="text-2xl font-bold mb-2" style={{ fontFamily:"'Noto Serif SC', serif" }}>哪些差异对你最重要？</h2>
              <p className="text-muted-foreground leading-relaxed mb-2">
                请从24道题中选出最多5项，你更希望未来的匹配对象与你接近。
              </p>
              <div className="flex items-center gap-2">
                <div className={cn("px-3 py-1 rounded-full text-sm font-medium border transition-all",
                  importantIds.length >= 3 ? "bg-[#059669]/10 border-[#059669]/30 text-[#059669]" : "bg-muted border-border text-muted-foreground"
                )}>
                  已选择 {importantIds.length}/5
                </div>
                {importantIds.length < 3 && <span className="text-xs text-muted-foreground">至少选3项</span>}
              </div>
            </div>
            <div className="space-y-6">
              {SECTIONS.map(s => (
                <div key={s.id}>
                  <p className="text-sm font-medium text-muted-foreground mb-3">{s.name}</p>
                  <div className="flex flex-wrap gap-2">
                    {QUESTIONS.filter(q => s.questionIds.includes(q.id)).map(q => {
                      const sel = importantIds.includes(q.id);
                      const maxed = importantIds.length >= 5 && !sel;
                      return (
                        <button
                          key={q.id}
                          onClick={() => !maxed && toggleImportant(q.id)}
                          disabled={maxed}
                          className={cn(
                            "px-3 py-2 rounded-xl text-sm border transition-all",
                            sel ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/50",
                            maxed ? "opacity-40 cursor-not-allowed" : ""
                          )}
                        >
                          {sel && <Check size={12} className="inline mr-1"/>}
                          {q.topic}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sticky bottom actions */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t border-border">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <Btn variant="secondary" onClick={goPrev} disabled={currentSection === 1 && !showImportance}>
            <ChevronLeft size={16}/>上一阶段
          </Btn>
          {showImportance ? (
            <Btn onClick={handleSubmit} disabled={importantIds.length < 3}>
              提交并生成我的价值画像 <CheckCircle size={16}/>
            </Btn>
          ) : (
            <Btn onClick={goNext}>
              {currentSection === 5 ? "选择重要维度" : "下一阶段"} <ChevronRight size={16}/>
            </Btn>
          )}
        </div>
      </div>

      <Modal open={showConfirm} onClose={() => setShowConfirm(false)} title="确认提交">
        <p className="text-muted-foreground text-sm leading-relaxed mb-6">
          提交后，本次结果将被锁定，不能直接修改。你可以稍后重新填写，旧结果会自动归档。
        </p>
        <div className="flex gap-3">
          <Btn variant="secondary" className="flex-1" onClick={() => setShowConfirm(false)}>再看看</Btn>
          <Btn className="flex-1" onClick={confirmSubmit}>确认提交</Btn>
        </div>
      </Modal>

      <Modal open={showExitConfirm} onClose={() => setShowExitConfirm(false)} title="退出问卷">
        <p className="text-muted-foreground text-sm leading-relaxed mb-6">
          你的进度已自动保存，可以随时从当前位置继续。
        </p>
        <div className="flex gap-3">
          <Btn variant="secondary" className="flex-1" onClick={() => setShowExitConfirm(false)}>继续填写</Btn>
          <Btn variant="ghost" className="flex-1" onClick={() => navigate("/dashboard")}>退出并保存</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================
// QUESTIONNAIRE COMPLETE
// ============================================================

function QuestionnaireCompletePage() {
  const { navigate, user, questionnaire, updateUser } = useApp();
  const isActive = user?.status === "active";

  return (
    <div className="min-h-[90vh] flex items-center justify-center px-4 py-16 relative overflow-hidden">
      {/* Decorative shapes */}
      <div className="absolute top-0 left-0 w-64 h-64 rounded-full opacity-10" style={{ background:"radial-gradient(circle, #E85D26, transparent)", transform:"translate(-30%, -30%)" }}/>
      <div className="absolute bottom-0 right-0 w-80 h-80 rounded-full opacity-10" style={{ background:"radial-gradient(circle, #7C3AED, transparent)", transform:"translate(30%, 30%)" }}/>
      <div className="absolute top-1/2 left-10 w-48 h-48 rounded-full opacity-5" style={{ background:"radial-gradient(circle, #2B5CE6, transparent)" }}/>

      <div className="relative max-w-lg w-full text-center">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#E85D26] to-[#7C3AED] flex items-center justify-center mx-auto mb-6 shadow-xl">
          <CheckCircle size={44} className="text-white"/>
        </div>
        <p className="text-primary font-semibold tracking-wide mb-2 text-lg" style={{ fontFamily:"'Instrument Serif', serif" }}>Congratulations!</p>
        <h1 className="text-4xl font-bold mb-3" style={{ fontFamily:"'Instrument Serif', serif" }}>You're ready to match!</h1>
        <p className="text-muted-foreground leading-relaxed mb-8 text-lg">
          {isActive
            ? "你的核心价值画像已经生成。开启匹配后，我们会每周为你推荐一位当前最合适的人。"
            : "你的价值画像已经生成。开启匹配后，你将有机会收到每周推荐。"
          }
        </p>

        {questionnaire && (
          <div className="mb-8 bg-card rounded-2xl border border-border p-6">
            <p className="text-sm text-muted-foreground mb-4 font-medium">你的价值画像预览</p>
            <div className="flex justify-center">
              <ValueSpectrumViz userAnswers={questionnaire.answers} size={240}/>
            </div>
            <div className="flex items-center justify-center gap-2 mt-3">
              <div className="w-3 h-3 rounded-full bg-primary"/>
              <span className="text-xs text-muted-foreground">你的画像</span>
            </div>
            {isActive && (
              <div className="mt-3 flex items-center justify-center gap-2 px-4 py-2 bg-[#059669]/10 border border-[#059669]/20 rounded-xl">
                <div className="w-2 h-2 rounded-full bg-[#059669]"/>
                <span className="text-sm text-[#059669] font-medium">匹配已开启</span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {!isActive && (
            <Btn size="lg" className="w-full" onClick={() => { updateUser({ status:"active" }); toast.success("匹配已开启！"); }}>
              开启匹配 <Zap size={18}/>
            </Btn>
          )}
          <Btn size="lg" className={isActive ? "w-full" : ""} variant={isActive ? "primary" : "secondary"} onClick={() => navigate("/results")}>
            查看我的价值画像 <ArrowRight size={18}/>
          </Btn>
          <Btn variant="secondary" onClick={() => navigate("/dashboard")}>返回个人主页</Btn>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// RESULTS PAGE
// ============================================================

function ResultsPage() {
  const { questionnaire, navigate } = useApp();
  const [showRetakeModal, setShowRetakeModal] = useState(false);
  const { retakeQuestionnaire } = useApp();

  if (!questionnaire || questionnaire.status === "draft") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <Archive size={48} className="mx-auto mb-4 text-muted-foreground opacity-30"/>
        <h2 className="text-2xl font-bold mb-2" style={{ fontFamily:"'Noto Serif SC', serif" }}>暂无结果</h2>
        <p className="text-muted-foreground mb-6">完成问卷后，你的价值画像将在此显示。</p>
        <Btn onClick={() => navigate("/questionnaire")}>开始填写问卷</Btn>
      </div>
    );
  }

  const importantQuestions = QUESTIONS.filter(q => questionnaire.importantQuestionIds.includes(q.id));

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-1" style={{ fontFamily:"'Noto Serif SC', serif" }}>我的价值画像</h1>
          <p className="text-muted-foreground text-sm">
            完成于 {questionnaire.completedAt?.slice(0,10)} · 版本 {questionnaire.version}
          </p>
        </div>
        <div className="flex gap-2">
          <Btn variant="ghost" size="sm" onClick={() => navigate("/results/archive")}>
            <Archive size={14}/>历史结果
          </Btn>
          <Btn variant="secondary" size="sm" onClick={() => setShowRetakeModal(true)}>
            <RotateCcw size={14}/>重新填写
          </Btn>
        </div>
      </div>

      {/* Narrative */}
      <div className="bg-card rounded-2xl border border-border p-6 mb-6">
        <p className="text-sm text-muted-foreground mb-3 font-medium">结果说明</p>
        <p className="text-foreground leading-relaxed">
          这份画像呈现了你在七个核心价值维度上的自我认知倾向。没有任何一种倾向比另一种更好——它们只是你看待生活的方式。匹配并非追求完全相同，而是寻找对话的可能性。
        </p>
      </div>

      {/* Dimensions */}
      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        {VALUE_DIMENSIONS.map(d => {
          const score = calcDimensionScore(questionnaire.answers, d.questionIds);
          return <ValueDimensionBar key={d.name} name={d.name} score={score} color={d.color}/>;
        })}
      </div>

      {/* Important topics */}
      {importantQuestions.length > 0 && (
        <div className="bg-card rounded-2xl border border-border p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Star size={16} className="text-[#D97706]"/>
            <h2 className="font-semibold">你认为最重要的五个维度</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {importantQuestions.map(q => (
              <span key={q.id} className="px-3 py-1.5 bg-[#D97706]/10 border border-[#D97706]/20 text-[#D97706] rounded-full text-sm font-medium">
                {q.topic}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">这些维度在匹配时将被赋予更高权重。</p>
        </div>
      )}

      {/* Spectrum visualization */}
      <div className="bg-card rounded-2xl border border-border p-6 mb-6">
        <h2 className="font-semibold mb-4">全局价值分布</h2>
        <div className="flex justify-center">
          <ValueSpectrumViz userAnswers={questionnaire.answers} size={280}/>
        </div>
        <div className="flex items-center justify-center gap-2 mt-2">
          <div className="w-3 h-3 rounded-full bg-primary"/>
          <span className="text-xs text-muted-foreground">你的价值画像</span>
        </div>
      </div>

      <div className="p-4 bg-muted/50 rounded-xl text-sm text-muted-foreground text-center mb-6">
        没有任何一种价值取向比另一种更优越。这份结果仅供参考，不代表你的全部。
      </div>

      <Btn variant="secondary" size="sm" onClick={() => setShowRetakeModal(true)} className="flex items-center gap-2">
        <RotateCcw size={14}/>重新填写问卷
      </Btn>

      <Modal open={showRetakeModal} onClose={() => setShowRetakeModal(false)} title="重新填写问卷">
        <p className="text-muted-foreground text-sm leading-relaxed mb-6">
          当前结果将继续作为你的有效画像，直到新问卷提交完成。提交新问卷后，旧结果将自动归档并可在"历史结果"中查看。
        </p>
        <div className="flex gap-3">
          <Btn variant="secondary" className="flex-1" onClick={() => setShowRetakeModal(false)}>取消</Btn>
          <Btn className="flex-1" onClick={() => { setShowRetakeModal(false); retakeQuestionnaire(); }}>
            开始重新填写
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================
// ARCHIVE PAGE
// ============================================================

function ArchivePage() {
  const { questionnaire, archivedQuestionnaires, navigate } = useApp();
  const [viewingArchived, setViewingArchived] = useState<QuestionnaireResponse | null>(null);

  const allResults = [
    ...(questionnaire && questionnaire.status === "current" ? [{ ...questionnaire, isCurrent: true }] : []),
    ...archivedQuestionnaires.map(q => ({ ...q, isCurrent: false })),
  ];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => navigate("/results")} className="p-2 rounded-xl hover:bg-muted transition-colors">
          <ChevronLeft size={20}/>
        </button>
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily:"'Noto Serif SC', serif" }}>历史结果</h1>
          <p className="text-muted-foreground text-sm">你的所有问卷记录</p>
        </div>
      </div>

      {allResults.length === 0 ? (
        <div className="text-center py-20">
          <Archive size={48} className="mx-auto mb-4 text-muted-foreground opacity-30"/>
          <p className="text-muted-foreground">暂无历史记录</p>
        </div>
      ) : (
        <div className="space-y-4">
          {allResults.map((r) => {
            const isCurrent = (r as any).isCurrent;
            return (
              <div key={r.id} className={cn("bg-card rounded-2xl border p-5", isCurrent ? "border-primary/30" : "border-border")}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">版本 {r.version}</span>
                      {isCurrent ? (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">当前有效</span>
                      ) : (
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">已归档</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      完成于 {r.completedAt?.slice(0,10) || "未完成"}
                    </p>
                  </div>
                  <button
                    onClick={() => setViewingArchived(viewingArchived?.id === r.id ? null : r)}
                    className="text-sm text-primary hover:underline font-medium"
                  >
                    {viewingArchived?.id === r.id ? "收起" : "查看当时结果"}
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {VALUE_DIMENSIONS.slice(0,4).map(d => {
                    const score = calcDimensionScore(r.answers, d.questionIds);
                    const pct = scoreToPercent(score);
                    return (
                      <div key={d.name} className="text-center">
                        <div className="h-1 bg-muted rounded-full mb-1">
                          <div className="h-full rounded-full" style={{ width:`${pct}%`, background:d.color }}/>
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">{d.name.split(" ↔ ")[0]}</p>
                      </div>
                    );
                  })}
                </div>
                {viewingArchived?.id === r.id && (
                  <div className="mt-4 pt-4 border-t border-border">
                    {isCurrent && <p className="text-xs text-muted-foreground mb-3">归档结果为只读，无法修改。</p>}
                    <div className="grid sm:grid-cols-2 gap-3">
                      {VALUE_DIMENSIONS.map(d => {
                        const score = calcDimensionScore(r.answers, d.questionIds);
                        return <ValueDimensionBar key={d.name} name={d.name} score={score} color={d.color} compact/>;
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MATCH DETAIL PAGE
// ============================================================

function MatchDetailPage() {
  const { weeklyMatch, matchState, navigate, updateMatchResponse, user, refreshMatch, dislikeMatch } = useApp();
  const [copied, setCopied] = useState(false);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => { refreshMatch(); }, [refreshMatch]);

  if (!user || user.status !== "active") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <Heart size={48} className="mx-auto mb-4 text-muted-foreground opacity-30"/>
        <h2 className="text-2xl font-bold mb-2" style={{ fontFamily:"'Noto Serif SC', serif" }}>匹配已暂停</h2>
        <p className="text-muted-foreground mb-6">开启匹配后可以查看本周推荐。</p>
        <Btn onClick={() => navigate("/dashboard")}>返回主页</Btn>
      </div>
    );
  }

  if (!weeklyMatch) {
    const unmatched = matchState?.state === "unmatched";
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        {unmatched
          ? <Info size={48} className="mx-auto mb-4 text-[#D97706] opacity-70"/>
          : <Clock size={48} className="mx-auto mb-4 text-muted-foreground opacity-30"/>}
        <h2 className="text-2xl font-bold mb-2" style={{ fontFamily:"'Noto Serif SC', serif" }}>
          {unmatched ? "本周没有找到合适的人选" : "暂时没有推荐"}
        </h2>
        <p className="text-muted-foreground mb-2">
          {unmatched
            ? "本周的匹配已经完成，但这一轮没有为你找到合适的对象。"
            : "每七天更新一次推荐。"}
          {matchState?.nextRefreshDate ? `下一轮匹配将在 ${matchState.nextRefreshDate} 进行。` : ""}
        </p>
        <p className="text-sm text-muted-foreground mb-6">在此期间，你可以回顾自己的价值画像。</p>
        <Btn variant="secondary" onClick={() => navigate("/results")}>查看价值画像</Btn>
      </div>
    );
  }

  if (weeklyMatch.responseStatus === "skipped") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <SkipForward size={48} className="mx-auto mb-4 text-muted-foreground opacity-30"/>
        <h2 className="text-2xl font-bold mb-2" style={{ fontFamily:"'Noto Serif SC', serif" }}>
          你跳过了 {weeklyMatch.matchedUser.displayName}
        </h2>
        <p className="text-muted-foreground mb-2">本周不再显示 TA 的联系方式。</p>
        <p className="text-sm text-muted-foreground mb-6">
          下次推荐将在 {weeklyMatch.nextRefreshDate} 更新。跳过只影响本周，之后你们仍可能再次匹配。
        </p>
        <Btn variant="secondary" onClick={() => navigate("/dashboard")}>返回主页</Btn>
      </div>
    );
  }

  const m = weeklyMatch;
  const isInterested = m.responseStatus === "interested";
  const closeCount = m.dimensionComparisons.filter(d => d.category === "close").length;
  const complementCount = m.dimensionComparisons.filter(d => d.category === "complementary").length;
  const discussCount = m.dimensionComparisons.filter(d => d.category === "discuss").length;

  const categoryLabel = { close:"高度接近", complementary:"可以互补", discuss:"建议交流" };
  const categoryColor = { close:"bg-[#059669]/10 text-[#059669] border-[#059669]/20", complementary:"bg-[#2B5CE6]/10 text-[#2B5CE6] border-[#2B5CE6]/20", discuss:"bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20" };

  const copyEmail = () => {
    if (!m.matchedUser.email) return;
    navigator.clipboard.writeText(m.matchedUser.email).then(() => {
      setCopied(true);
      toast.success("邮箱已复制");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const topAlignments = m.dimensionComparisons.filter(d => d.category === "close").slice(0,3);
  const conversationTopics = m.dimensionComparisons.filter(d => d.category === "discuss" || d.category === "complementary").slice(0,2);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => navigate("/dashboard")} className="p-2 rounded-xl hover:bg-muted transition-colors">
          <ChevronLeft size={20}/>
        </button>
        <div>
          <div className="flex items-center gap-2">
            <Heart size={16} className="text-primary"/>
            <span className="text-sm font-medium text-primary">本周推荐</span>
          </div>
          <p className="text-xs text-muted-foreground">推荐于 {m.recommendationDate}</p>
        </div>
      </div>

      {/* Match header */}
      <div className="bg-card rounded-2xl border border-border p-6 mb-6">
        <div className="flex flex-col sm:flex-row gap-6 items-start">
          <div>
            <div className="flex items-center gap-4 mb-4">
              {m.matchedUser.photoUrl ? (
                <img src={resolvePhotoUrl(m.matchedUser.photoUrl)} alt={m.matchedUser.displayName} className="w-20 h-20 rounded-full object-cover shadow-lg"/>
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#2B5CE6] to-[#7C3AED] flex items-center justify-center text-white font-bold text-3xl shadow-lg">
                  {m.matchedUser.displayName.slice(0,1)}
                </div>
              )}
              <div>
                <h1 className="text-2xl font-bold mb-1" style={{ fontFamily:"'Noto Serif SC', serif" }}>{m.matchedUser.displayName}</h1>
                <p className="text-muted-foreground">{m.compatibilitySummary}</p>
                <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                  <span>{closeCount} 高度接近</span>
                  <span>{complementCount} 可以互补</span>
                  <span>{discussCount} 建议交流</span>
                </div>
              </div>
            </div>
            {m.sharedInterests && m.sharedInterests.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-2">TA 的自我介绍里提到了你期待的：</p>
                <div className="flex flex-wrap gap-2">
                  {m.sharedInterests.map(term => (
                    <span key={term} className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                      {term}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <p className="text-sm text-muted-foreground leading-relaxed">
              这位推荐来自系统根据你的价值画像筛选，不代表完美匹配，而是对话的起点。
            </p>
          </div>
          <div className="hidden sm:block shrink-0">
            <ValueSpectrumViz size={200}/>
            <div className="flex gap-3 justify-center mt-2 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary"/>{user.displayName}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#2B5CE6]"/>{m.matchedUser.displayName}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Dimension breakdown */}
      <div className="bg-card rounded-2xl border border-border p-6 mb-6">
        <h2 className="font-semibold mb-4" style={{ fontFamily:"'Noto Serif SC', serif" }}>维度对比</h2>
        <div className="space-y-4">
          {m.dimensionComparisons.map(d => (
            <div key={d.dimension} className="relative">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium truncate mr-2">{d.dimension}</span>
                <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium shrink-0", categoryColor[d.category])}>
                  {categoryLabel[d.category]}
                </span>
              </div>
              <div className="relative h-4 bg-muted rounded-full overflow-hidden">
                {/* User position */}
                <div
                  className="absolute top-0 h-full w-2 rounded-full bg-primary shadow-sm"
                  style={{ left:`calc(${scoreToPercent(d.userScore)}% - 4px)` }}
                />
                {/* Match position */}
                <div
                  className="absolute top-0 h-full w-2 rounded-full bg-[#2B5CE6] shadow-sm opacity-70"
                  style={{ left:`calc(${scoreToPercent(d.matchScore)}% - 4px)` }}
                />
              </div>
              <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary"/>你</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#2B5CE6]"/>{m.matchedUser.displayName}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Alignment highlights */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-[#059669]/5 border border-[#059669]/20 rounded-2xl p-5">
          <h3 className="font-semibold mb-3 text-[#059669]">三大共鸣领域</h3>
          <ul className="space-y-2">
            {topAlignments.map(d => (
              <li key={d.dimension} className="flex items-start gap-2 text-sm">
                <Check size={14} className="text-[#059669] mt-0.5 shrink-0"/>
                {d.dimension}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-[#D97706]/5 border border-[#D97706]/20 rounded-2xl p-5">
          <h3 className="font-semibold mb-3 text-[#D97706]">可以探索的话题</h3>
          <ul className="space-y-2">
            {conversationTopics.map(d => (
              <li key={d.dimension} className="flex items-start gap-2 text-sm">
                <Star size={14} className="text-[#D97706] mt-0.5 shrink-0"/>
                {d.dimension}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Contact section */}
      <div className="bg-card rounded-2xl border border-primary/20 p-6 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <BadgeCheck size={18} className="text-primary"/>
          <h2 className="font-semibold">联系方式</h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
          以下联系方式仅因为 {m.matchedUser.displayName} 是你当前的系统推荐而展示。请在尊重对方的前提下发起联系。
        </p>
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl">
            <span className="text-sm text-muted-foreground w-16 shrink-0">邮箱</span>
            <span className="text-sm font-medium flex-1">{m.matchedUser.email}</span>
            <button
              onClick={copyEmail}
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors px-2 py-1 rounded-lg hover:bg-primary/10"
            >
              {copied ? <Check size={12}/> : <Copy size={12}/>}
              {copied ? "已复制" : "复制"}
            </button>
          </div>
          {m.matchedUser.wechat && (
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl">
              <span className="text-sm text-muted-foreground w-16 shrink-0">微信</span>
              <span className="text-sm font-medium">{m.matchedUser.wechat}</span>
            </div>
          )}
          {m.matchedUser.instagram && (
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-xl">
              <span className="text-sm text-muted-foreground w-16 shrink-0">Instagram</span>
              <span className="text-sm font-medium">{m.matchedUser.instagram}</span>
            </div>
          )}
        </div>
      </div>

      {/* Mutual interest */}
      {isInterested && m.partnerSignal === "interested" && (
        <div className="mb-4 rounded-2xl border border-[#059669]/30 bg-[#059669]/5 p-5 flex items-start gap-3">
          <Heart size={20} className="text-[#059669] mt-0.5 shrink-0"/>
          <div>
            <p className="font-semibold text-[#059669] mb-0.5">你们互相感兴趣了！</p>
            <p className="text-sm text-muted-foreground">
              {m.matchedUser.displayName} 也对你表达了兴趣。主动一点，先打个招呼吧。
            </p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3 mb-2">
        <Btn
          variant={isInterested ? "secondary" : "primary"}
          onClick={() => { if (!isInterested) { updateMatchResponse("interested"); toast.success("已标记为感兴趣！"); } }}
          disabled={isInterested}
          className={isInterested ? "border-[#059669]/40 text-[#059669]" : ""}
        >
          {isInterested ? <><Check size={16}/>已表达感兴趣</> : <><Heart size={16}/>我感兴趣</>}
        </Btn>
        <Btn variant="secondary" onClick={() => { updateMatchResponse("skipped"); toast("已跳过本周推荐，下周会为你重新匹配。"); navigate("/dashboard"); }}>
          <SkipForward size={16}/>暂时跳过
        </Btn>
        <Btn variant="ghost" size="sm" onClick={() => setShowReport(true)} className="text-muted-foreground">
          <Flag size={14}/>举报或屏蔽
        </Btn>
      </div>

      {isInterested && m.partnerSignal !== "interested" && (
        <p className="text-sm text-muted-foreground mb-4">
          {m.partnerSignal === "seen"
            ? `${m.matchedUser.displayName} 已经看过你的资料，还没有回应。`
            : `${m.matchedUser.displayName} 还没有查看本周推荐。`}
        </p>
      )}

      <p className="text-xs text-muted-foreground text-center">
        下一次推荐将在 {m.nextRefreshDate} 更新
      </p>

      <Modal open={showReport} onClose={() => setShowReport(false)} title="举报或屏蔽">
        <p className="text-muted-foreground text-sm leading-relaxed mb-6">
          屏蔽后，你和这位用户将不会再被推荐给对方，此操作无法撤销。我们会认真对待每一份反馈。
        </p>
        <div className="space-y-2 mb-4">
          {["内容不当","感觉不真实","其他原因"].map(r => (
            <button key={r} className="w-full text-left px-4 py-3 bg-muted rounded-xl text-sm hover:bg-secondary transition-colors">{r}</button>
          ))}
        </div>
        <div className="flex gap-3">
          <Btn variant="secondary" className="flex-1" onClick={() => setShowReport(false)}>取消</Btn>
          <Btn variant="danger" className="flex-1" onClick={async () => { setShowReport(false); await dislikeMatch(); toast("已屏蔽，你们不会再被推荐给对方。"); navigate("/dashboard"); }}>
            确认屏蔽
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================
// ROUTER
// ============================================================

function Router() {
  const { route } = useApp();

  const protectedRoutes: Route[] = ["/dashboard","/questionnaire","/questionnaire/complete","/results","/results/archive","/matches/current"];
  const { user } = useApp();

  if (protectedRoutes.includes(route) && !user) {
    return <LoginPage/>;
  }

  const pages: Record<Route, React.ReactNode> = {
    "/": <LandingPage/>,
    "/register": <RegisterPage/>,
    "/login": <LoginPage/>,
    "/dashboard": <Navigate to="/home" replace />,
    "/questionnaire": <QuestionnairePage/>,
    "/questionnaire/complete": <QuestionnaireCompletePage/>,
    "/results": <ResultsPage/>,
    "/results/archive": <ArchivePage/>,
    "/matches/current": <MatchDetailPage/>,
  };

  return <>{pages[route]}</>;
}

// ============================================================
// APP ROOT
// ============================================================

export default function App() {
  return (
    <AppProvider>
      <Toaster position="top-center" richColors/>
      <div className="min-h-screen flex flex-col">
        <AppRouterWrapper/>
      </div>
    </AppProvider>
  );
}

function AppRouterWrapper() {
  const { route, booting, user, questionnaire, weeklyMatch, matchState, updateUser, logout, navigate } = useApp();
  const location = useLocation();
  const isQuestionnaire = route === "/questionnaire";
  const isCompletion = route === "/questionnaire/complete";
  const isV2Route = route === "/home" || route === "/profile" || route === "/matches" || route.startsWith("/events/") || route === "/events" || (route.startsWith("/matches/") && route !== "/matches/current");
  const guestEventMatch = route === "/events/new" ? null : route.match(/^\/events\/([^/]+)$/);

  if (booting) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">加载中…</div>;
  }

  if (isV2Route) {
    if (!user && guestEventMatch) {
      const returnTo = `${route}${location.search}`;
      return <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">正在打开活动邀请…</div>}><GuestEventPreview eventId={decodeURIComponent(guestEventMatch[1])} onLogin={() => navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`)} onRegister={() => navigate(`/register?returnTo=${encodeURIComponent(returnTo)}`)} /></React.Suspense>;
    }
    if (!user) {
      const returnTo = `${route}${location.search}`;
      const loginPath = route.startsWith("/events/") ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login";
      return <Navigate to={loginPath} replace />;
    }
    return (
      <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">正在准备新的匹配体验…</div>}>
        <V2Experience
          fallbackDisplayName={user.displayName}
          weeklyStatus={user.status}
          questionnaireStatus={user.questionnaireStatus}
          weeklyMatch={user.status === "active" ? weeklyMatch : null}
          nextRefreshDate={weeklyMatch?.nextRefreshDate ?? matchState?.nextRefreshDate}
          onWeeklyToggle={() => {
            const nextStatus = user.status === "active" ? "inactive" : "active";
            void updateUser({ status: nextStatus });
            toast(nextStatus === "active" ? "每周匹配已开启" : "每周匹配已暂停；活动报名不受影响");
          }}
          onLogout={logout}
        />
      </React.Suspense>
    );
  }

  return (
    <>
      {!isQuestionnaire && <Header/>}
      <main className="flex-1">
        <Router/>
      </main>
      {!isQuestionnaire && !isCompletion && <Footer/>}
    </>
  );
}
