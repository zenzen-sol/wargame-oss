import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ToasterProvider } from "@/components/toaster-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ShapeProvider } from "@/lib/shape-context";
import { cn } from "@/lib/utils";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-display",
});

const APP_URL = "https://app.wargame.esq";
const APP_TITLE = "Wargame.esq";
const APP_DESCRIPTION = "Simulated negotiations for business contracts.";

// Saas-side metadata. The app is behind sign-in, so the whole
// origin is set to `noindex` — we don't want sign-in or any of the
// authed pages showing up in search. OG/Twitter cards still get a
// reasonable rendering when someone shares the URL in chat, and the
// shared opengraph-image.tsx + twitter-image.tsx handle the graphic.
export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: APP_TITLE,
    template: "%s — Wargame",
  },
  description: APP_DESCRIPTION,
  applicationName: "Wargame",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
  openGraph: {
    type: "website",
    url: APP_URL,
    siteName: "Wargame",
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@wargame_esq",
    creator: "@wargame_esq",
    title: APP_TITLE,
    description: APP_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={cn(
        "font-sans",
        geist.variable,
        geistMono.variable,
        sourceSerif.variable,
      )}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground antialiased">
        <ThemeProvider>
          <ShapeProvider defaultShape="rounded">
            <TooltipProvider>{children}</TooltipProvider>
          </ShapeProvider>
          <ToasterProvider />
        </ThemeProvider>
      </body>
    </html>
  );
}
