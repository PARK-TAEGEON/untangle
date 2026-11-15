// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalCard } from "../components/proposal-card";
import { buildHandoff } from "../lib/handoff";
import type { Nudge } from "../lib/card-types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("uses the user's edited Markdown verbatim in the specified handoff", () => {
  const card = { title: "초안 확인하기", action: "한 줄을 고쳐 주세요.", head_start: { content: "이전 초안" } } as Nudge;
  const edited = "| 값 | 확인 |\n| --- | --- |\n| 3 | 완료 |\n\n- [x] 고친 초안";
  expect(buildHandoff({ name: "가상 작업", one_liner: "작은 실험", status_text: "초안 준비" }, card, edited)).toBe(
    `[프로젝트] 가상 작업: 작은 실험\n[지금 상태] 초안 준비\n[하려는 일] 초안 확인하기: 한 줄을 고쳐 주세요.\n[준비된 초안]\n${edited}\n\n이 초안에서 이어서 도와줘.`,
  );
});

describe("compact card disclosures and handoff", () => {
  const card: Nudge = {
    id: "n1", slot: "focus", topic_id: "t1", new_topic_name: null, type: "continue",
    title: "가상 초안 확인하기", action: "준비된 초안의 첫 문장을 확인해 주세요.", est_minutes: 5,
    why_now: "초안을 비교하는 다음 할 일이 있어요.", evidence: [{ source: "topic", fact: "가상 초안이 있음" }],
    head_start: { kind: "draft", content: "기존 초안", options: [] }, first_step: "첫 문장을 확인해 주세요.",
  };
  const edited = "## 사용자가 고친 초안\n\n- [x] 수정한 문장";
  let root: Root;
  let container: HTMLDivElement;
  const copy = vi.fn<(value: string) => Promise<void>>();
  let popup: { opener: unknown; location: { href: string }; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    copy.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
    popup = { opener: {}, location: { href: "about:blank" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(accepted = false) {
    await act(async () => root.render(createElement(ProposalCard, {
      nudge: card, content: edited, accepted, onContentChange: vi.fn(), onAccept: vi.fn(), onComplete: vi.fn(),
      onSnooze: vi.fn(), onDismiss: vi.fn(), onAnswer: vi.fn(), onContinue: vi.fn(),
    })));
  }

  it("keeps the rationale and supporting facts together in one collapsed section with one handoff menu", async () => {
    await render();
    const rationale = container.querySelector<HTMLDetailsElement>("details.proposal-why")!;
    expect(rationale.open).toBe(false);
    expect(rationale.querySelector("p")?.textContent).toBe(card.why_now);
    expect(rationale.querySelector("summary")?.textContent).toBe("왜?");
    expect(rationale.querySelector(".proposal-action")?.textContent).toBe(card.action);
    expect(container.querySelector(".proposal-heading")?.textContent).not.toContain(card.action);
    expect(rationale.querySelector(".proposal-evidence li")?.textContent).toContain(card.evidence[0].fact);
    expect(container.querySelector("details.evidence")).toBeNull();
    expect(container.querySelectorAll(".handoff-menu")).toHaveLength(1);
    expect(container.querySelector(".proposal-actions > .handoff-menu")).not.toBeNull();
    expect(container.querySelector(".handoff-actions")).toBeNull();
  });

  it("retains accessible names for icon actions and a centered text start action", async () => {
    await render();
    expect(container.querySelector(".button-start")?.textContent).toBe("시작");
    for (const label of ["나중에", "관심 없어요", "다른 AI에서 이어가기", "고치기", "복사"]) {
      const action = container.querySelector(`[aria-label="${label}"]`)!;
      expect(action.getAttribute("title")).toBe(label);
      expect(action.querySelector("svg")?.getAttribute("stroke-width")).toBe("2");
      expect(action.querySelector("svg")?.getAttribute("stroke-linecap")).toBe("round");
    }
    expect(container.querySelector(".proposal-meta")?.textContent).not.toMatch(/지금 이어가기|이런 것도 있어요|약|이어서/);
  });

  it.each([
    ["Claude", "https://claude.ai/new"], ["ChatGPT", "https://chatgpt.com/"],
  ])("preserves the edited draft and popup isolation when continuing in %s", async (service, url) => {
    await render();
    const trigger = container.querySelector<HTMLButtonElement>("button[aria-label='다른 AI에서 이어가기']")!;
    await act(async () => trigger.click());
    const choice = Array.from(document.querySelectorAll<HTMLButtonElement>(".handoff-menu-panel button")).find((button) => button.textContent?.startsWith(service))!;
    await act(async () => choice.click());
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy.mock.calls[0][0]).toContain(`[준비된 초안]\n${edited}\n\n이 초안에서 이어서 도와줘.`);
    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(popup.opener).toBeNull();
    expect(popup.location.href).toBe(url);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".handoff-menu-panel")).toBeNull();
  });

  it("closes the handoff menu with Escape and returns focus to its trigger", async () => {
    await render();
    const trigger = container.querySelector<HTMLButtonElement>("button[aria-label='다른 AI에서 이어가기']")!;
    await act(async () => trigger.click());
    const choice = document.querySelector<HTMLButtonElement>(".handoff-menu-panel button")!;
    choice.focus();
    await act(async () => choice.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".handoff-menu-panel")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(copy).not.toHaveBeenCalled();
  });

  it("keeps only one handoff location while the completion note is open", async () => {
    await render(true);
    const complete = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "다 했어요")!;
    await act(async () => complete.click());
    expect(container.querySelector(".completion-form")).not.toBeNull();
    expect(container.querySelectorAll(".handoff-menu")).toHaveLength(1);
    expect(container.querySelector(".completion-form .proposal-actions > .handoff-menu")).not.toBeNull();
  });
});
