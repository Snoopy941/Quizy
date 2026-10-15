/** Subtle WebAudio sound effects — no asset files needed. */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem("quizy-sound") !== "0";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem("quizy-sound", on ? "1" : "0");
  } catch {}
}

function tone(freq: number, durationMs: number, gain = 0.04, type: OscillatorType = "sine", delayMs = 0) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + delayMs / 1000;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.05);
}

/** Short click when a card flips. */
export function playFlip() {
  if (!soundEnabled()) return;
  tone(660, 60, 0.03, "triangle");
}

/** Soft tick when grading. */
export function playGrade(correct: boolean) {
  if (!soundEnabled()) return;
  tone(correct ? 520 : 300, 90, 0.035, "sine");
  if (correct) tone(780, 120, 0.03, "sine", 70);
}

/** Chime when a session completes. */
export function playChime() {
  if (!soundEnabled()) return;
  tone(523.25, 180, 0.05, "sine", 0);
  tone(659.25, 180, 0.05, "sine", 140);
  tone(783.99, 320, 0.05, "sine", 280);
}
