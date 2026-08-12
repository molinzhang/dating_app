import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });

describe("App demo session", () => {
  it("enters the browser-only demo and preserves an event invitation return path", async () => {
    render(
      <MemoryRouter initialEntries={["/login?returnTo=%2Fevents%2Fpool-bay-walk"]}>
        <App />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "无需账号，直接体验演示" }));

    expect(await screen.findByRole("heading", { name: "湾区夏日晚风散步" })).toBeInTheDocument();
    expect(window.localStorage.getItem("cg_v2_demo_session")).toBe("1");
  });

  it("restores a demo session on a fresh render", async () => {
    window.localStorage.setItem("cg_v2_demo_session", "1");

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "你好，知夏" })).toBeInTheDocument();
    expect(screen.getByText("这是可交互的前端演示，新增资料与活动数据仅保存在当前浏览器。")).toBeInTheDocument();
  });
});
