"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SavedCard } from "../lib/card-state";
import { HeadStart } from "./head-start";

interface FocusCardProps {
  card: SavedCard;
  error: string | null;
  trigger: HTMLElement | null;
  onChange: (content: string) => void;
  onComplete: (content: string) => void;
  onExit: () => void;
}

function focusable(dialog: HTMLDialogElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>("button, input, textarea, a[href], [tabindex]")]
    .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[hidden], [inert]"));
}

/** An opaque, single-card workspace; opening and closing never changes card status. */
export function FocusCard({ card, error, trigger, onChange, onComplete, onExit }: FocusCardProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState(card.content);
  useEffect(() => { setDraft(card.content); }, [card.content]);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const originMain = trigger?.closest("main");
    const overflow = document.body.style.overflow;
    const background = [...document.body.children].filter((child) => child !== element && !child.contains(element))
      .map((child) => ({ child, inert: child.getAttribute("inert"), hidden: child.getAttribute("aria-hidden") }));
    document.body.style.overflow = "hidden";
    try { element.showModal(); } catch { element.setAttribute("open", ""); }
    title.current?.focus({ preventScroll: true });
    for (const { child } of background) { child.setAttribute("inert", ""); child.setAttribute("aria-hidden", "true"); }
    return () => {
      if (element.open) element.close();
      document.body.style.overflow = overflow;
      for (const { child, inert, hidden } of background) {
        if (inert === null) child.removeAttribute("inert"); else child.setAttribute("inert", inert);
        if (hidden === null) child.removeAttribute("aria-hidden"); else child.setAttribute("aria-hidden", hidden);
      }
      // The accepted card may move to the smaller list during this same commit.
      queueMicrotask(() => {
        if (document.querySelector(".focus-card-dialog[open]")) return;
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        else if (originMain?.isConnected) {
          const related = [...originMain.querySelectorAll<HTMLElement>("[data-card-key]")].find((node) => node.dataset.cardKey === card.key);
          const target = related?.matches("button") ? related : related?.querySelector<HTMLElement>("button");
          (target ?? originMain.querySelector<HTMLElement>("button, a[href]"))?.focus({ preventScroll: true });
        }
      });
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialog} className="focus-card-dialog" aria-modal="true" aria-labelledby={`${id}-title`}
    onCancel={(event) => { event.preventDefault(); onExit(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onExit(); return; }
      if (event.key !== "Tab" || !dialog.current) return;
      const controls = focusable(dialog.current);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); title.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
    }}>
    <div className="focus-card-content">
      <h1 ref={title} id={`${id}-title`} tabIndex={-1}>{card.nudge.title}</h1>
      <section className="focus-card-draft" aria-label="초안"><HeadStart content={draft} onChange={(content) => { setDraft(content); onChange(content); }} /></section>
      <div className="first-step"><span className="first-step-symbol" aria-hidden="true">↳</span><div><strong>먼저 이것만</strong><p>{card.nudge.first_step}</p></div></div>
      {error && <p className="focus-card-error" role="alert">{error}</p>}
      <div className="focus-card-actions"><button type="button" className="button button-primary" onClick={() => onComplete(draft)}>다 했어요</button><button type="button" className="button button-secondary" onClick={onExit}>나가기</button></div>
    </div>
  </dialog>, document.body);
}
