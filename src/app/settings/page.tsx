"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { setSoundEnabled, soundEnabled } from "@/lib/sound";
import { fmtDate } from "@/lib/client";
import { AiSettings } from "./AiSettings";
import { DownloadsSettings } from "./DownloadsSettings";
import { SecuritySettings } from "./SecuritySettings";
import { AboutSettings } from "./AboutSettings";
import { PhoneSettings } from "./PhoneSettings";
import { Icon } from "@/components/Icon";

interface Me {
  user: { id: string; email: string; name: string; createdAt: string };
  settings: {
    theme: string;
    defaultTimerMinutes: number;
    cardDensity: string;
    soundEnabled: boolean;
    readAloud?: boolean;
  };
}

const TIMER_OPTIONS = [5, 10, 15, 30, 60];

export default function SettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [saved, setSaved] = useState(false);
  const [sound, setSound] = useState(true);

  useEffect(() => {
    api<Me>("/api/me")
      .then(setMe)
      .catch(() => {});
    setSound(soundEnabled());
  }, []);

  const patch = async (settings: Record<string, unknown>) => {
    try {
      const res = await api<Me>("/api/me", { method: "PATCH", body: JSON.stringify({ settings }) });
      setMe(res);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {}
  };

  const applyTheme = (theme: "dark" | "light") => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("quizy-theme", theme);
    void patch({ theme });
  };

  if (!me) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-9 w-40" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="stagger mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        {saved ? <span className="badge anim-pop"><Icon name="check" /> Saved</span> : null}
      </div>

      {/* Account */}
      <section className="card p-6">
        <h2 className="font-semibold">Account</h2>
        <div className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-dim">Name</span>
            <span>{me.user.name || "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-dim">Email</span>
            <span>{me.user.email}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-dim">Member since</span>
            <span>{fmtDate(me.user.createdAt)}</span>
          </div>
        </div>
      </section>

      <AiSettings />
      <DownloadsSettings />

      {/* Appearance */}
      <section className="card p-6">
        <h2 className="font-semibold">Appearance</h2>
        <p className="mt-1 text-xs text-dim">Quizy is dark by default — flip it if you study in daylight.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {(["dark", "light"] as const).map((t) => (
            <button
              key={t}
              onClick={() => applyTheme(t)}
              className={`rounded-xl border px-4 py-3 text-sm font-medium capitalize transition-colors ${
                (document.documentElement.classList.contains("light") ? "light" : "dark") === t
                  ? "border-accent bg-surface2"
                  : "border-line hover:border-faint"
              }`}
            >
              <span className="inline-flex items-center gap-2"><Icon name={t === "dark" ? "moon" : "sun"} /> {t === "dark" ? "Dark" : "Light"}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Study defaults */}
      <section className="card p-6">
        <h2 className="font-semibold">Study defaults</h2>

        <div className="mt-4">
          <p className="label">Default timer length (timed review)</p>
          <div className="grid grid-cols-5 gap-2">
            {TIMER_OPTIONS.map((m) => (
              <button
                key={m}
                onClick={() => void patch({ defaultTimerMinutes: m })}
                className={`rounded-lg border px-2 py-2 text-sm font-semibold tabular-nums ${
                  me.settings.defaultTimerMinutes === m ? "border-accent bg-surface2" : "border-line text-dim hover:text-ink"
                }`}
              >
                {m}m
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <p className="label">Card density (cards per section when generating)</p>
          <div className="grid grid-cols-3 gap-2">
            {(["low", "medium", "high"] as const).map((d) => (
              <button
                key={d}
                onClick={() => void patch({ cardDensity: d })}
                className={`rounded-lg border px-2 py-2 text-sm font-medium capitalize ${
                  me.settings.cardDensity === d ? "border-accent bg-surface2" : "border-line text-dim hover:text-ink"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-faint">Low about 3, Medium about 4, High about 5 cards per section of your document.</p>
        </div>
      </section>

      {/* Read aloud */}
      <section className="card flex items-center justify-between p-6">
        <div>
          <h2 className="font-semibold">Read cards aloud</h2>
          <p className="mt-1 text-xs text-dim">Speaks each question, then the answer when you flip — using your computer&apos;s voices. Press R anytime.</p>
        </div>
        <button
          onClick={() => void patch({ readAloud: !me.settings.readAloud })}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
            me.settings.readAloud ? "border-accent bg-accent" : "border-line bg-surface2"
          }`}
          aria-label="Toggle read aloud"
        >
          <span
            className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all ${
              me.settings.readAloud ? "left-6 bg-bg" : "left-0.5 bg-faint"
            }`}
          />
        </button>
      </section>

      {/* Sound */}
      <section className="card flex items-center justify-between p-6">
        <div>
          <h2 className="font-semibold">Sound effects</h2>
          <p className="mt-1 text-xs text-dim">Subtle click on card flip, chime on session complete.</p>
        </div>
        <button
          onClick={() => {
            const next = !sound;
            setSound(next);
            setSoundEnabled(next);
            void patch({ soundEnabled: next });
          }}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors ${
            sound ? "border-accent bg-accent" : "border-line bg-surface2"
          }`}
          aria-label="Toggle sound effects"
        >
          <span
            className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all ${
              sound ? "left-6 bg-bg" : "left-0.5 bg-faint"
            }`}
          />
        </button>
      </section>

      <PhoneSettings />
      <SecuritySettings />
      <AboutSettings />

      <p className="pb-4 text-center text-xs text-dim">Quizy · quizy.study</p>
    </div>
  );
}
