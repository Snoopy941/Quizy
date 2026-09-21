"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { DesktopBar } from "./DesktopBar";
import { WindowControls } from "./WindowControls";

const NAV = [
  { href: "/", label: "Home", icon: "home" as const },
  { href: "/library", label: "Library", icon: "books" as const },
  { href: "/review", label: "Review", icon: "repeat" as const },
  { href: "/settings", label: "Settings", icon: "gear" as const },
];

type NavIconName = "home" | "books" | "repeat" | "gear" | "logout";

function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const cls = className ?? "h-[18px] w-[18px]";
  const common = {
    className: cls,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "home") {
    return (
      <svg {...common}>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
      </svg>
    );
  }
  if (name === "books") {
    return (
      <svg {...common}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
        <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-4.5" />
      </svg>
    );
  }
  if (name === "repeat") {
    return (
      <svg {...common}>
        <path d="m17 2 4 4-4 4" />
        <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
        <path d="m7 22-4-4 4-4" />
        <path d="M21 13v1a4 4 0 0 1-4 4H3" />
      </svg>
    );
  }
  if (name === "gear") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0-1.51 1H3z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
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
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active ? "bg-surface2 text-ink" : "text-dim hover:bg-surface2/60 hover:text-ink"
        }`}
      >
        <NavIcon name={item.icon} />
        <span>{item.label}</span>
        {item.href === "/review" && dueCount > 0 ? (
          <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-bg">
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

      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-bg px-4 pt-14 pb-6 md:flex">
        <Link href="/" className="mb-8 px-2">
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
        <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8">{children}</div>
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
