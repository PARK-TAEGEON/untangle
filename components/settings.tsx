"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { resetPreferencesView, savePreferences, type Preferences } from "../lib/preferences";
import { getServerThemePreferenceSnapshot, getThemePreferenceSnapshot, setThemePreference, subscribeTheme, THEME_CHANGE_EVENT, type ThemePreference } from "../lib/theme";
import { AppChrome } from "./app-chrome";
import { BackupMenu } from "./backup-menu";
import { usePreferences } from "./use-preferences";
import { useWorkspace } from "./workspace-provider";

export function Settings({ exportPrompt }: { exportPrompt: string }) {
  const preferences = usePreferences();
  const theme = useSyncExternalStore(subscribeTheme, getThemePreferenceSnapshot, getServerThemePreferenceSnapshot);
  const { clearAppData, error } = useWorkspace();
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { if (confirming && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [confirming]);

  function change(next: Partial<Preferences>) {
    try { savePreferences({ ...preferences, ...next }); setNotice(null); }
    catch { setNotice("설정을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요."); }
  }
  function cancel() { dialog.current?.close(); setConfirming(false); setClearFailed(false); }

  return <AppChrome active="settings"><main className="preferences-page"><h1>설정</h1><div className="preferences-panel">
    <div className="preferences-field"><label htmlFor="setting-theme">화면 밝기</label><select id="setting-theme" value={theme} onChange={(event) => {
      try { setThemePreference(event.target.value as ThemePreference); setNotice(null); }
      catch { setNotice("화면 밝기를 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요."); }
    }}><option value="system">기기 설정</option><option value="light">밝게</option><option value="dark">어둡게</option></select></div>
    <div className="preferences-field"><label htmlFor="setting-text">글자 크기</label><select id="setting-text" value={preferences.textSize} onChange={(event) => change({ textSize: event.target.value as Preferences["textSize"] })}><option value="normal">보통</option><option value="large">크게</option></select></div>
    <div className="preferences-field"><div className="preferences-options"><label><input type="checkbox" checked={preferences.reduceMotion} onChange={(event) => change({ reduceMotion: event.target.checked })} />움직임 줄이기</label></div></div>
    <div className="preferences-field"><label htmlFor="setting-count">하루 카드 수</label><select id="setting-count" value={preferences.cardLimit} onChange={(event) => change({ cardLimit: Number(event.target.value) as Preferences["cardLimit"] })}><option value="1">1장</option><option value="2">2장</option><option value="3">3장</option></select><p>받은 카드 중 오늘 화면에 보여줄 개수예요.</p></div>
    <section className="preferences-field" aria-label="백업"><h2>백업</h2><BackupMenu variant="inline" /></section>
    <div className="preferences-field"><div className="preferences-options"><button type="button" className="button button-secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(exportPrompt); setNotice("내보내기 프롬프트를 복사했어요."); }
      catch { setNotice("복사하지 못했어요. 내 기록 가져오기 화면에서 다시 시도해 주세요."); }
    }}>내보내기 프롬프트 다시 복사</button></div></div>
    <div className="preferences-field"><div className="preferences-options"><button type="button" className="button button-secondary" onClick={() => { setClearFailed(false); setConfirming(true); }}>모두 지우기</button></div><p>내 기록, 샘플 기록과 설정을 이 브라우저에서 지워요.</p></div>
  </div>{notice && <p role="status">{notice}</p>}
  {confirming && <dialog ref={dialog} className="backup-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); cancel(); }}><h2 id={titleId}>모두 지울까요?</h2><p>내 기록, 샘플 기록, 지난 토픽과 설정을 지웁니다. 되돌릴 수 없으니 필요한 기록은 먼저 내보내 주세요.</p>{clearFailed && <p role="alert">{error || "지우지 못했어요. 브라우저 저장 공간을 확인해 주세요."}</p>}<div className="button-row"><button type="button" className="button button-secondary" autoFocus onClick={cancel}>취소</button><button type="button" className="button button-primary" onClick={() => {
    if (!clearAppData()) { setClearFailed(true); return; }
    resetPreferencesView();
    delete document.documentElement.dataset.theme;
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    cancel(); router.replace("/welcome");
  }}>모두 지우기</button></div></dialog>}
  </main></AppChrome>;
}
