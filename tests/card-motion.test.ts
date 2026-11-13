// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceCards } from "../components/workspace-cards";
import { getCardState, visibleCards } from "../lib/card-state";
import { createSampleWorkspace, SAMPLE_BASELINE_DATE } from "../lib/sample-mode";
import type { WorkspaceData } from "../lib/workspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const update = vi.hoisted(() => vi.fn<(change: (previous: WorkspaceData) => WorkspaceData) => boolean>());
let workspace: WorkspaceData;
vi.mock("../components/workspace-provider", () => ({ useWorkspace: () => ({ workspace, update }) }));
let root: Root;
let container: HTMLDivElement;
let refresh: () => void;
let mounted: boolean;

function Harness() {
  const [, render] = useState(0);
  refresh = () => render((count) => count + 1);
  const { finishing, renderExpanded } = useWorkspaceCards();
  const card = finishing ?? visibleCards(workspace, SAMPLE_BASELINE_DATE)[0];
  return card ? renderExpanded(card) : null;
}
async function click(label: string) {
  await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
}
async function advance(ms: number) { await act(async () => vi.advanceTimersByTime(ms)); }

beforeEach(async () => {
  vi.useFakeTimers();
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);
  document.documentElement.style.setProperty("--motion-fast", "200ms");
  workspace = createSampleWorkspace("game-developer", `${SAMPLE_BASELINE_DATE}T12:00:00.000Z`, SAMPLE_BASELINE_DATE);
  update.mockReset().mockImplementation((change) => { workspace = change(workspace); refresh(); return true; });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  container.remove();
  document.documentElement.style.removeProperty("--motion-fast");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("card exit and saved actions", () => {
  it.each([ ["나중에", "snoozed", "snooze"], ["관심 없어요", "dismissed", "dismiss"] ])("saves %s once after the card exits and then displays the next card", async (label, status, kind) => {
    const original = getCardState(workspace).items[0];
    await click(label);
    expect(update).not.toHaveBeenCalled();
    expect(container.querySelector(`.proposal-card.is-leaving-${kind}`)?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".proposal-card h2")?.textContent).toBe(original.nudge.title);
    // A repeated click during the exit must not produce duplicate feedback.
    await click(label);
    await advance(199);
    expect(getCardState(workspace).items[0].status).toBe("pending");
    await advance(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(getCardState(workspace).items[0].status).toBe(status);
    expect(getCardState(workspace).feedback).toHaveLength(1);
    expect(container.querySelector(".proposal-card h2")?.textContent).not.toBe(original.nudge.title);
    expect(container.querySelector(".is-leaving")).toBeNull();
  });

  it("restores the same card when persistence fails", async () => {
    const original = getCardState(workspace).items[0];
    update.mockReturnValue(false);
    await click("관심 없어요");
    await advance(200);
    expect(container.querySelector(".is-leaving")).toBeNull();
    expect(container.querySelector(".proposal-card h2")?.textContent).toBe(original.nudge.title);
    expect(getCardState(workspace).items[0].status).toBe("pending");
  });

  it("commits an already chosen action when the card page unmounts", async () => {
    await click("관심 없어요");
    await act(async () => { root.unmount(); mounted = false; });
    expect(getCardState(workspace).items[0].status).toBe("dismissed");
    expect(update).toHaveBeenCalledTimes(1);
    await advance(200);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("flushes a chosen action before pagehide and cancels its timer", async () => {
    await click("나중에");
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(getCardState(workspace).items[0].status).toBe("snoozed");
    await advance(200);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does not apply a queued action to a newly imported workspace with reused card keys", async () => {
    await click("관심 없어요");
    workspace = structuredClone(workspace);
    await advance(200);
    expect(getCardState(workspace).items[0].status).toBe("pending");
    expect(getCardState(workspace).feedback).toHaveLength(0);
  });

  it("immediately persists the action without holding the card under reduced motion", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    await click("관심 없어요");
    expect(getCardState(workspace).items[0].status).toBe("dismissed");
    expect(container.querySelector(".is-leaving")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
