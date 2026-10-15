import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SITE_NAME, SITE_URL, siteUrl } from "@/lib/site";
import { ConfettiHost } from "@/components/ConfettiHost";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Quizy — AI Flashcards from Any PDF",
    template: "%s — Quizy",
  },
  description:
    "Upload a PDF and get AI-generated flashcards with spaced-repetition review. Quizy is your AI study companion.",
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: "Quizy — AI Flashcards from Any PDF",
    description:
      "Upload a PDF and get AI-generated flashcards with spaced-repetition review.",
  },
  twitter: {
    card: "summary",
    title: "Quizy — AI Flashcards from Any PDF",
    description: "Upload a PDF and get AI-generated flashcards with spaced-repetition review.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

// Syncs <html> class + colors before first paint to avoid a flash.
const themeBootstrap = `(function(){try{var t=localStorage.getItem("quizy-theme");var root=document.documentElement;var dark=t!=="light";if(!dark){root.classList.add("light");}root.style.colorScheme=dark?"dark":"light";}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-screen bg-bg font-sans">
        <ConfettiHost />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
