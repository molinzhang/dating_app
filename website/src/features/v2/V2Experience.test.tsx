import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { V2Experience } from "./V2Experience";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <V2Experience
        fallbackDisplayName="演示用户"
        demoMode
        weeklyStatus="active"
        questionnaireStatus="completed"
        weeklyMatch={null}
        nextRefreshDate={null}
        onWeeklyToggle={vi.fn()}
        onLogout={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("V2Experience routing", () => {
  it("restores an event invitation deep link after a fresh render", async () => {
    renderAt("/events/bay-area-sunset-walk");

    expect(await screen.findByRole("heading", { name: "湾区夏日晚风散步" })).toBeInTheDocument();
    expect(screen.getByText("这是可交互的前端演示，新增资料与活动数据仅保存在当前浏览器。")).toBeInTheDocument();
  });

  it("opens the criteria tab directly from a query link", async () => {
    renderAt("/profile?tab=criteria");

    expect(await screen.findByRole("heading", { name: "始终生效" })).toBeInTheDocument();
    expect(screen.getByText("系统不会越过你标记为“必须”的条件。")).toBeInTheDocument();
  });

  it("renders all four desktop and mobile navigation destinations", async () => {
    renderAt("/home");

    expect(await screen.findByRole("heading", { name: /你好，/ })).toBeInTheDocument();
    for (const label of ["首页", "匹配", "活动", "我的资料"]) {
      expect(screen.getAllByRole("link", { name: label })).toHaveLength(2);
    }
  });
});
