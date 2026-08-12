import { getToken } from "../../lib/api";
import type {
  CreatePoolInput,
  CriteriaMode,
  DatingBootstrap,
  DatingService,
  EntityId,
  JoinPoolInput,
  ListPoolsQuery,
  MatchCriteria,
  MatchRun,
  MatchView,
  OrganizerRunReport,
  PoolDetails,
  PoolMembership,
  PoolSummary,
  UpdatePoolInput,
  UpdateProfileInput,
  MatchProfile,
} from "./domain";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

interface ApiErrorEnvelope {
  error?: { code?: string; message?: string };
  detail?: string | Array<{ msg?: string }>;
}

function idempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `cg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null) as ApiErrorEnvelope | T | null;
  if (!response.ok) {
    const errorPayload = payload as ApiErrorEnvelope | null;
    const validation = Array.isArray(errorPayload?.detail)
      ? errorPayload.detail.map(item => item.msg).filter(Boolean).join("；")
      : undefined;
    throw new Error(errorPayload?.error?.message || validation || (typeof errorPayload?.detail === "string" ? errorPayload.detail : `请求失败（${response.status}）`));
  }
  return payload as T;
}

function json(method: string, body?: unknown, idempotent = false): RequestInit {
  const headers: Record<string, string> = {};
  if (idempotent) headers["Idempotency-Key"] = idempotencyKey();
  return { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
}

class ApiDatingService implements DatingService {
  async bootstrap(): Promise<DatingBootstrap> {
    const [currentUser, criteria, pools, matches] = await Promise.all([
      this.getCurrentProfile(), this.getCriteria(), this.listPools(), this.listMatches(),
    ]);
    return { currentUser, criteria, pools, matches };
  }
  getCurrentProfile() { return request<MatchProfile>("/api/me/profile"); }
  saveProfile(patch: UpdateProfileInput) { return request<MatchProfile>("/api/me/profile", json("PUT", patch)); }
  getCriteria() { return request<MatchCriteria>("/api/me/match-criteria"); }
  saveCriteria(criteria: MatchCriteria) { return request<MatchCriteria>("/api/me/match-criteria", json("PUT", criteria)); }

  listPools(query: ListPoolsQuery = {}) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => { if (value) params.set(key, value); });
    const suffix = params.size ? `?${params.toString()}` : "";
    return request<PoolSummary[]>(`/api/events${suffix}`);
  }

  getPool(poolIdOrSlug: EntityId) { return request<PoolDetails>(`/api/events/${encodeURIComponent(poolIdOrSlug)}`); }
  createPool(input: CreatePoolInput) { return request<PoolDetails>("/api/events", json("POST", input, true)); }

  async updatePool(poolId: EntityId, input: UpdatePoolInput) {
    const { status, ...patch } = input;
    let pool = Object.keys(patch).length
      ? await request<PoolDetails>(`/api/events/${encodeURIComponent(poolId)}`, json("PATCH", patch))
      : await this.getPool(poolId);
    if (status === "open") pool = await request<PoolDetails>(`/api/events/${encodeURIComponent(poolId)}/publish`, json("POST", undefined, true));
    if (status === "archived") pool = await request<PoolDetails>(`/api/events/${encodeURIComponent(poolId)}/archive`, json("POST", undefined, true));
    return pool;
  }

  joinPool(poolId: EntityId, input: JoinPoolInput = {}) {
    return request<PoolMembership>(`/api/events/${encodeURIComponent(poolId)}/registration`, json("POST", input, true));
  }
  savePoolRegistration(poolId: EntityId, answers: PoolMembership["registrationAnswers"]) {
    return request<PoolMembership>(`/api/events/${encodeURIComponent(poolId)}/registration`, json("PUT", { registrationAnswers: answers }));
  }
  setPoolCriteria(poolId: EntityId, criteriaMode: CriteriaMode, criteriaOverride?: MatchCriteria) {
    return request<PoolMembership>(`/api/events/${encodeURIComponent(poolId)}/registration/match-criteria`, json("PUT", { criteriaMode, criteriaOverride }));
  }
  confirmPoolParticipation(poolId: EntityId) {
    return request<PoolMembership>(`/api/events/${encodeURIComponent(poolId)}/registration/confirm`, json("POST", undefined, true));
  }
  leavePool(poolId: EntityId) {
    return request<void>(`/api/events/${encodeURIComponent(poolId)}/registration`, { method: "DELETE" });
  }
  closePoolRegistration(poolId: EntityId) {
    return request<PoolDetails>(`/api/events/${encodeURIComponent(poolId)}/close-registration`, json("POST", undefined, true));
  }
  runPoolMatching(poolId: EntityId) {
    return request<MatchRun>(`/api/events/${encodeURIComponent(poolId)}/match-runs`, json("POST", {}, true));
  }
  revealMatchRun(runId: EntityId) {
    return request<MatchRun>(`/api/match-runs/${encodeURIComponent(runId)}/reveal`, json("POST", undefined, true));
  }
  getOrganizerRunReport(runId: EntityId) {
    return request<OrganizerRunReport>(`/api/match-runs/${encodeURIComponent(runId)}/organizer-report`);
  }
  listMatches() { return request<MatchView[]>("/api/matches"); }
  markMatchViewed(matchId: EntityId) {
    return request<MatchView>(`/api/matches/${encodeURIComponent(matchId)}/view`, json("POST", undefined, true));
  }
  respondToMatch(matchId: EntityId, response: "interested" | "passed") {
    return request<MatchView>(`/api/matches/${encodeURIComponent(matchId)}/response`, json("PUT", { response }));
  }
  blockUser(userId: EntityId) {
    return request<void>(`/api/users/${encodeURIComponent(userId)}/block`, json("POST", undefined, true));
  }
  resetDemo() { return this.bootstrap(); }
  subscribe() { return () => {}; }
}

export function createApiDatingService(): DatingService {
  return new ApiDatingService();
}
