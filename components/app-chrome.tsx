"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Brand } from "./ui";
import { useWorkspace } from "./workspace-provider";
import { ThemeToggle } from "./theme-toggle";
import { BackupMenu } from "./backup-menu";

export function AppChrome({ active, children, onBeforeSampleExit, onSampleExitFailed }: {
  active: "today" | "topics" | "done";
  children: ReactNode;
  onBeforeSampleExit?: () => void;
  onSampleExitFailed?: () => void;
}) {
  const { workspace, mode, error, exitSample } = useWorkspace();
  const router = useRouter();
  return <div className="app-shell app-shell-pages">
    <header className="app-header"><Brand /><nav className="app-nav" aria-label="주요 화면"><Link href="/" aria-current={active === "today" ? "page" : undefined}>오늘</Link><Link href="/topics" aria-current={active === "topics" ? "page" : undefined}>토픽</Link><Link href="/done" aria-current={active === "done" ? "page" : undefined}>지나온 걸음</Link></nav><span className="privacy-note">내용은 이 브라우저에만 저장돼요.</span><ThemeToggle /><BackupMenu /><Link href="/start" className="button button-secondary">다시 가져오기</Link></header>
    {mode === "sample" && <section className="sample-banner" aria-label="샘플 모드"><div className="sample-banner-copy"><strong>샘플 데이터로 보는 중</strong><p>{workspace?.sample?.persona === "student" ? "대학생" : "게임 개발자"}의 가상 기록 · 예시 기준일 {workspace?.sample?.baseline_date}</p></div><button type="button" className="button button-secondary" onClick={() => {
      onBeforeSampleExit?.();
      if (exitSample()) router.push("/start"); else onSampleExitFailed?.();
    }}>내 기록으로 시작하기</button></section>}
    {error && <div className="app-error" role="alert">{error}</div>}
    {children}
  </div>;
}
