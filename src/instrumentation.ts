/**
 * Runs once when the Next.js server starts: applies database migrations
 * (the desktop build has no Prisma CLI) and resumes card generation that a
 * restart interrupted.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootServer } = await import("./lib/boot");
    await bootServer();
  }
}
