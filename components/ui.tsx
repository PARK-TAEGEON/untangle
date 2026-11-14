import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export function topicThreadStyle(themeIndex = -1): CSSProperties {
  return { "--thread-current": themeIndex < 0 ? "var(--color-ink)" : `var(--thread-${themeIndex % 8 + 1})` } as CSSProperties;
}

const LOGO = "M2 14c3-10 9 8 5-2s8-9 7 0 6 6 5 0c-1-5 4-4 5 0h18";
const CARD = "M2 16c4-14 12 10 7-3s11-12 9 1 8 8 7 0c-1-7 6-6 7 0 1 5 6 2 8 0h108";
const TANGLE = "M14 60c18-52 52 40 30-14s46-50 40 6 34 36 30-4c-4-34 28-30 32 2 3 26 30 14 22-10s30-24 34 4c3 20 18 16 28 16";
const BRANCHES = ["M230 60c50 0 50-36 110-36h646", "M230 60h756", "M230 60c50 0 50 36 110 36h646"];

export function ThreadDrawing({ variant, themes = 3, straight = false }: { variant: "logo" | "card" | "onboarding" | "empty"; themes?: number; straight?: boolean }) {
  if (variant === "onboarding") {
    const count = Math.max(1, themes);
    return <svg className="thread-drawing thread-onboarding" viewBox="0 0 1000 110" fill="none" aria-hidden="true"><path d={TANGLE} className="thread-ink" />{Array.from({ length: count }, (_, i) => {
      const extra = ((i - 3) % 2 === 0 ? -1 : 1) * 36 / (Math.floor((i - 3) / 2) + 2);
      const path = BRANCHES[i] ?? `M230 60c50 0 50${extra < 0 ? "" : " "}${extra} 110${extra < 0 ? "" : " "}${extra}h646`;
      return <path key={i} d={path} className={`thread-color-${i % 8 + 1}`} />;
    })}</svg>;
  }
  return <svg className={`thread-drawing thread-${variant}${straight ? " is-straight" : ""}`} viewBox={variant === "logo" ? "0 0 44 24" : "0 0 150 28"} fill="none" aria-hidden="true"><path d={variant === "logo" ? LOGO : variant === "card" ? CARD : "M2 14H148"} /></svg>;
}

export function Brand() {
  return <Link href="/welcome" className="brand" aria-label="Untangle 처음 화면"><ThreadDrawing variant="logo" /></Link>;
}

export function TopicName({ name, themeIndex = 0, starred, children }: { name: string; themeIndex?: number; starred?: boolean; children?: ReactNode }) {
  return <span className="topic-name" style={topicThreadStyle(themeIndex)}><span aria-hidden="true" className="thread-mark" /><span>{name}</span>{starred && <span className="topic-star" aria-label="별 표시">★</span>}{children}</span>;
}

export function ThemeTabs({ themes, themeOrder = themes, selected, onSelect }: { themes: string[]; themeOrder?: string[]; selected: string | null; onSelect: (theme: string | null) => void }) {
  return <div className="theme-tabs" aria-label="테마 고르기"><button type="button" aria-pressed={selected === null} onClick={() => onSelect(null)}>전체</button>{themes.map((theme) => <button key={theme} type="button" className={`theme-tab thread-color-${themeOrder.indexOf(theme) % 8 + 1}`} aria-pressed={selected === theme} onClick={() => onSelect(theme)}>{theme}</button>)}</div>;
}

export function CardEmpty({ onGenerate, failed, message }: { onGenerate: () => void; failed?: boolean; message?: string | null }) {
  return <section className="card-empty" aria-live="polite"><ThreadDrawing variant="empty" /><p className="eyebrow">{failed ? "잠시 쉬어가도 괜찮아요" : "한 걸음 뒤의 여백"}</p><h2>{failed ? "제안을 가져오지 못했어요." : "오늘은 새로 권할 게 없어요."}</h2><p>{failed ? message : "진행 중인 일을 이어가 보세요"}</p><button className="button button-primary" type="button" onClick={onGenerate}>{failed ? "다시 시도" : "새 제안 받기"}</button></section>;
}

export function CardSkeleton() {
  return <section className="card-skeleton" role="status" aria-label="초안을 준비하고 있어요"><ThreadDrawing variant="empty" /><h2>초안을 준비하고 있어요</h2><div className="skeleton-line" /><div className="skeleton-line skeleton-short" /></section>;
}
