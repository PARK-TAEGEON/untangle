"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { loadWorkspace, saveWorkspace, SAMPLE_WORKSPACE_STORAGE_KEY, WORKSPACE_MODE_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from "../lib/storage";
import { createSampleWorkspace } from "../lib/sample-mode";
import type { SamplePersonaId } from "../lib/sample-mode";
import { todayInSeoul } from "../lib/dates";
import type { WorkspaceData } from "../lib/workspace";
import { prepareWorkspaceRestore } from "../lib/backup";

interface WorkspaceContextValue {
  workspace: WorkspaceData | null;
  ready: boolean;
  error: string | null;
  update: (fn: (previous: WorkspaceData) => WorkspaceData) => boolean;
  replace: (data: WorkspaceData) => boolean;
  restore: (data: WorkspaceData) => boolean;
  mode: "personal" | "sample";
  startSample: (persona: SamplePersonaId) => boolean;
  exitSample: () => boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const message = (error: unknown) => {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) return "브라우저 저장소를 열지 못했어요. 저장소 설정을 확인해 주세요.";
  return error instanceof Error ? error.message : "자료를 저장하지 못했어요. 다시 시도해 주세요.";
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"personal" | "sample">("personal");
  const current = useRef<WorkspaceData | null>(null);
  const loaded = useRef(false);
  const currentMode = useRef<"personal" | "sample">("personal");

  useEffect(() => {
    const read = () => {
      try {
        const nextMode = window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY) === "sample" ? "sample" : "personal";
        const data = loadWorkspace(window.localStorage, nextMode === "sample" ? SAMPLE_WORKSPACE_STORAGE_KEY : WORKSPACE_STORAGE_KEY);
        if (nextMode === "sample" && !data?.sample) throw new Error("샘플 자료를 읽지 못했어요. 샘플을 다시 골라 주세요.");
        current.current = data;
        currentMode.current = nextMode;
        setWorkspace(data);
        setMode(nextMode);
        setError(null);
      } catch (cause) {
        setError(message(cause));
      } finally {
        loaded.current = true;
        setReady(true);
      }
    };
    read();
    const onStorage = (event: StorageEvent) => {
      if (![WORKSPACE_STORAGE_KEY, SAMPLE_WORKSPACE_STORAGE_KEY, WORKSPACE_MODE_STORAGE_KEY, null].includes(event.key)) return;
      try {
        if (event.storageArea !== null && event.storageArea !== window.localStorage) return;
      } catch (cause) {
        setError(message(cause));
        return;
      }
      read();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      loaded.current = false;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Persist only explicit actions after hydration, never an initial empty render or a storage event.
  const replace = useCallback((data: WorkspaceData): boolean => {
    if (!loaded.current) return false;
    try {
      const nextMode = data.sample ? "sample" : "personal";
      saveWorkspace(window.localStorage, data, data.sample ? SAMPLE_WORKSPACE_STORAGE_KEY : WORKSPACE_STORAGE_KEY);
      window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, nextMode);
      current.current = data;
      currentMode.current = nextMode;
      setWorkspace(data);
      setMode(nextMode);
      setError(null);
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    }
  }, []);

  /** Backup restoration writes one existing mode only; failure cannot change its mode flag or UI. */
  const restore = useCallback((data: WorkspaceData): boolean => {
    if (!loaded.current) return false;
    try {
      const restored = prepareWorkspaceRestore(data, currentMode.current, todayInSeoul());
      saveWorkspace(window.localStorage, restored, currentMode.current === "sample" ? SAMPLE_WORKSPACE_STORAGE_KEY : WORKSPACE_STORAGE_KEY);
      current.current = restored;
      setWorkspace(restored);
      setError(null);
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    }
  }, []);

  const startSample = useCallback((persona: SamplePersonaId): boolean => {
    if (!loaded.current) return false;
    return replace(createSampleWorkspace(persona, new Date().toISOString(), todayInSeoul()));
  }, [replace]);

  const exitSample = useCallback((): boolean => {
    if (!loaded.current) return false;
    try {
      const data = loadWorkspace(window.localStorage);
      window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, "personal");
      current.current = data;
      currentMode.current = "personal";
      setWorkspace(data);
      setMode("personal");
      setError(null);
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    }
  }, []);

  const update = useCallback((fn: (previous: WorkspaceData) => WorkspaceData): boolean => {
    if (!loaded.current || current.current === null) return false;
    try {
      const next = fn(current.current);
      return replace(next);
    } catch (cause) {
      setError(message(cause));
      return false;
    }
  }, [replace]);

  return <WorkspaceContext.Provider value={{ workspace, ready, error, update, replace, restore, mode, startSample, exitSample }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (context === null) throw new Error("useWorkspace는 WorkspaceProvider 안에서 사용해야 합니다.");
  return context;
}
