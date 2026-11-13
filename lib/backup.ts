import { getCardState } from "./card-state";
import { archiveCompletedSteps } from "./history";
import { loadWorkspace } from "./storage";
import type { WorkspaceData } from "./workspace";

export interface WorkspaceBackup {
  format: "untangle-backup";
  version: 1;
  exported_at: string;
  workspace: WorkspaceData;
}

const invalid = () => new Error("Untangle 백업 파일을 읽지 못했어요. 기존 자료는 그대로 보관했어요.");

function checkedWorkspace(value: unknown): WorkspaceData {
  try {
    const workspace = loadWorkspace({ getItem: () => JSON.stringify(value) });
    if (!workspace) throw invalid();
    return workspace;
  } catch {
    throw invalid();
  }
}

export function serializeWorkspaceBackup(workspace: WorkspaceData, now: string): string {
  // The JSON copy excludes in-memory request guards and validates persisted app data.
  const data = archiveCompletedSteps(checkedWorkspace(workspace));
  return JSON.stringify({
    format: "untangle-backup", version: 1, exported_at: now,
    workspace: { ...data, cards: { ...getCardState(data), request_id: null } },
  } satisfies WorkspaceBackup, null, 2);
}

export function parseWorkspaceBackup(text: string, mode: "personal" | "sample", today: string): WorkspaceData {
  let backup: unknown;
  try { backup = JSON.parse(text); } catch { throw invalid(); }
  if (typeof backup !== "object" || backup === null || Array.isArray(backup)) throw invalid();
  const candidate = backup as Partial<WorkspaceBackup>;
  if (candidate.format !== "untangle-backup" || candidate.version !== 1
    || typeof candidate.exported_at !== "string" || !Number.isFinite(Date.parse(candidate.exported_at))) throw invalid();
  return prepareWorkspaceRestore(checkedWorkspace(candidate.workspace), mode, today);
}

/** Shared with the provider so stale request tokens cannot enter through another restore caller. */
export function prepareWorkspaceRestore(workspace: WorkspaceData, mode: "personal" | "sample", today: string): WorkspaceData {
  const data = archiveCompletedSteps(checkedWorkspace(workspace));
  if (Boolean(data.sample) !== (mode === "sample")) {
    throw new Error(mode === "sample" ? "샘플 모드에서는 샘플 백업만 가져올 수 있어요. 내 기록은 ‘내 기록으로 시작하기’에서 가져와 주세요."
      : "이 파일은 샘플 백업이에요. 샘플 모드에서 가져와 주세요.");
  }
  // Restoring a backup is not a paid generation request, even when its original date is old.
  return { ...data, cards: { ...getCardState(data), generated_date: today, error: null, request_id: null } };
}
