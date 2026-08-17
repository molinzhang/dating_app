import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import App from "./App";

Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });

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

describe("protected routes", () => {
  it("sends a signed-out visitor to login instead of rendering blank", async () => {
    renderAt("/settings");
    expect((await screen.findAllByRole("button", { name: "登录" })).length).toBeGreaterThan(0);
    expect(screen.queryByText("匹配设置")).not.toBeInTheDocument();
  });
});
