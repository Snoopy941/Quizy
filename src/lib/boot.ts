import { ensureMigrated } from "@/lib/migrate";
import { resumeInterruptedGenerations } from "@/lib/generate";

/** Server start-up tasks (Node.js runtime only — see src/instrumentation.ts). */
export async function bootServer() {
  try {
    await ensureMigrated();
  } catch (err) {
    console.error("[boot] database migration failed:", err);
    return;
  }
  // Give the server a moment to finish booting before heavy work starts.
  setTimeout(() => {
    resumeInterruptedGenerations().catch((err) => console.error("[boot] resume failed:", err));
  }, 3000);
}
