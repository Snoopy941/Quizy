import Image from "next/image";

export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  const badge = size === "lg" ? "h-14 w-14" : "h-9 w-9";
  const text = size === "lg" ? "text-4xl" : "text-xl";
  return (
    <span className={`inline-flex items-center gap-2.5 font-extrabold tracking-tight ${text}`}>
      <span
        className={`inline-flex ${badge} items-center justify-center rounded-xl bg-black ring-1 ring-white/15 overflow-hidden dark:bg-neutral-900`}
      >
        <Image
          src="/brand/quizy-logo.png"
          alt=""
          width={size === "lg" ? 44 : 28}
          height={size === "lg" ? 44 : 28}
          priority
          className="h-full w-full object-contain p-0.5"
        />
      </span>
      <span>Quizy</span>
    </span>
  );
}
