"use client";

import { useEffect, useId, useRef, useState } from "react";
import { parseWorkspaceBackup, serializeWorkspaceBackup } from "../lib/backup";
import { todayInSeoul } from "../lib/dates";
import type { WorkspaceData } from "../lib/workspace";
import { LineIcon } from "./icons";
import { useWorkspace } from "./workspace-provider";

export function BackupMenu({ onRestored, variant = "menu" }: { onRestored?: () => void; variant?: "menu" | "inline" }) {
  const { workspace, mode, restore } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const readSequence = useRef(0);
  const [pending, setPending] = useState<{ data: WorkspaceData; name: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (pending && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [pending]);

  const cancel = () => { dialog.current?.close(); setPending(null); setImportError(null); };
  const exportFile = () => {
    if (!workspace) return;
    if (menu.current) menu.current.open = false;
    try {
      const text = serializeWorkspaceBackup(workspace, new Date().toISOString());
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `untangle-${mode === "sample" ? "sample-" : ""}${todayInSeoul()}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("백업 파일을 내려받았어요.");
    } catch {
      setMessage("백업 파일을 만들지 못했어요. 다시 시도해 주세요.");
    }
  };

  const controls = <><button type="button" className={variant === "inline" ? "button button-secondary" : undefined} disabled={!workspace} onClick={exportFile}>내보내기</button><button type="button" className={variant === "inline" ? "button button-secondary" : undefined} disabled={reading} onClick={() => {
        if (menu.current) menu.current.open = false;
        setMessage(null);
        input.current?.click();
      }}>가져오기</button></>;
  return <div className={`backup-control${variant === "inline" ? " backup-inline" : ""}`}>
    {variant === "inline" ? <div className="button-row" aria-label="백업 파일">{controls}</div> : <details ref={menu} className="backup-menu"><summary className="icon-button" aria-label="자료 메뉴" title="자료 메뉴" data-tooltip="자료 메뉴"><LineIcon name="more" /></summary><div className="backup-menu-items">{controls}</div></details>}
    <input ref={input} className="backup-file-input" type="file" accept=".json,application/json" aria-label="가져올 백업 파일" onChange={async (event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;
      const sequence = ++readSequence.current;
      setMessage(null); setImportError(null); setReading(true);
      try {
        const data = parseWorkspaceBackup(await file.text(), mode, todayInSeoul());
        if (sequence === readSequence.current) setPending({ data, name: file.name });
      } catch (cause) {
        if (sequence === readSequence.current) setMessage(cause instanceof Error ? cause.message : "파일을 읽지 못했어요. 기존 자료는 그대로 보관했어요.");
      } finally {
        if (sequence === readSequence.current) setReading(false);
      }
    }} />
    {message && <div className="backup-notice" role="status"><span>{message}</span><button type="button" className="button-quiet" onClick={() => setMessage(null)}>닫기</button></div>}
    {pending && <dialog ref={dialog} className="backup-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); cancel(); }}>
      <h2 id={titleId}>백업으로 바꿀까요?</h2><p className="muted">{pending.name}</p>
      <p id={descriptionId}>토픽 {pending.data.topics.length}개와 지난 토픽 {pending.data.completed_steps?.length ?? 0}개를 가져와요. 현재 {mode === "sample" ? "샘플" : "내"} 기록을 이 파일의 내용으로 교체합니다.</p>
      <p className="muted">다른 모드의 기록은 그대로 보관해요.</p>
      {importError && <p role="alert">{importError}</p>}
      <div className="button-row"><button type="button" className="button button-secondary" autoFocus onClick={cancel}>취소</button><button type="button" className="button button-primary" onClick={() => {
        if (restore(pending.data)) { cancel(); setMessage("백업에서 기록을 가져왔어요."); onRestored?.(); }
        else setImportError("백업으로 바꾸지 못했어요. 기존 자료는 그대로 보관했어요. 저장 공간과 현재 모드를 확인해 주세요.");
      }}>교체해서 가져오기</button></div>
    </dialog>}
  </div>;
}
