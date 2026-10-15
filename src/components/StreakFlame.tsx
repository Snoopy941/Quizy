export function StreakFlame({ streak }: { streak: number }) {
  if (streak <= 0) {
    return (
      <div className="badge shrink-0" title="Study today to start your streak">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2c1 4-4 5.5-4 10a4 4 0 0 0 8 0c0-1.5-.5-2.5-1-3.5-.3 1-.9 1.6-1.8 2 .4-2.8-.7-6.5-1.2-8.5z" />
        </svg>
        <span className="text-faint">no streak</span>
      </div>
    );
  }
  return (
    <div className="badge shrink-0" title={`${streak}-day study streak`}>
      <svg className="h-3.5 w-3.5 animate-pulseSoft" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2c1 4-4 5.5-4 10a4 4 0 0 0 8 0c0-1.5-.5-2.5-1-3.5-.3 1-.9 1.6-1.8 2 .4-2.8-.7-6.5-1.2-8.5z" />
      </svg>
      <span className="font-semibold tabular-nums">{streak} day{streak === 1 ? "" : "s"}</span>
    </div>
  );
}
