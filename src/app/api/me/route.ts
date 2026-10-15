import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId, unauthorized } from "@/lib/session";

/** Current user + settings. Ensures a settings row exists. */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, createdAt: true, settings: true },
  });
  if (!user) return unauthorized();

  const settings = user.settings ?? (await prisma.userSettings.create({ data: { userId } }));
  return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt }, settings });
}

/** Update profile (name) and/or settings. */
export async function PATCH(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return unauthorized();

  const body = await req.json().catch(() => ({}));

  const userUpdate: { name?: string } = {};
  if (typeof body.name === "string") userUpdate.name = body.name.trim().slice(0, 80);

  const settingsUpdate: {
    theme?: string;
    defaultTimerMinutes?: number;
    cardDensity?: string;
    soundEnabled?: boolean;
  } = {};
  if (body.settings?.theme === "dark" || body.settings?.theme === "light") {
    settingsUpdate.theme = body.settings.theme;
  }
  if ([5, 10, 15, 30, 60].includes(body.settings?.defaultTimerMinutes)) {
    settingsUpdate.defaultTimerMinutes = body.settings.defaultTimerMinutes;
  }
  if (["low", "medium", "high"].includes(body.settings?.cardDensity)) {
    settingsUpdate.cardDensity = body.settings.cardDensity;
  }
  if (typeof body.settings?.soundEnabled === "boolean") {
    settingsUpdate.soundEnabled = body.settings.soundEnabled;
  }

  await prisma.userSettings.upsert({
    where: { userId },
    update: settingsUpdate,
    create: { userId, ...settingsUpdate },
  });
  if (Object.keys(userUpdate).length > 0) {
    await prisma.user.update({ where: { id: userId }, data: userUpdate });
  }

  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  return NextResponse.json({ ok: true, user, settings });
}
