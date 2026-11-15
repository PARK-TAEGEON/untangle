import Link from "next/link";
import { ThreadDrawing } from "../components/ui";

export const metadata = { title: "페이지를 찾지 못했어요" };

export default function NotFound() {
  return <main className="not-found-page"><div className="not-found-content"><ThreadDrawing variant="card" /><h1>이 페이지를 찾지 못했어요.</h1><Link href="/" className="button button-primary">오늘로 돌아가기</Link></div></main>;
}
