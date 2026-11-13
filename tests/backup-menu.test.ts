// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackupMenu } from "../components/backup-menu";
import { Done } from "../components/done";
import { useWorkspace, WorkspaceProvider } from "../components/workspace-provider";
import { serializeWorkspaceBackup } from "../lib/backup";
import { applyGeneratedCards, completeCard } from "../lib/card-state";
import type { Nudge } from "../lib/card-types";
import { parseExport } from "../lib/parse";
import { createSampleWorkspace } from "../lib/sample-mode";
import { loadWorkspace, saveWorkspace, SAMPLE_WORKSPACE_STORAGE_KEY, WORKSPACE_MODE_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "../lib/storage";
import { confirmOnboarding, removeTopic } from "../lib/workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: "a" }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const NOW = "2026-11-13T16:00:00.000Z";
const TODAY = "2026-11-14";
const fixture = () => confirmOnboarding(parseExport(`## 나
- 하는 일/역할: 가상 개발자
## 테마: 개발
### 가상 프로젝트
- 한 줄 설명: 가상 동작 확인
- 진행 여부: 진행 중
- 내가 말했던 다음 할 일: 초안 확인`, { today: TODAY }), {}, null, NOW);
const card: Nudge = {
  id: "n1", topic_id: "t1", new_topic_name: null, slot: "focus", type: "continue", title: "초안 확인하기",
  action: "첫 줄 확인", est_minutes: 5, why_now: "다음 할 일", evidence: [{ source: "topic", fact: "초안 확인" }],
  head_start: { kind: "draft", content: "확인할 초안", options: [] }, first_step: "첫 줄부터 읽어 주세요.",
};

let root: Root;
let container: HTMLDivElement;
let store: ReturnType<typeof useWorkspace>;
function Capture() { store = useWorkspace(); return null; }
async function render(child = createElement(BackupMenu)) {
  await act(async () => { root.render(createElement(WorkspaceProvider, null, createElement(Capture), child)); });
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((element) => element.textContent?.trim() === text);
  expect(button).toBeTruthy();
  await act(async () => { button!.click(); });
}
async function selectFile(content: string) {
  const input = container.querySelector<HTMLInputElement>("input[type='file']")!;
  const file = new File([content], "test-backup.json", { type: "application/json" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  saveWorkspace(window.localStorage, fixture());
  vi.stubGlobal("fetch", vi.fn());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});

describe("backup confirmation and mode isolation", () => {
  it("restores into an empty browser and then opens the restored workspace", async () => {
    window.localStorage.clear();
    const onRestored = vi.fn();
    await render(createElement(BackupMenu, { onRestored }));
    expect(store.workspace).toBeNull();
    await selectFile(serializeWorkspaceBackup(fixture(), NOW));
    expect(store.workspace).toBeNull();
    await click("교체해서 가져오기");
    expect(store.workspace?.topics[0].name).toBe("가상 프로젝트");
    expect(onRestored).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("downloads a validated JSON backup with a dated filename", async () => {
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:untangle-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let filename = "";
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    await render();
    await click("내보내기");
    expect(download).toHaveBeenCalledOnce();
    expect(filename).toBe(`untangle-${TODAY}.json`);
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(JSON.parse(await blob.text())).toMatchObject({ format: "untangle-backup", version: 1, workspace: { version: 1 } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("leaves current data unchanged until confirmation, supports cancellation and imports without an API call", async () => {
    await render();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const imported = fixture(); imported.topics[0].name = "가져온 프로젝트";
    const text = serializeWorkspaceBackup(imported, NOW);
    await selectFile(text);
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    await click("취소");
    expect(container.querySelector("dialog")).toBeNull();
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    await selectFile(text);
    await click("교체해서 가져오기");
    expect(loadWorkspace(window.localStorage)?.topics[0].name).toBe("가져온 프로젝트");
    expect(store.workspace?.cards?.request_id).toBeNull();
    expect(store.workspace?.cards?.generated_date).toBe(TODAY);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed or wrong-mode files without a replacement dialog or any storage writes", async () => {
    await render();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await selectFile("{}");
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector("[role='status']")?.textContent).toContain("백업");
    await selectFile(serializeWorkspaceBackup(createSampleWorkspace("student", NOW, TODAY), NOW));
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector("[role='status']")?.textContent).toContain("샘플");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
  });

  it("preserves stored data and provider state if backup persistence fails", async () => {
    await render();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const original = store.workspace;
    await selectFile(serializeWorkspaceBackup(fixture(), NOW));
    const write = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    await click("교체해서 가져오기");
    expect(store.workspace).toBe(original);
    expect(store.error).toBeTruthy();
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(container.querySelector("dialog [role='alert']")?.textContent).toContain("기존 자료는 그대로");
    write.mockRestore();
  });

  it("restores the sample key without touching personal data or the mode flag", async () => {
    const personal = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const sample = createSampleWorkspace("student", NOW, TODAY);
    saveWorkspace(window.localStorage, sample, SAMPLE_WORKSPACE_STORAGE_KEY);
    window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, "sample");
    await render();
    const imported = createSampleWorkspace("game-developer", NOW, TODAY);
    await selectFile(serializeWorkspaceBackup(imported, NOW));
    await click("교체해서 가져오기");
    expect(store.workspace?.sample?.persona).toBe("game-developer");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(personal);
    expect(window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY)).toBe("sample");
  });
});

describe("completed page", () => {
  it("groups saved steps by Seoul date and retains title, topic and memo after deletion", async () => {
    let data = completeCard(applyGeneratedCards(fixture(), [card], NOW, TODAY), "card-1", "첫 메모", NOW);
    data = applyGeneratedCards(data, [{ ...card, title: "둘째 초안 확인하기" }], NOW, TODAY);
    data = completeCard(data, "card-2", "둘째 메모", "2026-11-13T14:00:00.000Z");
    data = removeTopic(data, "t1");
    saveWorkspace(window.localStorage, data);
    await render(createElement(Done));
    expect(container.querySelectorAll(".done-date-group")).toHaveLength(2);
    expect([...container.querySelectorAll("time")].map((time) => time.dateTime)).toEqual(["2026-11-14", "2026-11-13"]);
    expect(container.querySelectorAll(".done-step")).toHaveLength(2);
    expect(container.textContent).toContain("첫 메모");
    expect(container.textContent).toContain("둘째 메모");
    expect(container.querySelector(".done-topic")?.textContent).toBe("가상 프로젝트");
    expect(container.querySelector("nav [aria-current='page']")?.textContent).toBe("지나온 걸음");
    expect(fetch).not.toHaveBeenCalled();
  });
});
