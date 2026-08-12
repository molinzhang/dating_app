import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Heart, Home, LogOut, Menu, UserRound, X } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { cx, Pill, V2Button } from "./ui";

const NAV_ITEMS = [
  { to: "/home", label: "首页", icon: Home },
  { to: "/matches", label: "匹配", icon: Heart },
  { to: "/events", label: "活动", icon: CalendarDays },
  { to: "/profile", label: "我的资料", icon: UserRound },
] as const;

function navClass({ isActive }: { isActive: boolean }) {
  return cx(
    "flex min-h-11 items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-semibold transition-colors",
    isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  );
}

export function V2Shell({
  children,
  displayName,
  demoMode,
  onResetDemo,
  onLogout,
}: {
  children: ReactNode;
  displayName: string;
  demoMode: boolean;
  onResetDemo?: () => void;
  onLogout: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    const main = mainRef.current;
    if (!main) return;

    const focusHeading = () => {
      const heading = main.querySelector<HTMLElement>("h1");
      if (!heading) return false;
      heading.focus();
      return true;
    };

    if (focusHeading()) return;
    main.focus();

    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [location.pathname, location.search]);

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-0">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <button type="button" onClick={() => navigate("/home")} className="flex min-h-11 items-center gap-2" aria-label="返回 Common Ground 首页">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary text-white shadow-sm"><Heart size={18} fill="currentColor" /></span>
            <span className="font-display text-lg font-bold">Common Ground</span>
          </button>

          <nav className="hidden items-center gap-1 md:flex" aria-label="主要导航">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={navClass}><Icon size={17} aria-hidden="true" />{label}</NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-3 md:flex">
            {demoMode ? <Pill tone="amber">交互演示</Pill> : null}
            <button type="button" onClick={() => navigate("/profile")} className="flex min-h-11 items-center gap-2 rounded-2xl px-2 text-sm font-medium hover:bg-muted/60">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-orange-100 to-violet-100 font-bold text-primary">{displayName.slice(0, 1)}</span>
              <span className="max-w-24 truncate">{displayName}</span>
            </button>
            <button type="button" onClick={onLogout} className="flex h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground hover:bg-muted/60 hover:text-foreground" aria-label="退出登录"><LogOut size={18} /></button>
          </div>

          <button type="button" onClick={() => setMenuOpen(value => !value)} className="flex h-11 w-11 items-center justify-center rounded-2xl hover:bg-muted md:hidden" aria-label={menuOpen ? "关闭菜单" : "打开菜单"} aria-expanded={menuOpen} aria-controls="v2-mobile-account-menu">
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
        {menuOpen ? (
          <div id="v2-mobile-account-menu" className="border-t border-border bg-card px-4 py-4 md:hidden">
            <div className="mb-3 flex items-center justify-between rounded-2xl bg-muted/50 px-3 py-2">
              <span className="text-sm font-semibold">{displayName}</span>
              {demoMode ? <Pill tone="amber">演示</Pill> : null}
            </div>
            <V2Button variant="ghost" className="w-full justify-start" onClick={onLogout}><LogOut size={17} />退出登录</V2Button>
          </div>
        ) : null}
      </header>

      {demoMode ? (
        <div className="flex min-h-11 items-center justify-center border-b border-amber-200 bg-amber-50 px-4 text-center text-xs text-amber-900">
          <span>这是可交互的前端演示，新增资料与活动数据仅保存在当前浏览器。</span>
          {onResetDemo ? <button type="button" onClick={onResetDemo} className="ml-2 min-h-11 font-bold underline underline-offset-2">重置演示数据</button> : null}
        </div>
      ) : null}

      <main ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-8 outline-none sm:px-6 sm:py-10 lg:px-8">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-card/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl md:hidden" aria-label="移动端主要导航">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => cx("flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-semibold", isActive ? "text-primary" : "text-muted-foreground")}>
            <Icon size={20} aria-hidden="true" />{label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
