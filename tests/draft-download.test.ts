// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeadStart } from "../components/head-start";
import { FocusCard } from "../components/focus-card";
import { downloadDraft } from "../lib/draft-download";
import { createSampleWorkspace } from "../lib/sample-mode";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ORIGINAL = "# 가상 초안 ✨\r\n\r\n| 항목 | 값 |\r\n| --- | --- |\r\n| 문구 | **그대로** |\r\n\r\n- [ ] 확인\r\n";
const EDITED = "## 마지막으로 고친 초안\r\n\r\n- [x] 확인 완료\r\n\r\n`원문 유지`\r\n";
let root: Root;
let container: HTMLDivElement;
let downloads: Array<{ filename: string; href: string; connected: boolean }>;
const createUrl = vi.fn<(blob: Blob | MediaSource) => string>();
const revokeUrl = vi.fn<(url: string) => void>();
const copy = vi.fn<(content: string) => Promise<void>>();
const fetchMock = vi.fn<typeof fetch>();
const changed = vi.fn();

function Draft({ readOnly = false }: { readOnly?: boolean }) {
  const [content, setContent] = useState(ORIGINAL);
  return createElement(HeadStart, { content, readOnly, onChange: (value) => { changed(value); setContent(value); } });
}
function downloadButton(within: ParentNode = container) { return within.querySelector<HTMLButtonElement>("button[aria-label='초안 내려받기']")!; }
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function edit(within: ParentNode, value: string) {
  await click(within.querySelector<HTMLButtonElement>("button[aria-label='고치기']")!);
  const textarea = within.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function lastBlob() { return createUrl.mock.calls[createUrl.mock.calls.length - 1][0] as Blob; }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  createUrl.mockReset().mockReturnValue("blob:untangle-draft"); revokeUrl.mockReset(); copy.mockReset().mockResolvedValue(undefined);
  changed.mockReset(); fetchMock.mockReset(); downloads = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation(createUrl);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeUrl);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ filename: this.download, href: this.href, connected: document.body.contains(this) });
  });
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } }); vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.runOnlyPendingTimers(); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("local Markdown draft downloads", () => {
  it.each([ORIGINAL, ""])("saves the source as UTF-8 Markdown and releases its temporary URL after the browser can consume it", async (content) => {
    downloadDraft(content);
    expect(downloads).toEqual([{ filename: "untangle-초안.md", href: "blob:untangle-draft", connected: true }]);
    expect(lastBlob().type).toBe("text/markdown;charset=utf-8");
    expect(await lastBlob().text()).toBe(content);
    expect(new Uint8Array(await lastBlob().arrayBuffer())).toEqual(new TextEncoder().encode(content));
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revokeUrl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:untangle-draft");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cleans up the anchor and URL immediately if starting a download throws", () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => { throw new Error("download blocked"); });
    expect(() => downloadDraft(ORIGINAL)).toThrow("download blocked");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:untangle-draft");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("places the accessible download icon beside copy and downloads the current edited source without changing existing actions", async () => {
    await act(async () => root.render(createElement(Draft)));
    const download = downloadButton();
    expect(download.previousElementSibling?.getAttribute("aria-label")).toBe("복사");
    expect(download.classList.contains("icon-button")).toBe(true);
    expect(download.getAttribute("title")).toBe("초안 내려받기");
    expect(download.getAttribute("data-tooltip")).toBe("초안 내려받기");
    expect(download.querySelector("svg")?.getAttribute("stroke-width")).toBe("2");
    expect(download.querySelector("svg")?.getAttribute("stroke-linecap")).toBe("round");
    await click(container.querySelector<HTMLInputElement>("input[type='checkbox']")!);
    expect(changed).toHaveBeenLastCalledWith(ORIGINAL.replace("- [ ]", "- [x]"));
    await edit(container, EDITED);
    const edits = changed.mock.calls.length;
    await click(downloadButton());
    expect(await lastBlob().text()).toBe(EDITED);
    expect(changed).toHaveBeenCalledTimes(edits);
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(EDITED);
    await click(container.querySelector<HTMLButtonElement>("button[aria-label='복사']")!);
    expect(copy).toHaveBeenCalledExactlyOnceWith(EDITED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains downloads in the shared read-only toolbar without enabling checklist or raw edits", async () => {
    await act(async () => root.render(createElement(Draft, { readOnly: true })));
    expect(container.querySelector("button[aria-label='고치기']")).toBeNull();
    expect(container.querySelector<HTMLInputElement>("input[type='checkbox']")?.disabled).toBe(true);
    await click(downloadButton());
    expect(await lastBlob().text()).toBe(ORIGINAL);
    expect(changed).not.toHaveBeenCalled();
  });

  it("downloads the latest local focus draft even when its backing save has not succeeded", async () => {
    const card = createSampleWorkspace("game-developer", "2026-11-15T03:00:00.000Z", "2026-11-15").cards!.items[0];
    await act(async () => root.render(createElement(FocusCard, {
      card, error: "저장하지 못한 가상 상황", trigger: null, onChange: changed, onComplete: vi.fn(), onExit: vi.fn(),
    })));
    const modal = document.querySelector<HTMLDialogElement>(".focus-card-dialog")!;
    await edit(modal, EDITED);
    await click(downloadButton(modal));
    expect(await lastBlob().text()).toBe(EDITED);
    expect(modal.open).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(EDITED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a local failure message and preserves the draft when a file URL cannot be created", async () => {
    createUrl.mockImplementation(() => { throw new Error("file unavailable"); });
    await act(async () => root.render(createElement(Draft)));
    await edit(container, EDITED);
    await click(downloadButton());
    expect(container.querySelector("[role='status']")?.textContent).toContain("내려받지 못했어요");
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(EDITED);
    expect(downloads).toHaveLength(0);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revokeUrl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
