import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Untangle — One thread at a time. 엉킨 실이 한 줄로 이어지는 프로젝트 대시보드";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const [regular, italic, body] = await Promise.all([
    readFile(join(process.cwd(), "node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff")),
    readFile(join(process.cwd(), "node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff")),
    readFile(join(process.cwd(), "node_modules/pretendard/dist/public/static/alternative/Pretendard-Regular.ttf")),
  ]);
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "64px 80px", background: "#FAFAF8", color: "#1C1C1A", fontFamily: "Instrument", justifyContent: "space-between" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 40 }}><svg width="66" height="36" viewBox="0 0 44 24" fill="none"><path d="M2 14c3-10 9 8 5-2s8-9 7 0 6 6 5 0c-1-5 4-4 5 0h18" stroke="#1C1C1A" strokeWidth="2" strokeLinecap="round" /></svg><span>untangle</span></div>
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}><div style={{ fontSize: 88, fontStyle: "italic", letterSpacing: "-1px" }}>One thread at a time.</div><svg width="1038" height="86" viewBox="0 0 1038 86" fill="none"><path d="M4 42c14-48 42 34 26-10s40-40 34 6 28 32 26-4c-4-28 24-26 26 0s24 16 20-2 24-22 28 4c4 22 24 14 28 6H1034" stroke="#3A5BC7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
    <div style={{ display: "flex", fontFamily: "Pretendard", fontSize: 24, color: "#5C5C57" }}>흩어진 프로젝트, 준비된 초안으로 오늘의 한 걸음.</div>
  </div>, { ...size, fonts: [{ name: "Instrument", data: regular, weight: 400, style: "normal" }, { name: "Instrument", data: italic, weight: 400, style: "italic" }, { name: "Pretendard", data: body, weight: 400, style: "normal" }] });
}
