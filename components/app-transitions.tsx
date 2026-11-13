"use client";

import { useSyncExternalStore, ViewTransition } from "react";
import type { ReactNode } from "react";
import { canAnimateNavigation, subscribeMotionPreference } from "../lib/motion";

/** Next navigation transitions include links, router calls and history traversal. */
export function AppTransitions({ children }: { children: ReactNode }) {
  const animate = useSyncExternalStore(subscribeMotionPreference, canAnimateNavigation, () => false);
  // Keep the boundary mounted when preferences change, preserving focus and page state.
  // React coordinates the snapshots with the route commit; no click/history interception.
  return <ViewTransition name="untangle-page" default="none" update={animate ? "page-crossfade" : "none"}>{children}</ViewTransition>;
}
