import type { Metadata } from "next";
import { ShareClient } from "./ShareClient";
import { SITE_NAME, siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const url = siteUrl(`/share/${shareId}`);
  return {
    title: "Shared deck",
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      url,
      title: "A deck on Quizy — AI Flashcards from Any PDF",
      description: "Browse this flashcard deck shared from Quizy.",
    },
  };
}

export default async function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  return <ShareClient shareId={shareId} />;
}
