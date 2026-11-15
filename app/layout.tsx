import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./card-motion.css";
import "./topic-refinements.css";
import "./history-backup.css";
import "./page-polish.css";
import "./welcome.css";
import "./focus-card.css";
import "./preferences.css";
import "./today-threads.css";
import "./topic-search.css";
import "./today-guide.css";
import "./not-found.css";
import { WorkspaceProvider } from "../components/workspace-provider";
import { AppTransitions } from "../components/app-transitions";
import { THEME_INIT_SCRIPT } from "../lib/theme";
import { PREFERENCES_INIT_SCRIPT } from "../lib/preferences";

const pretendard = localFont({
  src: "../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

const instrumentSerif = localFont({
  src: [
    { path: "../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || "untangle-self-mu.vercel.app"}`),
  title: { default: "Untangle — One thread at a time.", template: "%s · Untangle" },
  description: "Every knot gives way, one thread at a time.",
  applicationName: "Untangle",
  openGraph: { title: "Untangle — One thread at a time.", description: "Every knot gives way, one thread at a time.", siteName: "Untangle", locale: "ko_KR", type: "website" },
  twitter: { card: "summary_large_image", title: "Untangle — One thread at a time.", description: "Every knot gives way, one thread at a time." },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" className={`${pretendard.variable} ${instrumentSerif.variable}`} suppressHydrationWarning><head><script id="theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /><script id="preferences-init" dangerouslySetInnerHTML={{ __html: PREFERENCES_INIT_SCRIPT }} /></head><body><WorkspaceProvider><AppTransitions>{children}</AppTransitions></WorkspaceProvider></body></html>;
}
