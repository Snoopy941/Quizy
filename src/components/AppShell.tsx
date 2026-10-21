"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { DesktopBar } from "./DesktopBar";
import { WindowControls } from "./WindowControls";
import { UpdateBanner } from "./UpdateBanner";
import { Icon } from "./Icon";

const NAV = [
  { href: "/", label: "Home", icon: "home" as const },
  { href: "/library", label: "Library", icon: "books" as const },
  { href: "/review", label: "Review", icon: "repeat" as const },
  { href: "/settings", label: "Settings", icon: "gear" as const },
];

type NavIconName = "home" | "books" | "repeat" | "gear" | "logout";

function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  return <Icon name={name} className={className ?? "h-[18px] w-[18px]"} />;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [dueCount, setDueCount] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const isChromeless =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/forgot") ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/deck/") && pathname.endsWith("/study");

  const fetchDue = useCallback(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.dueToday === "number") setDueCount(d.dueToday);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isChromeless) return;
    fetchDue();
  }, [pathname, isChromeless, fetchDue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  if (isChromeless) return <>{children}</>;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const navItem = (item: (typeof NAV)[number]) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
          active ? "bg-surface2 text-ink" : "text-dim hover:translate-x-0.5 hover:bg-surface2/60 hover:text-ink"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-ink transition-all duration-300 ${
            active ? "opacity-100" : "scale-y-0 opacity-0"
          }`}
        />
        <span className="transition-transform duration-300 group-hover:scale-110">
          <NavIcon name={item.icon} />
        </span>
        <span>{item.label}</span>
        {item.href === "/review" && dueCount > 0 ? (
          <span className="anim-pop ml-auto rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-bg">
            {dueCount}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen">
      {/* Frameless-window drag strip + window controls (desktop shell only) */}
      <DesktopBar />
      <UpdateBanner />

      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-bg px-4 pt-14 pb-6 md:flex">
        <Link href="/" className="logo-link mb-8 px-2">
          <Logo />
        </Link>
        <nav className="flex flex-1 flex-col gap-1">{NAV.map(navItem)}</nav>
        <div className="mt-6 space-y-1 border-t border-line pt-4">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-sm text-dim">Theme</span>
            <ThemeToggle />
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-dim hover:bg-surface2/60 hover:text-ink"
          >
            <NavIcon name="logout" />
            Sign out
          </button>
          <p className="px-3 pt-2 text-xs text-dim">quizy.study</p>
        </div>
      </aside>

      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-bg/90 px-4 pt-6 backdrop-blur md:hidden">
        <Link href="/">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <WindowControls />
        </div>
      </div>

      <main className="min-w-0 flex-1 pb-24 pt-16 md:pb-10 md:pt-10">
        <div key={pathname} className="page-in mx-auto w-full max-w-5xl px-4 py-6 md:px-8">
          {children}
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-line bg-bg/95 backdrop-blur md:hidden">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${
              isActive(item.href) ? "text-ink" : "text-faint"
            }`}
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
            {item.href === "/review" && dueCount > 0 ? (
              <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-accent" />
            ) : null}
          </Link>
        ))}
      </nav>

      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
