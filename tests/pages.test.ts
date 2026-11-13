// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import type { AnchorHTMLAttributes } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../components/dashboard";
import { TopicBoard } from "../components/topic-board";
import { Topics } from "../components/topics";
import { WorkspaceProvider } from "../components/workspace-provider";
import { acceptCard, applyGeneratedCards } from "../lib/card-state";
import type { Nudge } from "../lib/card-types";
import { parseExport } from "../lib/parse";
import { loadWorkspace, saveWorkspace } from "../lib/storage";
import { confirmOnboarding } from "../lib/workspace";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({ default: ({ onClick, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", {
  ...props, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); onClick?.(event); },
}, children) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const NOW = "2026-11-12T12:00:00.000Z";
const TODAY = "2026-11-12";
function card(topicId: string, title: string): Nudge {
  return {
    id: `n-${topicId}`, topic_id: topicId, new_topic_name: null, slot: "focus", type: "continue", title,
    action: "준비된 초안의 문구를 확인해 주세요.", est_minutes: 5, why_now: "초안 확인이 다음 할 일이에요.",
    evidence: [{ source: "topic", fact: "초안 확인이 다음 할 일" }],
    head_start: { kind: "draft", content: `${title}의 가상 초안`, options: [] }, first_step: "첫 줄을 확인해 주세요.",
  };
}
function workspace() {
  const data = parseExport(`## 나
- 하는 일/역할: 가상 개발자
## 테마: 개발
### 첫 프로젝트
- 한 줄 설명: 첫 번째 가상 프로젝트 설명
- 진행 여부: 진행 중
- 목표: 첫 프로젝트의 가상 목표
- 현재 상태: 초안을 만들었어요.
- 지금까지 만든 것: 가상 문서
- 최근에 내린 결정: 작은 예시부터 확인한다.
- 막힌 점이나 미정인 것: 마지막 문구는 미정이다.
- 내가 말했던 다음 할 일: 초안 확인
### 둘째 프로젝트
- 한 줄 설명: 두 번째 가상 프로젝트 설명
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 초안 확인
### 나중 프로젝트
- 한 줄 설명: 나중에 볼 가상 프로젝트
- 진행 여부: 멈춤`, { today: TODAY });
  const result = confirmOnboarding(data, {}, null, NOW);
  return applyGeneratedCards(result, [card("t1", "첫 걸음 확인하기"), card("t2", "둘째 걸음 확인하기")], NOW, TODAY);
}

let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn<typeof fetch>();
async function render(page: ReturnType<typeof createElement>) {
  await act(async () => { root.render(createElement(StrictMode, null, createElement(WorkspaceProvider, null, page))); });
}
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => { (element as HTMLElement).click(); });
}
function button(text: string) { return [...container.querySelectorAll("button")].find((element) => element.textContent?.trim() === text) ?? null; }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  navigation.push.mockReset(); navigation.replace.mockReset();
  fetchMock.mockReset().mockResolvedValue(Response.json({ nudges: [] }));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  saveWorkspace(window.localStorage, workspace());
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("separate today and topic pages", () => {
  it("keeps today as cards even when an old selected topic ID exists and promotes a smaller card", async () => {
    const data = workspace(); data.selected_topic_id = "t2";
    saveWorkspace(window.localStorage, data);
    await render(createElement(Dashboard));
    expect(container.querySelector("nav a[aria-current='page']")?.textContent).toBe("오늘");
    expect(container.querySelectorAll("nav a")).toHaveLength(2);
    expect(container.querySelector(".home-title h1[lang='en']")?.textContent).toBe("One thread at a time.");
    expect(container.querySelector(".home-title p")).toBeNull();
    expect(container.querySelector(".topic-board-context")).toBeNull();
    expect(container.querySelector(".proposal-card h2")?.textContent).toBe("첫 걸음 확인하기");
    await click(container.querySelector(".small-proposal"));
    expect(container.querySelector(".proposal-card h2")?.textContent).toBe("둘째 걸음 확인하기");
    expect(container.querySelector("footer")).toBeNull();
    expect(container.querySelector(".home-intro .eyebrow")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the unfinished accepted card available while preferring a pending focus card", async () => {
    const data = workspace();
    saveWorkspace(window.localStorage, acceptCard(data, data.cards!.items[0].key, NOW));
    await render(createElement(Dashboard));
    expect(container.querySelector(".proposal-card h2")?.textContent).toBe("둘째 걸음 확인하기");
    expect(container.querySelector(".small-proposal")?.textContent).toContain("첫 걸음 확인하기");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows individual topic boxes grouped by theme, persistent star controls and collapsed later items", async () => {
    const data = workspace();
    data.cards!.generated_date = null;
    data.themes.push({ name: "활성이 없는 테마", collapsed: false });
    saveWorkspace(window.localStorage, data);
    await render(createElement(Topics));
    expect(container.querySelector("nav a[aria-current='page']")?.textContent).toBe("토픽");
    expect(container.querySelectorAll(".topics-grid > .topic-tile")).toHaveLength(2);
    expect(container.querySelector(".topic-tile-link")?.getAttribute("href")).toBe("/topics/t1");
    expect(container.textContent).toContain("첫 번째 가상 프로젝트 설명");
    expect([...container.querySelectorAll(".theme-box-header")].some((heading) => heading.textContent?.includes("활성이 없는 테마"))).toBe(false);
    expect(container.querySelector("option[value='활성이 없는 테마']")).not.toBeNull();
    expect(container.querySelector(".topics-later button")?.getAttribute("aria-expanded")).toBe("false");
    await click(container.querySelector("button[aria-label='첫 프로젝트 별 표시']"));
    expect(loadWorkspace(window.localStorage)?.topics[0].starred).toBe(true);
    expect(container.querySelector("button[aria-label='첫 프로젝트 별 해제']")?.getAttribute("aria-pressed")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("opens a topic board without automatic generation and shows only its own saved card and context", async () => {
    const data = workspace(); data.cards!.generated_date = null;
    saveWorkspace(window.localStorage, data);
    await render(createElement(TopicBoard, { topicId: "t1" }));
    const header = container.querySelector(".topic-board-header");
    expect(header?.querySelector(".thread-card")).toBeNull();
    expect(header?.nextElementSibling?.id).toBe("topic-card-main");
    expect(header?.nextElementSibling?.nextElementSibling?.className).toBe("topic-board-context");
    expect(container.textContent).toContain("첫 프로젝트의 가상 목표");
    for (const title of ["목표", "현재 상태", "지금까지 만든 것", "최근 결정", "막힌 점", "다음 할 일"]) {
      expect([...container.querySelectorAll(".topic-board-context h2")].some((heading) => heading.textContent === title)).toBe(true);
    }
    expect(container.querySelectorAll(".proposal-card")).toHaveLength(1);
    expect(container.querySelector(".proposal-card .thread-card")).not.toBeNull();
    expect(container.querySelector(".proposal-card h2")?.textContent).toBe("첫 걸음 확인하기");
    expect(container.textContent).not.toContain("둘째 걸음 확인하기");
    expect(container.textContent).not.toContain("기타");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("generates for an empty board only after its explicit button is clicked", async () => {
    const data = workspace(); data.cards!.items = []; data.cards!.generated_date = null;
    saveWorkspace(window.localStorage, data);
    fetchMock.mockResolvedValue(Response.json({ nudges: [card("t1", "직접 받은 한 걸음")] }));
    await render(createElement(TopicBoard, { topicId: "t1" }));
    expect(fetchMock).not.toHaveBeenCalled();
    await click(button("이 토픽의 한 걸음 받기"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).topics.map((topic: { id: string }) => topic.id)).toEqual(["t1"]);
    expect(container.querySelector(".proposal-card h2")?.textContent).toBe("직접 받은 한 걸음");
  });

  it("keeps the last deleted board's undo available and restores its card without automatic requests", async () => {
    const data = workspace(); data.topics = [data.topics[0]]; data.cards!.items = [data.cards!.items[0]];
    saveWorkspace(window.localStorage, data);
    await render(createElement(TopicBoard, { topicId: "t1" }));
    await click(button("삭제"));
    expect(container.querySelector(".undo-toast")).not.toBeNull();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(loadWorkspace(window.localStorage)?.topics).toEqual([]);
    await click(button("되돌리기"));
    expect(container.querySelector(".topic-board-title")?.textContent).toContain("첫 프로젝트");
    expect(container.querySelector(".proposal-card h2")?.textContent).toBe("첫 걸음 확인하기");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
