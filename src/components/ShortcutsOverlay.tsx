"use client";

import { AnimatePresence, motion } from "framer-motion";

const SHORTCUTS: [string, string][] = [
  ["Space", "Flip / show the answer"],
  ["1–4", "Pick an answer option (before flipping; 1 = True, 2 = False)"],
  ["Enter", "Check a typed answer"],
  ["1", "Grade: Again"],
  ["2", "Grade: Hard"],
  ["3", "Grade: Good"],
  ["4", "Grade: Easy"],
  ["E", "Explain this card (after flipping)"],
  ["R", "Read the card aloud"],
  ["V", "Answer by voice (typed-answer cards)"],
  ["S", "Skip card (no grade)"],
  ["F", "Toggle focus mode"],
  ["?", "Show / hide this help"],
];

export function ShortcutsOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-lg font-bold">Keyboard shortcuts</h3>
            <ul className="space-y-2.5">
              {SHORTCUTS.map(([key, desc]) => (
                <li key={key} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-dim">{desc}</span>
                  <kbd className="rounded-md border border-line bg-surface2 px-2 py-1 font-mono text-xs text-ink">
                    {key}
                  </kbd>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-xs text-faint">Press ? or click anywhere to close</p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
