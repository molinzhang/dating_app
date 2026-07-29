const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || "http://localhost:8000";
const TOKEN_KEY = "cg_token";

type MatchPreference = "any" | "same" | "different";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function messageFromDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  // FastAPI validation errors come back as an array of {loc, msg, type}.
  if (Array.isArray(detail)) {
    const msgs = detail.map((d: any) => d?.msg).filter(Boolean);
    if (msgs.length) return msgs.join("；");
  }
  return fallback;
}

async function request(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = { ...(options.headers as Record<string, string> | undefined) };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch {
    // fetch only rejects on network-level failure (server unreachable, DNS,
    // CORS). The API sleeps after inactivity on its free tier and takes ~30s
    // to wake, so retry once with a pause before giving up.
    await new Promise(r => setTimeout(r, 3000));
    try {
      res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
    } catch {
      throw new ApiError(0, "连不上服务器。服务器可能正在唤醒，请等约 30 秒后重试。");
    }
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, messageFromDetail(data?.detail, `请求失败（${res.status}）`));
  }
  return data;
}

export const api = {
  register: (body: { email: string; password: string; gender: "男" | "女"; wechat?: string; instagram?: string; xiaohongshu?: string; linkedin?: string }) =>
    request("/api/register", { method: "POST", body: JSON.stringify(body) }),
  login: (body: { email: string; password: string }) =>
    request("/api/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request("/api/logout", { method: "POST" }),
  me: () => request("/api/me"),
  updateMe: (body: { status?: string; bio?: string; matchPreference?: string }) =>
    request("/api/me", { method: "PATCH", body: JSON.stringify(body) }),
  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request("/api/me/photo", { method: "POST", body: form });
  },
  saveAnswers: (body: {
    answers: Record<number, number>;
    matchPreferences: Record<number, MatchPreference>;
    currentSection: number;
  }) =>
    request("/api/questionnaire", { method: "PUT", body: JSON.stringify(body) }),
  submitQuestionnaire: (body: {
    importantQuestionIds: number[];
    matchPreferences: Record<number, MatchPreference>;
  }) =>
    request("/api/questionnaire/submit", { method: "POST", body: JSON.stringify(body) }),
  retakeQuestionnaire: () => request("/api/questionnaire/retake", { method: "POST" }),
  questionnaireArchive: () => request("/api/questionnaire/archive"),
  matchCurrent: () => request("/api/match/current"),
  matchResponse: (status: string) => request("/api/match/response", { method: "POST", body: JSON.stringify({ status }) }),
  matchDislike: () => request("/api/match/dislike", { method: "POST" }),
};

// Backend photo paths come back as server-relative ("/api/photos/xxx"); the
// frontend dev server and API run on different ports, so they need the API
// origin prefixed. Everything else (demo images from the frontend's own
// public/ dir, absolute/data/blob URLs) is passed through untouched.
export function resolvePhotoUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (!path.startsWith("/api/")) return path;
  return `${API_BASE_URL}${path}`;
}
