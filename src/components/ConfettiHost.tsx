"use client";

import { useEffect } from "react";
import confetti from "canvas-confetti";

declare global {
  interface Window {
    __quizyConfetti?: (opts?: { burst?: boolean }) => void;
  }
}

function fire(opts?: { burst?: boolean }) {
  if (opts?.burst) {
    // Easter-egg burst: bigger, from both corners
    confetti({ particleCount: 90, spread: 70, origin: { x: 0.2, y: 0.7 }, colors: ["#ffffff", "#a3a3a3", "#525252"] });
    confetti({ particleCount: 90, spread: 70, origin: { x: 0.8, y: 0.7 }, colors: ["#ffffff", "#a3a3a3", "#525252"] });
  } else {
    confetti({
      particleCount: 160,
      spread: 100,
      origin: { y: 0.6 },
      colors: ["#ffffff", "#d4d4d4", "#a3a3a3", "#525252"],
    });
  }
}

export function ConfettiHost() {
  useEffect(() => {
    window.__quizyConfetti = fire;
    return () => {
      delete window.__quizyConfetti;
    };
  }, []);
  return null;
}

/** Fire the session-complete celebration. */
export function celebrate(opts?: { burst?: boolean }) {
  if (typeof window !== "undefined") window.__quizyConfetti?.(opts);
}
