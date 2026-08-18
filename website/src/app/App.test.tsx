import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });

const ME = {
  user: {
    id: "1", displayName: "测试", email: "t@example.com", gender: "女" as const,
    status: "active" as const, questionnaireStatus: "completed" as const,
    createdAt: "2026-01-01T00:00:00Z",
    orientation: "straight" as const, seekingGender: "男" as const,
    birthDate: null, age: null, preferredAgeMin: null, preferredAgeMax: null,
  },
  questionnaire: null, archivedQuestionnaires: [], weeklyMatch: null, matchState: null,
};

// vi.mock is hoisted above module-level consts, so the spy has to be created
// inside vi.hoisted or the factory closes over an uninitialised binding.
const { updateMe, me } = vi.hoisted(() => ({
  updateMe: vi.fn(),
  me: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, me, updateMe, logout: vi.fn(async () => ({})) },
  };
});

beforeEach(() => {
  updateMe.mockReset();
  updateMe.mockImplementation(async (body: unknown) => ({ ...ME.user, ...(body as object) }));
  me.mockReset();
  me.mockImplementation(async () => ME);
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

// The header and the mobile menu both render the same nav buttons, so anything
// that appears in nav has to be queried with the *All* variants.
const settle = () => screen.findAllByRole("button", { name: /开始探索/ });

describe("landing page", () => {
  it("offers only register and login", async () => {
    renderAt("/");
    expect((await settle()).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "登录" }).length).toBeGreaterThan(0);
  });

  it("has no browser-only demo entry", async () => {
    renderAt("/");
    await settle();
    // The demo signed in a fake local user with no token; every real feature
    // silently diverged from the backend. Registration/login is the only way in.
    expect(screen.queryByRole("button", { name: /体验演示/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /直接体验/ })).not.toBeInTheDocument();
  });

  it("no longer advertises event pools, which have no backend", async () => {
    renderAt("/");
    await settle();
    expect(screen.queryByRole("button", { name: /探索活动/ })).not.toBeInTheDocument();
    expect(screen.queryByText("活动匹配")).not.toBeInTheDocument();
  });
});

describe("login page", () => {
  it("has no demo shortcut", async () => {
    renderAt("/login");
    expect((await screen.findAllByRole("button", { name: "登录" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /体验演示/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/只保存在当前浏览器/)).not.toBeInTheDocument();
  });
});

describe("register page", () => {
  it("collects the fields matching depends on", async () => {
    renderAt("/register");
    expect(await screen.findByLabelText("邮箱")).toBeInTheDocument();
    expect(screen.getByText("性别")).toBeInTheDocument();
    // Both added for age and orientation matching.
    expect(screen.getByLabelText("出生日期")).toBeInTheDocument();
    expect(screen.getByText("性取向")).toBeInTheDocument();
    for (const label of ["异性恋", "同性恋", "双性恋"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("only asks bisexual users which gender to match this round", async () => {
    renderAt("/register");
    await screen.findByLabelText("出生日期");
    // Straight/gay pin the target gender, so asking would only create rows the
    // backend rejects.
    expect(screen.queryByText("本轮希望匹配")).not.toBeInTheDocument();
    screen.getByRole("button", { name: "双性恋" }).click();
    expect(await screen.findByText("本轮希望匹配")).toBeInTheDocument();
  });
});

describe("profile fields are reachable", () => {
  const signIn = async () => {
    window.localStorage.setItem("cg_token", "test-token");
    renderAt("/settings");
    await screen.findByText("匹配设置");
  };

  it("age range shows how to set it rather than a dead 不限", async () => {
    await signIn();
    // Previously this rendered as plain text reading "不限" with no way in: the
    // only edit affordance was a 编辑 button at the top of the card, and unlike
    // 自我介绍 these fields carried no "点击编辑" hint.
    expect(screen.getByRole("button", { name: /不限，点击设置/ })).toBeInTheDocument();
  });

  it("clicking the age range opens the inputs", async () => {
    await signIn();
    fireEvent.click(screen.getByRole("button", { name: /不限，点击设置/ }));
    const inputs = await screen.findAllByPlaceholderText("不限");
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0], { target: { value: "28" } });
    fireEvent.change(inputs[1], { target: { value: "34" } });
    expect(inputs[0]).toHaveValue(28);
    expect(inputs[1]).toHaveValue(34);
  });

  it("birth date and orientation are clickable too", async () => {
    await signIn();
    expect(screen.getByRole("button", { name: /还没有填写出生日期，点击填写/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /异性恋/ }));
    // Each label must be wired to its control, or clicking the label and screen
    // readers both do nothing.
    expect(await screen.findByLabelText("出生日期")).toBeInTheDocument();
    expect(screen.getByLabelText("年龄下限")).toBeInTheDocument();
    expect(screen.getByLabelText("年龄上限")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "性取向" })).toBeInTheDocument();
  });

  it("rejects an inverted age range before it reaches the API", async () => {
    await signIn();
    fireEvent.click(screen.getByRole("button", { name: /不限，点击设置/ }));
    const inputs = await screen.findAllByPlaceholderText("不限");
    fireEvent.change(inputs[0], { target: { value: "40" } });
    fireEvent.change(inputs[1], { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateMe).not.toHaveBeenCalled());
  });

  it("says the change applies at the next pairing, not this week", async () => {
    await signIn();
    fireEvent.click(screen.getByRole("button", { name: /不限，点击设置/ }));
    const inputs = await screen.findAllByPlaceholderText("不限");
    fireEvent.change(inputs[0], { target: { value: "30" } });
    fireEvent.change(inputs[1], { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    // Saving used to re-pair immediately; it no longer does, so the toast has to
    // say so or the unchanged recommendation reads as a bug.
    expect(await screen.findByText(/下一轮配对时生效/)).toBeInTheDocument();
  });

  it("saves the age range through the API", async () => {
    await signIn();
    fireEvent.click(screen.getByRole("button", { name: /不限，点击设置/ }));
    const inputs = await screen.findAllByPlaceholderText("不限");
    fireEvent.change(inputs[0], { target: { value: "28" } });
    fireEvent.change(inputs[1], { target: { value: "34" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateMe).toHaveBeenCalledWith(
      expect.objectContaining({ preferredAgeMin: 28, preferredAgeMax: 34 }),
    ));
  });
});

describe("missing birth date", () => {
  it("warns an account that has none, because age filters silently exclude it", async () => {
    window.localStorage.setItem("cg_token", "test-token");
    renderAt("/dashboard");
    expect(await screen.findByText("请补上出生日期")).toBeInTheDocument();
    expect(screen.getByText(/匹配不到你/)).toBeInTheDocument();
  });

  it("does not nag an account that has one", async () => {
    me.mockImplementation(async () => ({
      ...ME,
      user: { ...ME.user, birthDate: "1996-08-16", age: 30 },
    }));
    window.localStorage.setItem("cg_token", "test-token");
    renderAt("/dashboard");
    await screen.findByText(/你好/);
    expect(screen.queryByText("请补上出生日期")).not.toBeInTheDocument();
  });
});

describe("contact details", () => {
  const MATCH = {
    id: "1",
    matchedUser: { displayName: "林晓雨", photoUrl: null },
    contactsRevealed: false,
    partnerSignal: "unseen" as const,
    compatibilitySummary: "你们在3个核心维度上高度接近",
    sharedInterests: [],
    dimensionComparisons: [
      { dimension: "探索开放 ↔ 稳定守序", userScore: 3, matchScore: 3.2, category: "close" as const },
    ],
    recommendationDate: "2026-08-18",
    nextRefreshDate: "2026-08-23",
    responseStatus: "viewed" as const,
  };

  const openMatch = async (over: Record<string, unknown> = {}) => {
    me.mockImplementation(async () => ({ ...ME, weeklyMatch: { ...MATCH, ...over } }));
    window.localStorage.setItem("cg_token", "test-token");
    renderAt("/matches/current");
    await screen.findByText("联系方式");
  };

  it("explains the rule instead of showing contacts", async () => {
    await openMatch();
    expect(screen.getByText("当双方都感兴趣的时候，会显示联系方式。")).toBeInTheDocument();
    expect(screen.queryByText("邮箱")).not.toBeInTheDocument();
    expect(screen.queryByText("微信")).not.toBeInTheDocument();
  });

  it("tells you it is waiting once you have said yes", async () => {
    await openMatch({ responseStatus: "interested" });
    expect(screen.getByText(/正在等 林晓雨 的回应/)).toBeInTheDocument();
  });

  it("shows contacts once both sides are interested", async () => {
    await openMatch({
      responseStatus: "interested",
      partnerSignal: "interested",
      contactsRevealed: true,
      matchedUser: { displayName: "林晓雨", email: "lin@example.com", wechat: "wx_lin" },
    });
    expect(screen.getByText("lin@example.com")).toBeInTheDocument();
    expect(screen.getByText("wx_lin")).toBeInTheDocument();
    expect(screen.queryByText("当双方都感兴趣的时候，会显示联系方式。")).not.toBeInTheDocument();
  });

  it("does not leak contacts the server withheld", async () => {
    // contactsRevealed false while the fields are absent is the real payload
    // shape; the UI must not render an empty contact block either.
    await openMatch({ responseStatus: "interested", partnerSignal: "interested" });
    expect(screen.getByText("当双方都感兴趣的时候，会显示联系方式。")).toBeInTheDocument();
  });
});

describe("protected routes", () => {
  it("sends a signed-out visitor to login instead of rendering blank", async () => {
    renderAt("/settings");
    expect((await screen.findAllByRole("button", { name: "登录" })).length).toBeGreaterThan(0);
    expect(screen.queryByText("匹配设置")).not.toBeInTheDocument();
  });
});
