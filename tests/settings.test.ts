// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "../components/settings";
import { useWorkspace, WorkspaceProvider } from "../components/workspace-provider";
import { serializeWorkspaceBackup } from "../lib/backup";
import { APP_DATA_KEYS, APP_DATA_RESET_KEY } from "../lib/app-data";
import { buildWorkspaceCardInput } from "../lib/card-state";
import { createSampleWorkspace } from "../lib/sample-mode";
import { loadWorkspace, saveWorkspace, SAMPLE_WORKSPACE_STORAGE_KEY, WORKSPACE_MODE_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "../lib/storage";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({ default: "a" }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const TODAY = "2026-11-15";
const NOW = `${TODAY}T03:00:00.000Z`;
const PROMPT = "가상 내보내기 프롬프트\n\n- 입력 사실을 그대로 유지합니다.\n- 예시 항목만 적습니다.\n";
let root: Root;
let container: HTMLDivElement;
let store: ReturnType<typeof useWorkspace>;
let restorers: Array<() => void>;
let originalData: Map<string, string>;
const fetchMock = vi.fn<typeof fetch>();
const copy = vi.fn<(content: string) => Promise<void>>();
function fixture() {
  const { sample: _sample, ...personal } = createSampleWorkspace("student", NOW, TODAY);
  personal.profile.summary = "설정 검증용 가상 개인 기록";
  return personal;
}
function Capture() { store = useWorkspace(); return null; }
async function render() {
  await act(async () => root.render(createElement(WorkspaceProvider, null, createElement(Capture), createElement(Settings, { exportPrompt: PROMPT }))));
}
function button(text: string, within: ParentNode = container) {
  return [...within.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text)!;
}
async function click(text: string, within: ParentNode = container) {
  const element = button(text, within); expect(element).toBeTruthy();
  await act(async () => element.click());
}
function field<T extends HTMLInputElement | HTMLSelectElement>(name: string): T {
  const labels = [...container.querySelectorAll<HTMLLabelElement>("label")];
  const label = labels.find((element) => element.textContent?.trim().startsWith(name));
  const control = label?.control ?? container.querySelector(`[aria-label='${name}']`);
  expect(control).toBeTruthy(); return control as T;
}
async function select(name: string, value: string) {
  const element = field<HTMLSelectElement>(name);
  await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function chooseFile(content: string) {
  const input = container.querySelector<HTMLInputElement>("input[type='file']")!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File([content], "가상-백업.json", { type: "application/json" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await Promise.resolve(); });
}
function storageSnapshot() { return Object.fromEntries(Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)])); }
function clearDialog() { return container.querySelector<HTMLDialogElement>("dialog[open]")!; }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  window.localStorage.clear(); saveWorkspace(window.localStorage, fixture());
  originalData = new Map([...document.documentElement.attributes].filter((attribute) => attribute.name.startsWith("data-")).map((attribute) => [attribute.name, attribute.value]));
  for (const attribute of [...document.documentElement.attributes]) if (attribute.name.startsWith("data-")) document.documentElement.removeAttribute(attribute.name);
  const media = new Map<string, MediaQueryList>();
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    if (!media.has(query)) {
      const target = new EventTarget();
      Object.defineProperties(target, { matches: { value: false }, media: { value: query } });
      media.set(query, target as MediaQueryList);
    }
    return media.get(query)!;
  });
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  copy.mockReset().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  navigation.push.mockReset(); navigation.replace.mockReset();
  restorers = [];
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const restore of restorers.reverse()) restore();
  container.remove();
  for (const attribute of [...document.documentElement.attributes]) if (attribute.name.startsWith("data-")) document.documentElement.removeAttribute(attribute.name);
  for (const [key, value] of originalData) document.documentElement.setAttribute(key, value);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("settings workspace integration", () => {
  it("persists display and daily count choices across mounting without changing records or LLM input", async () => {
    await render();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const input = buildWorkspaceCardInput(store.workspace!, TODAY);
    await select("화면 밝기", "dark");
    await select("글자 크기", "large");
    await act(async () => field<HTMLInputElement>("움직임 줄이기").click());
    await select("하루 카드 수", "1");
    expect(field<HTMLSelectElement>("화면 밝기").value).toBe("dark");
    expect(field<HTMLSelectElement>("글자 크기").value).toBe("large");
    expect(field<HTMLInputElement>("움직임 줄이기").checked).toBe(true);
    expect(field<HTMLSelectElement>("하루 카드 수").value).toBe("1");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(buildWorkspaceCardInput(store.workspace!, TODAY)).toEqual(input);
    await act(async () => root.unmount()); root = createRoot(container); await render();
    expect(field<HTMLSelectElement>("화면 밝기").value).toBe("dark");
    expect(field<HTMLSelectElement>("글자 크기").value).toBe("large");
    expect(field<HTMLInputElement>("움직임 줄이기").checked).toBe(true);
    expect(field<HTMLSelectElement>("하루 카드 수").value).toBe("1");
    await select("화면 밝기", "system");
    expect(field<HTMLSelectElement>("화면 밝기").value).toBe("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("copies the supplied export prompt exactly and keeps records intact", async () => {
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await render(); await click("내보내기 프롬프트 다시 복사");
    expect(copy).toHaveBeenCalledExactlyOnceWith(PROMPT);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a useful copy failure without navigating or touching records", async () => {
    copy.mockRejectedValue(new Error("clipboard unavailable"));
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await render(); await click("내보내기 프롬프트 다시 복사");
    expect(container.textContent).toMatch(/복사하지 못|복사할 수 없/);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(navigation.push).not.toHaveBeenCalled(); expect(navigation.replace).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers inline backup controls and downloads the current workspace as JSON", async () => {
    const url = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:settings-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let filename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    await render();
    expect(container.querySelector(".backup-menu")).toBeNull();
    expect(button("가져오기")).toBeTruthy();
    await click("내보내기");
    expect(filename).toBe(`untangle-${TODAY}.json`);
    const blob = url.mock.calls[0][0] as Blob;
    expect(JSON.parse(await blob.text())).toMatchObject({ format: "untangle-backup", version: 1, workspace: { profile: { summary: "설정 검증용 가상 개인 기록" } } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for confirmation before restoring a backup from settings", async () => {
    await render();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const imported = fixture(); imported.profile.summary = "설정에서 가져온 가상 기록";
    await chooseFile(serializeWorkspaceBackup(imported, NOW));
    expect(clearDialog()?.open).toBe(true);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    await click("교체해서 가져오기", clearDialog());
    expect(loadWorkspace(window.localStorage)?.profile.summary).toBe("설정에서 가져온 가상 기록");
    expect(store.workspace?.profile.summary).toBe("설정에서 가져온 가상 기록");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels clearing without changing personal, sample or preference data", async () => {
    saveWorkspace(window.localStorage, createSampleWorkspace("game-developer", NOW, TODAY), SAMPLE_WORKSPACE_STORAGE_KEY);
    await render(); await select("글자 크기", "large");
    const before = storageSnapshot(); const original = store.workspace;
    await click("모두 지우기");
    expect(clearDialog()?.querySelector("h2")?.textContent).toBe("모두 지울까요?");
    expect(storageSnapshot()).toEqual(before);
    await click("취소", clearDialog());
    expect(container.querySelector("dialog[open]")).toBeNull();
    expect(store.workspace).toBe(original);
    expect(storageSnapshot()).toEqual(before);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("clears the app's personal, sample, mode and preference data only after confirmation", async () => {
    saveWorkspace(window.localStorage, createSampleWorkspace("game-developer", NOW, TODAY), SAMPLE_WORKSPACE_STORAGE_KEY);
    window.localStorage.setItem("unrelated.keep", "보존");
    window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, "personal");
    await render(); await select("화면 밝기", "dark"); await select("하루 카드 수", "2");
    await click("모두 지우기");
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeTruthy();
    await click("모두 지우기", clearDialog());
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(SAMPLE_WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY)).toBeNull();
    for (const key of APP_DATA_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(APP_DATA_RESET_KEY)!)).toMatchObject({ phase: "ready" });
    expect(window.localStorage.getItem("unrelated.keep")).toBe("보존");
    expect(store.workspace).toBeNull();
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith("/welcome");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the confirmation open and does not navigate when clearing storage fails", async () => {
    await render(); await select("글자 크기", "large");
    const before = storageSnapshot(); const original = store.workspace;
    await click("모두 지우기");
    const originalRemove = window.localStorage.removeItem.bind(window.localStorage);
    const remove = vi.spyOn(window.localStorage, "removeItem").mockImplementation((key) => {
      if (key === WORKSPACE_STORAGE_KEY) throw new DOMException("Blocked", "SecurityError");
      originalRemove(key);
    });
    restorers.push(() => remove.mockRestore());
    await click("모두 지우기", clearDialog());
    expect(clearDialog()?.open).toBe(true);
    expect(clearDialog()?.querySelector("[role='alert']")?.textContent).toBeTruthy();
    expect(store.workspace).toBe(original);
    expect(storageSnapshot()).toEqual(before);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a partial clear truthfully and can retry after browser storage is available", async () => {
    await render();
    const before = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    await click("모두 지우기");
    const remove = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    restorers.push(() => remove.mockRestore());
    await click("모두 지우기", clearDialog());
    expect(clearDialog()?.open).toBe(true);
    expect(clearDialog()?.querySelector("[role='alert']")?.textContent).toMatch(/일부|정리/);
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBe(before);
    expect(JSON.parse(window.localStorage.getItem(APP_DATA_RESET_KEY)!)).toMatchObject({ phase: "clearing" });
    expect(store.workspace).toBeNull();
    expect(navigation.replace).not.toHaveBeenCalled();
    remove.mockRestore();
    await click("모두 지우기", clearDialog());
    expect(window.localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith("/welcome");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
