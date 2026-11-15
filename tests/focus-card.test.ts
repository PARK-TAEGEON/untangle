// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceCards, WorkspaceSmallCard } from "../components/workspace-cards";
import { useWorkspace, WorkspaceProvider } from "../components/workspace-provider";
import { acceptCard, getCardState, isAcceptedUnfinished, visibleCards } from "../lib/card-state";
import { completedSteps } from "../lib/history";
import { createSampleWorkspace } from "../lib/sample-mode";
import { loadWorkspace, saveWorkspace, WORKSPACE_STORAGE_KEY } from "../lib/storage";
import { removeTopic } from "../lib/workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const TODAY = "2026-11-15";
const NOW = `${TODAY}T03:00:00.000Z`;
let root: Root;
let container: HTMLDivElement;
let store: ReturnType<typeof useWorkspace>;
let restoreWrite: (() => void) | undefined;
let oldOverflow: string;
let firstKey: string;
const fetchMock = vi.fn<typeof fetch>();
function fixture() {
  const { sample: _sample, ...data } = createSampleWorkspace("game-developer", NOW, TODAY);
  data.cards!.items[0].content = "- [ ] 첫 문장 확인\n\n가상 초안";
  return data;
}
function Capture() { store = useWorkspace(); return null; }
function Harness() {
  const { workspace, error } = useWorkspace();
  const [selected, setSelected] = useState<string | null>(null);
  const { finishing, renderExpanded } = useWorkspaceCards();
  if (!workspace) return null;
  const cards = visibleCards(workspace, TODAY);
  const hero = finishing ?? cards.find((card) => card.key === selected)
    ?? cards.find((card) => card.nudge.slot === "focus" && !isAcceptedUnfinished(card)) ?? cards[0];
  return createElement("div", null,
    createElement("header", null, createElement("button", null, "머리줄 이동")),
    createElement("main", null, hero ? renderExpanded(hero) : createElement("p", null, "남은 카드 없음"),
      cards.filter((card) => card.key !== hero?.key).map((card) => createElement(WorkspaceSmallCard, { key: card.key, card, onClick: () => setSelected(card.key) }))),
    error ? createElement("p", { role: "alert" }, error) : null,
  );
}
async function render() {
  await act(async () => root.render(createElement(WorkspaceProvider, null, createElement(Capture), createElement(Harness))));
}
function dialog() { return document.querySelector<HTMLDialogElement>(".focus-card-dialog"); }
function button(text: string, within: ParentNode = container) {
  return [...within.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text)!;
}
async function click(element: HTMLElement | null) {
  expect(element).toBeTruthy();
  element!.focus();
  await act(async () => element!.click());
}
async function open() { await click(button("시작")); expect(dialog()?.open).toBe(true); }
async function key(target: HTMLElement, value: string, shiftKey = false) {
  await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true })));
}
async function editRaw(content: string) {
  const textarea = dialog()!.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, content);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function failWrites() {
  const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  restoreWrite = () => write.mockRestore();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  window.localStorage.clear();
  const data = fixture(); firstKey = data.cards!.items[0].key;
  saveWorkspace(window.localStorage, data);
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  oldOverflow = document.body.style.overflow;
  restoreWrite = undefined;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  restoreWrite?.(); container.remove(); document.body.style.overflow = oldOverflow;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("single-card focus workspace", () => {
  it("persists acceptance before opening, isolates the background, and exits without completing", async () => {
    document.body.style.overflow = "scroll";
    await render();
    const title = getCardState(store.workspace!).items[0].nudge.title;
    await open();
    expect(loadWorkspace(window.localStorage)?.cards?.items[0].status).toBe("accepted");
    expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    expect(dialog()?.querySelector("h1")?.textContent).toBe(title);
    expect(dialog()?.textContent).toContain("먼저 이것만");
    expect(dialog()?.querySelector("header, nav, .small-proposal")).toBeNull();
    expect(container.hasAttribute("inert")).toBe(true);
    expect(container.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(dialog()?.querySelector("h1"));
    await key(dialog()!, "Escape");
    expect(dialog()).toBeNull();
    expect(getCardState(store.workspace!).items[0].status).toBe("accepted");
    expect(completedSteps(store.workspace!)).toHaveLength(0);
    expect(container.hasAttribute("inert")).toBe(false);
    expect(container.hasAttribute("aria-hidden")).toBe(false);
    expect(document.body.style.overflow).toBe("scroll");
    expect((document.activeElement as HTMLElement).dataset.cardKey).toBe(firstKey);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus inside the modal and supports resuming the accepted card", async () => {
    await render(); await open();
    const modal = dialog()!;
    const first = modal.querySelector<HTMLButtonElement>("button")!;
    const last = button("나가기", modal);
    await key(modal.querySelector("h1")!, "Tab");
    expect(document.activeElement).toBe(first);
    last.focus(); await key(last, "Tab"); expect(document.activeElement).toBe(first);
    first.focus(); await key(first, "Tab", true); expect(document.activeElement).toBe(last);
    await click(last);
    await click(container.querySelector(`[data-card-key='${firstKey}']`));
    const resume = button("집중해서 계속");
    const acceptedAt = getCardState(store.workspace!).items[0].accepted_at;
    await click(resume);
    expect(dialog()?.open).toBe(true);
    expect(getCardState(store.workspace!).items[0].accepted_at).toBe(acceptedAt);
    await click(button("나가기", dialog()!));
    expect(document.activeElement).toBe(resume);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("persists Markdown checklist and raw draft edits in the same accepted card", async () => {
    await render(); await open();
    await click(dialog()!.querySelector<HTMLInputElement>("input[type='checkbox']"));
    expect(loadWorkspace(window.localStorage)?.cards?.items[0].content).toContain("- [x] 첫 문장 확인");
    await click(dialog()!.querySelector<HTMLButtonElement>("button[aria-label='고치기']"));
    await editRaw("## 고친 가상 초안\n\n- [x] 확인 완료");
    expect(loadWorkspace(window.localStorage)?.cards?.items[0].content).toBe("## 고친 가상 초안\n\n- [x] 확인 완료");
    expect(dialog()?.open).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("completes the focused card through the existing feedback and history path and returns to the page", async () => {
    await render(); await open();
    const original = getCardState(store.workspace!).items[0];
    await click(button("다 했어요", dialog()!));
    expect(dialog()).toBeNull();
    expect(loadWorkspace(window.localStorage)?.cards?.items[0].status).toBe("completed");
    expect(getCardState(store.workspace!).feedback).toMatchObject([{ result: "completed", title: original.nudge.title, note: null }]);
    expect(completedSteps(store.workspace!)).toMatchObject([{ card_key: firstKey, title: original.nudge.title, topic_id: original.nudge.topic_id }]);
    expect(container.hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe(oldOverflow);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not open focus if acceptance cannot be saved", async () => {
    await render();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    failWrites();
    await click(button("시작"));
    expect(dialog()).toBeNull();
    expect(getCardState(store.workspace!).items[0].status).toBe("pending");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(container.querySelector("[role='alert']")?.textContent).toBeTruthy();
    expect(container.hasAttribute("inert")).toBe(false);
  });

  it("keeps focus open and the accepted card unchanged if completion cannot be saved", async () => {
    await render(); await open();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    failWrites();
    await click(button("다 했어요", dialog()!));
    expect(dialog()?.open).toBe(true);
    expect(dialog()?.querySelector("[role='alert']")?.textContent).toContain("완료를 저장하지 못했어요");
    expect(getCardState(store.workspace!).items[0].status).toBe("accepted");
    expect(completedSteps(store.workspace!)).toHaveLength(0);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
  });

  it("retains an unsaved draft after storage failures and saves that draft atomically with a later completion", async () => {
    await render(); await open();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await click(dialog()!.querySelector<HTMLButtonElement>("button[aria-label='고치기']"));
    failWrites();
    const latest = "## 보존할 마지막 가상 초안\n\n- [x] 저장 전에도 쓴 내용";
    await editRaw(latest);
    expect(dialog()?.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(latest);
    expect(dialog()?.querySelector("[role='alert']")?.textContent).toContain("초안을 저장하지 못했어요");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    await click(button("다 했어요", dialog()!));
    expect(dialog()?.open).toBe(true);
    expect(dialog()?.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(latest);
    expect(completedSteps(store.workspace!)).toHaveLength(0);
    restoreWrite?.(); restoreWrite = undefined;
    await click(button("다 했어요", dialog()!));
    expect(dialog()).toBeNull();
    expect(loadWorkspace(window.localStorage)?.cards?.items[0]).toMatchObject({ status: "completed", content: latest });
    expect(completedSteps(store.workspace!)).toHaveLength(1);
  });

  it("rejects a stale completion even if a replacement reuses the card key before rendering", async () => {
    await render(); await open();
    const complete = button("다 했어요", dialog()!);
    const replacement = fixture();
    replacement.cards!.items[0].nudge.title = "교체한 가상 카드 확인하기";
    await act(async () => { expect(store.replace(replacement)).toBe(true); complete.click(); });
    expect(dialog()).toBeNull();
    expect(getCardState(store.workspace!).items[0].nudge.title).toBe("교체한 가상 카드 확인하기");
    expect(getCardState(store.workspace!).items[0].status).toBe("pending");
    expect(completedSteps(store.workspace!)).toHaveLength(0);
    expect(container.hasAttribute("inert")).toBe(false);
  });

  it("closes safely if the topic and focused card disappear", async () => {
    await render(); await open();
    const topicId = getCardState(store.workspace!).items[0].nudge.topic_id;
    await act(async () => { store.update((previous) => removeTopic(previous, topicId)); });
    expect(dialog()).toBeNull();
    expect(getCardState(store.workspace!).items.some((card) => card.key === firstKey)).toBe(false);
    expect(container.hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe(oldOverflow);
  });

  it("restores pre-existing background accessibility attributes when leaving focus", async () => {
    const background = document.createElement("aside");
    background.setAttribute("inert", ""); background.setAttribute("aria-hidden", "false"); document.body.append(background);
    try {
      const data = fixture(); saveWorkspace(window.localStorage, acceptCard(data, firstKey, NOW));
      await render();
      await click(container.querySelector(`[data-card-key='${firstKey}']`));
      await click(button("집중해서 계속"));
      await click(button("나가기", dialog()!));
      expect(background.hasAttribute("inert")).toBe(true);
      expect(background.getAttribute("aria-hidden")).toBe("false");
    } finally { background.remove(); }
  });
});
