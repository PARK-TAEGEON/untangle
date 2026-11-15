"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { SavedCard } from "../lib/card-state";
import { todayInSeoul } from "../lib/dates";
import { ensureTodayRoster, fallbackTodayRoster, getServerTodayRosterSnapshot, getTodayRosterSnapshot, selectTodayRoster, subscribeTodayRoster } from "../lib/today-roster";
import type { WorkspaceData } from "../lib/workspace";

const empty: { cards: SavedCard[]; threads: SavedCard[] } = { cards: [], threads: [] };

export function useTodayRoster(workspace: WorkspaceData | null, cardLimit: 1 | 2 | 3, actualday = todayInSeoul()): { cards: SavedCard[]; threads: SavedCard[] } {
  const mode = workspace?.sample ? "sample" : "personal";
  const subscribe = useCallback((onChange: () => void) => subscribeTodayRoster(mode, onChange), [mode]);
  const snapshot = useCallback(() => getTodayRosterSnapshot(mode), [mode]);
  const roster = useSyncExternalStore(subscribe, snapshot, getServerTodayRosterSnapshot);
  useEffect(() => { if (workspace && roster?.day !== actualday) ensureTodayRoster(workspace, actualday); }, [workspace, roster, actualday]);
  return useMemo(() => workspace
    ? selectTodayRoster(workspace, roster?.day === actualday ? roster : fallbackTodayRoster(workspace, actualday), cardLimit, actualday)
    : empty, [workspace, roster, cardLimit, actualday]);
}
