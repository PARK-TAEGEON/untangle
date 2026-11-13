"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "./workspace-provider";
import { MAX_PASTE_BYTES, pasteBytes, prepareOnboarding } from "../lib/onboarding";
import type { OnboardingPaste, OnboardingPreview } from "../lib/onboarding";
import { confirmOnboarding, matchPreviousTopics } from "../lib/workspace";
import type { Source, SuggestedState } from "../lib/types";
import { Brand, ThreadDrawing, TopicName } from "./ui";
import { SAMPLE_PERSONAS } from "../lib/sample-mode";
import type { SamplePersonaId } from "../lib/sample-mode";
import { ThemeToggle } from "./theme-toggle";
import { BackupMenu } from "./backup-menu";

const STEPS = ["프롬프트 복사", "결과 붙여넣기", "토픽 확인"];
const GROUPS: Array<{ state: SuggestedState; title: string; description: string }> = [
  { state: "active", title: "지금 할 일", description: "지금 이어갈 일을 모았어요." },
  { state: "later", title: "나중에", description: "필요할 때 다시 꺼낼 수 있어요." },
  { state: "remove", title: "정리해도 될 것", description: "시작할 때 목록에서 빼고 이름을 기억해 둘게요." },
];
const STATE_LABEL: Record<SuggestedState, string> = { active: "활성", later: "나중에", remove: "삭제" };
const SOURCE_LABEL: Record<Source, string> = { chatgpt: "ChatGPT", claude: "Claude", other: "기타" };

export function Onboarding({ exportPrompt }: { exportPrompt: string }) {
  const router = useRouter();
  const { workspace, ready, error: storageError, replace, mode, startSample, exitSample } = useWorkspace();
  const [step, setStep] = useState(0);
  const [pastes, setPastes] = useState<OnboardingPaste[]>([{ id: "paste-1", source: "chatgpt", text: "" }]);
  const [nextPasteId, setNextPasteId] = useState(2);
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, SuggestedState>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bytes = useMemo(() => pasteBytes(pastes), [pastes]);
  const sampleActive = mode === "sample";
  const hasExistingTopics = !sampleActive && Boolean(workspace?.topics.length);
  const previousTopics = useMemo(() => preview ? matchPreviousTopics(preview.data, workspace) : null, [preview, workspace]);

  useEffect(() => {
    if (!ready) return;
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step, ready]);

  function visibleTheme(id: string, importedTheme: string): string {
    const previous = previousTopics?.get(id);
    return previous ? previous.theme ?? "따로 뺀 토픽" : importedTheme;
  }

  function changePaste(id: string, change: Partial<Pick<OnboardingPaste, "source" | "text">>) {
    setPastes((current) => current.map((paste) => paste.id === id ? { ...paste, ...change } : paste));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setError(null);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(exportPrompt);
      setCopyMessage("복사했어요. ChatGPT나 Claude에 붙여넣어 주세요.");
    } catch {
      setCopyMessage("복사하지 못했어요. 아래 문구를 선택해 직접 복사해 주세요.");
    }
  }

  function inspectPastes() {
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    const result = prepareOnboarding(pastes, today, workspace?.removed_names ?? []);
    if (!result.ok) {
      setError(result.message);
      setFieldErrors(result.fieldErrors);
      return;
    }
    setPreview(result.preview);
    setDecisions(Object.fromEntries(result.preview.data.topics.map((topic) => [topic.id, topic.suggested_state])));
    setFieldErrors({});
    setError(null);
    setStep(2);
  }

  function moveGroup(from: SuggestedState, to: SuggestedState) {
    if (!preview) return;
    setDecisions((current) => {
      const next = { ...current };
      for (const topic of preview.data.topics) {
        if ((current[topic.id] ?? topic.suggested_state) === from) next[topic.id] = to;
      }
      return next;
    });
  }

  function startWorkspace() {
    if (!preview || saving || sampleActive) return;
    setSaving(true);
    setError(null);
    try {
      const next = confirmOnboarding(preview.data, decisions, workspace, new Date().toISOString());
      if (replace({ ...next, selected_topic_id: null })) router.push("/");
      else setError("저장하지 못했어요. 브라우저의 저장 공간을 확인하고 다시 시도해 주세요.");
    } catch {
      setError("저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  function chooseSample(persona: SamplePersonaId) {
    if (startSample(persona)) router.push("/");
  }

  function startPersonal() {
    if (exitSample()) { setStep(0); setPreview(null); setError(null); }
  }

  if (!ready) return <main className="ob-shell"><p className="ob-hint" role="status">저장한 내용을 확인하고 있어요.</p></main>;

  return (
    <main className="ob-shell">
      <header className="ob-header">
        <Brand href={hasExistingTopics || sampleActive ? "/" : "/start"} />
        <div className="ob-header-actions"><ThemeToggle /><BackupMenu onRestored={() => router.push("/")} />
          {!sampleActive && <>{hasExistingTopics && <Link href="/" className="ob-button ob-button-quiet">취소하고 대시보드로</Link>}
          <button type="button" className="ob-button" aria-expanded={showSamples} onClick={() => setShowSamples((current) => !current)}>샘플로 둘러보기</button></>}
        </div>
      </header>
      {sampleActive && <section className="sample-banner" aria-label="샘플 모드"><div className="sample-banner-copy"><strong>샘플 데이터로 보는 중</strong><p>가상 인물의 예시예요. 내 기록은 별도로 보관돼요.</p></div><button type="button" className="ob-button ob-button-primary" onClick={startPersonal}>내 기록으로 시작하기</button></section>}
      <section aria-label="샘플로 둘러보기">
        {(showSamples || sampleActive) && <><h2>어떤 하루를 둘러볼까요?</h2><p className="ob-hint">가상으로 만든 두 사람의 기록이에요. 준비된 카드로 바로 둘러볼 수 있어요.</p><div className="sample-personas">{SAMPLE_PERSONAS.map((persona) => <button type="button" className="sample-persona" key={persona.id} aria-pressed={workspace?.sample?.persona === persona.id} onClick={() => chooseSample(persona.id)}><strong>{persona.title}</strong><span>{persona.description}</span></button>)}</div></>}
      </section>
      {!sampleActive && <ol className="ob-progress" aria-label="가져오기 단계">
        {STEPS.map((name, index) => <li key={name} aria-current={step === index ? "step" : undefined}><span>{index + 1}</span> {name}</li>)}
      </ol>}

      {storageError && <p className="ob-error" role="alert">{storageError}</p>}
      {error && <p className="ob-error" role="alert">{error}</p>}
      {hasExistingTopics && <p className="ob-replace-note">마지막에 ‘이대로 시작’을 누르면 지금 목록이 새 토픽으로 바뀝니다. 이전에 삭제한 토픽 이름은 유지돼요.</p>}

      {!sampleActive && step === 0 && <section className="ob-panel" aria-labelledby="ob-prompt-title">
        <h1 ref={headingRef} tabIndex={-1} id="ob-prompt-title">지금까지 한 일을 가져와 볼까요?</h1>
        <p className="ob-hint">ChatGPT나 Claude에 붙여넣고 답을 복사해 오세요.</p>
        <p className="ob-hint">결과가 끊기면 ‘계속’이라고 입력하세요.</p>
        <div className="ob-actions">
          <button type="button" className="ob-button ob-button-primary" onClick={copyPrompt}>프롬프트 복사</button>
          <button type="button" className="ob-button" onClick={() => setStep(1)}>결과 붙여넣기</button>
        </div>
        <p className="ob-hint" role="status">{copyMessage}</p>
        <pre className="ob-prompt" tabIndex={0} aria-label="내보내기 프롬프트">{exportPrompt}</pre>
      </section>}

      {!sampleActive && step === 1 && <section className="ob-panel" aria-labelledby="ob-paste-title">
        <h1 ref={headingRef} tabIndex={-1} id="ob-paste-title">AI에서 받은 결과를 붙여넣어 주세요</h1>
        <p className="ob-hint">여러 결과를 함께 가져올 수 있어요. 내용은 이 브라우저에만 저장됩니다.</p>
        <div className="ob-paste-list">
          {pastes.map((paste, index) => <div className="ob-paste" key={paste.id}>
            <div className="ob-group-header">
              <h2>결과 {index + 1}</h2>
              {pastes.length > 1 && <button type="button" className="ob-button ob-button-quiet" aria-label={`결과 ${index + 1} 제거`} onClick={() => {
                setPastes((current) => current.filter((item) => item.id !== paste.id));
                setFieldErrors((current) => { const next = { ...current }; delete next[paste.id]; return next; });
                setError(null);
              }}>제거</button>}
            </div>
            <label className="ob-field" htmlFor={`${paste.id}-source`}>출처
              <select id={`${paste.id}-source`} value={paste.source} onChange={(event) => changePaste(paste.id, { source: event.target.value as Source })}>
                <option value="chatgpt">ChatGPT</option><option value="claude">Claude</option><option value="other">기타</option>
              </select>
            </label>
            <label className="ob-field" htmlFor={`${paste.id}-text`}>내보내기 결과
              <textarea id={`${paste.id}-text`} value={paste.text} rows={14} spellCheck={false} placeholder="## 나로 시작하는 결과를 그대로 붙여넣어 주세요." aria-invalid={Boolean(fieldErrors[paste.id])} aria-describedby={fieldErrors[paste.id] ? `${paste.id}-error` : undefined} onChange={(event) => changePaste(paste.id, { text: event.target.value })} />
            </label>
            {fieldErrors[paste.id] && <p id={`${paste.id}-error`} className="ob-error" role="alert">{fieldErrors[paste.id]}</p>}
          </div>)}
        </div>
        <p className={bytes > MAX_PASTE_BYTES ? "ob-size ob-error" : "ob-size"} aria-live="polite">붙여넣기 합계 {(bytes / 1024).toFixed(1)} / 200KB</p>
        <div className="ob-actions">
          <button type="button" className="ob-button" onClick={() => {
            setPastes((current) => [...current, { id: `paste-${nextPasteId}`, source: "claude", text: "" }]);
            setNextPasteId((current) => current + 1);
          }}>다른 AI 결과 추가</button>
          <button type="button" className="ob-button ob-button-quiet" onClick={() => { setStep(0); setError(null); }}>프롬프트 다시 보기</button>
          <button type="button" className="ob-button ob-button-primary" onClick={inspectPastes}>토픽 확인하기</button>
        </div>
      </section>}

      {!sampleActive && step === 2 && preview && <section className="ob-panel" aria-labelledby="ob-confirm-title">
        <h1 ref={headingRef} tabIndex={-1} id="ob-confirm-title">프로젝트 {preview.data.topics.length}개를 찾았어요</h1>
        <p className="ob-hint">먼저 세 묶음으로 나눠 봤어요. 틀린 것만 옮기면 돼요.</p>
        <ThreadDrawing variant="onboarding" themes={preview.data.themes.length} />
        {preview.needsManualReview && <p className="ob-replace-note">여러 결과를 가져왔어요. 같은 토픽도 각각 표시되니 겹친 항목은 직접 정리해 주세요.</p>}
        {preview.removedCount > 0 && <p className="ob-hint">예전에 삭제한 토픽 {preview.removedCount}개는 다시 가져오지 않았어요.</p>}
        <div className="ob-confirm-groups">
          {GROUPS.map((group) => {
            const topics = preview.data.topics.filter((topic) => (decisions[topic.id] ?? topic.suggested_state) === group.state);
            return <section key={group.state} className={`ob-group ob-group-${group.state}`} aria-labelledby={`ob-${group.state}-title`}>
              <div className="ob-group-header">
                <h2 id={`ob-${group.state}-title`}>{group.title} <span>{topics.length}</span></h2>
                <div className="ob-actions">
                  <button type="button" className="ob-button ob-button-quiet" disabled={topics.length === 0 || group.state === "later"} onClick={() => moveGroup(group.state, "later")}>전부 나중에</button>
                  <button type="button" className="ob-button ob-button-quiet" disabled={topics.length === 0 || group.state === "remove"} onClick={() => moveGroup(group.state, "remove")}>전부 삭제</button>
                </div>
              </div>
              <p className="ob-hint">{group.description}</p>
              {topics.length === 0 ? <p className="ob-empty">이 묶음에는 토픽이 없어요.</p> : <ul className="ob-topic-list">
                {topics.map((topic) => {
                  const sourceLabels = topic.sources.filter((source) => source !== "other").map((source) => SOURCE_LABEL[source]);
                  return <li className="ob-topic" key={topic.id}>
                  <TopicName name={topic.name} themeIndex={preview.data.themes.indexOf(visibleTheme(topic.id, topic.theme))} />
                  <div className="ob-topic-meta"><span className="ob-chip">{visibleTheme(topic.id, topic.theme)}</span>{sourceLabels.length > 0 && <span className="ob-chip">{sourceLabels.join(" · ")}</span>}</div>
                  <p>{topic.one_liner}</p>
                  <p className="ob-hint">처음 제안한 까닭: {topic.suggested_reason}</p>
                  <div className="ob-topic-actions" aria-label={`${topic.name} 묶음 이동`}>
                    {GROUPS.map(({ state }) => <button key={state} type="button" className="ob-button ob-button-quiet" aria-pressed={(decisions[topic.id] ?? topic.suggested_state) === state} disabled={(decisions[topic.id] ?? topic.suggested_state) === state} onClick={() => setDecisions((current) => ({ ...current, [topic.id]: state }))}>{STATE_LABEL[state]}</button>)}
                  </div>
                </li>;
                })}
              </ul>}
            </section>;
          })}
        </div>
        <div className="ob-confirm-footer">
          <p className="ob-hint">내용은 이 브라우저에만 저장돼요.</p>
          <div className="ob-actions">
          <button type="button" className="ob-button" onClick={() => { setStep(1); setError(null); }}>원문 고치기</button>
          <button type="button" className="ob-button ob-button-primary" disabled={saving} onClick={startWorkspace}>{saving ? "저장 중이에요" : "이대로 시작"}</button>
          </div>
        </div>
      </section>}
    </main>
  );
}
