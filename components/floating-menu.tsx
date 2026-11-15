"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { LineIcon } from "./icons";
import type { LineIconName } from "./icons";

type CloseReason = "escape" | "outside" | "action" | "trigger" | "switch" | "invalid";
let activeMenu: { id: string; close: (reason: CloseReason) => void } | null = null;
let previousBodyFlag: string | undefined;
type Position = { left: number; top: number; maxWidth: number; maxHeight: number; placement: "top" | "bottom"; thread: string; font: string; direction: CSSProperties["direction"] };

/** Disclosure controls live outside transformed cards so they remain clickable. */
export function FloatingMenu({ icon, label, title = label, className = "", panelClassName = "", children }: {
  icon: LineIconName; label: string; title?: string; className?: string; panelClassName?: string; children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const close = useCallback((reason: CloseReason) => {
    if (activeMenu?.id === id) {
      activeMenu = null;
      if (previousBodyFlag === undefined) delete document.body.dataset.floatingMenuOpen;
      else document.body.dataset.floatingMenuOpen = previousBodyFlag;
      previousBodyFlag = undefined;
    }
    setOpen(false);
    setPosition(null);
    focused.current = false;
    if ((reason === "escape" || (reason === "action" && panel.current?.contains(document.activeElement))) && trigger.current?.isConnected) trigger.current.focus();
  }, [id]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current;
    const popup = panel.current;
    if (!anchor || !popup) return;
    let frame = 0;
    let lastRect = "";
    let dirty = true;
    const measure = () => {
      if (!anchor.isConnected || anchor.closest("[inert], [hidden]") || (anchor.closest("dialog") && !anchor.closest("dialog[open]"))) { close("invalid"); return; }
      const rect = anchor.getBoundingClientRect();
      const view = window.visualViewport;
      const x = view?.offsetLeft ?? 0;
      const y = view?.offsetTop ?? 0;
      const width = view?.width || window.innerWidth;
      const height = view?.height || window.innerHeight;
      const style = getComputedStyle(anchor);
      const margin = Number.parseFloat(style.getPropertyValue("--space-3")) || 12;
      const gap = Number.parseFloat(style.getPropertyValue("--space-2")) || 8;
      const maxWidth = Math.max(0, width - margin * 2);
      const popupRect = popup.getBoundingClientRect();
      const popupStyle = getComputedStyle(popup);
      const border = (Number.parseFloat(popupStyle.borderTopWidth) || 0) + (Number.parseFloat(popupStyle.borderBottomWidth) || 0);
      const naturalHeight = Math.max(popup.scrollHeight + border, popupRect.height);
      const below = Math.max(0, y + height - margin - rect.bottom - gap);
      const above = Math.max(0, rect.top - gap - y - margin);
      const placement = below < naturalHeight && above > below ? "top" : "bottom";
      const available = placement === "top" ? above : below;
      const maxHeight = Math.min(height - margin * 2, Math.max(Math.min(44, height - margin * 2), available));
      const popupHeight = Math.min(naturalHeight, maxHeight);
      const popupWidth = Math.min(popupRect.width, maxWidth);
      const left = Math.max(x + margin, Math.min(rect.right - popupWidth, x + width - margin - popupWidth));
      const top = Math.max(y + margin, Math.min(placement === "top" ? rect.top - gap - popupHeight : rect.bottom + gap, y + height - margin - popupHeight));
      const next: Position = { left, top, maxWidth, maxHeight, placement, thread: style.getPropertyValue("--thread-current").trim(), font: style.fontFamily, direction: style.direction as Position["direction"] };
      setPosition((old) => old && Object.keys(next).every((key) => old[key as keyof Position] === next[key as keyof Position]) ? old : next);
      lastRect = [rect.left, rect.top, rect.width, rect.height].join(",");
      dirty = false;
    };
    const changed = () => { dirty = true; measure(); };
    const track = () => {
      if (!anchor.isConnected || anchor.closest("[inert], [hidden]")) { close("invalid"); return; }
      const rect = anchor.getBoundingClientRect();
      if (dirty || lastRect !== [rect.left, rect.top, rect.width, rect.height].join(",")) measure();
      frame = window.requestAnimationFrame(track);
    };
    measure();
    if (typeof window.requestAnimationFrame === "function") frame = window.requestAnimationFrame(track);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(changed) : null;
    observer?.observe(anchor); observer?.observe(popup);
    const rootObserver = typeof MutationObserver === "function" ? new MutationObserver(changed) : null;
    rootObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-font-size"] });
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    media?.addEventListener?.("change", changed);
    const pointer = (event: PointerEvent) => { const target = event.target as Node | null; if (target && !popup.contains(target) && !anchor.contains(target)) close("outside"); };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (anchor.closest("[inert]")) { close("invalid"); return; }
      event.preventDefault(); event.stopPropagation(); close("escape");
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", changed, true);
    window.addEventListener("resize", changed);
    window.visualViewport?.addEventListener("resize", changed);
    window.visualViewport?.addEventListener("scroll", changed);
    return () => {
      window.cancelAnimationFrame?.(frame);
      observer?.disconnect(); rootObserver?.disconnect();
      media?.removeEventListener?.("change", changed);
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", changed, true);
      window.removeEventListener("resize", changed);
      window.visualViewport?.removeEventListener("resize", changed);
      window.visualViewport?.removeEventListener("scroll", changed);
      if (activeMenu?.id === id) {
        activeMenu = null;
        if (previousBodyFlag === undefined) delete document.body.dataset.floatingMenuOpen;
        else document.body.dataset.floatingMenuOpen = previousBodyFlag;
        previousBodyFlag = undefined;
      }
    };
  }, [open, close, id]);

  useLayoutEffect(() => {
    // The measured position must be committed before focusing: hidden controls
    // cannot receive focus in browsers, even though DOM-only test runners allow it.
    if (!open || !position || focused.current) return;
    focused.current = true;
    panel.current?.querySelector<HTMLElement>("button:not(:disabled), a[href], select:not(:disabled), input:not(:disabled)")?.focus();
  }, [open, position]);

  const host = open ? trigger.current?.closest("dialog[open]") ?? document.body : null;
  return <span className={`floating-menu ${className}`}>
    <button ref={trigger} type="button" className="icon-button floating-menu-trigger" aria-label={label} title={title} data-tooltip={title} aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => {
      if (open) { close("trigger"); return; }
      activeMenu?.close("switch");
      previousBodyFlag = document.body.dataset.floatingMenuOpen;
      document.body.dataset.floatingMenuOpen = "true";
      activeMenu = { id, close };
      setOpen(true);
    }}><LineIcon name={icon} /></button>
    {host && createPortal(<div ref={panel} id={`${id}-panel`} role="group" aria-label={label} className={`floating-menu-panel ${panelClassName}`} data-placement={position?.placement} style={{
      position: "fixed", left: position?.left ?? 0, top: position?.top ?? 0, right: "auto", bottom: "auto", maxWidth: position?.maxWidth, maxHeight: position?.maxHeight, visibility: position ? "visible" : "hidden",
      ...(position?.thread ? { "--thread-current": position.thread } : {}), fontFamily: position?.font, direction: position?.direction,
    } as CSSProperties} onClick={(event) => {
      const target = (event.target as Element).closest("button, a[href]");
      if (target && !target.hasAttribute("disabled") && panel.current?.contains(target)) close("action");
    }} onChange={(event) => { if (event.target instanceof HTMLSelectElement) close("action"); }}>{children}</div>, host)}
  </span>;
}
