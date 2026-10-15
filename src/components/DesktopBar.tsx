"use client";

import { useEffect, useState } from "react";
import { WindowControls } from "./WindowControls";

/**
 * Fixed top strip for the frameless desktop window: drag-to-move region on
 * the left/center, minimize/maximize/close on the right. Renders nothing in
 * a normal browser.
 */
export function DesktopBar() {
  const [inShell, setInShell] = useState(false);

  useEffect(() => {
    if (window.quizyDesktop) setInShell(true);
  }, []);

  if (!inShell) return null;

  return (
    <div
      className="app-drag fixed inset-x-0 top-0 z-[60] flex h-10 items-center justify-end"
    >
      <div className="no-drag h-full">
        <WindowControls />
      </div>
    </div>
  );
}

/** True once we know we're inside the desktop shell (client only). */
export function useInDesktopShell() {
  const [inShell, setInShell] = useState(false);
  useEffect(() => {
    if (window.quizyDesktop) setInShell(true);
  }, []);
  return inShell;
}
