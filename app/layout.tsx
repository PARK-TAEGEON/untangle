import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { WorkspaceProvider } from "../components/workspace-provider";
import { THEME_INIT_SCRIPT } from "../lib/theme";

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
  title: "Untangle",
  description: "흩어진 AI 대화에서 프로젝트를 정리하고 다음 한 걸음을 이어가세요.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" className={`${pretendard.variable} ${instrumentSerif.variable}`} suppressHydrationWarning><head><script id="theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head><body><WorkspaceProvider>{children}</WorkspaceProvider></body></html>;
}
