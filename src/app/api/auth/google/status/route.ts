import { NextResponse } from "next/server";
import { loadGoogleConfig } from "@/lib/google";

/** GET — whether "Continue with Google" is set up in this copy of Quizy. */
export async function GET() {
  return NextResponse.json({ enabled: Boolean(loadGoogleConfig()) });
}
