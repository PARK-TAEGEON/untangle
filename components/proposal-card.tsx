"use client";

import { useId, useRef, useState } from "react";
import type { Nudge } from "../lib/card-types";
import { buildHandoff } from "../lib/handoff";
import type { WorkspaceTopic } from "../lib/workspace";
import { HeadStart } from "./head-start";
import { ThreadDrawing, TopicName, topicThreadStyle } from "./ui";
import { IconButton, LineIcon } from "./icons";

function HandoffMenu({ onChoose }: { onChoose: (service: "claude" | "chatgpt") => Promise<void> }) {
  const menu = useRef<HTMLDetailsElement>(null);
  function choose(service: "claude" | "chatgpt") {
    if (menu.current) menu.current.open = false;
    void onChoose(service);
  }
  return <details className="handoff-menu" ref={menu} onKeyDown={(event) => {
    if (event.key === "Escape" && menu.current?.open) {
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    }
  }}>
    <summary className="icon-button" aria-label="다른 AI에서 이어가기" title="다른 AI에서 이어가기" data-tooltip="다른 AI에서 이어가기"><LineIcon name="external" /></summary>
    <div className="handoff-menu-panel">
      <button type="button" className="button button-quiet" onClick={() => choose("claude")}>Claude에서 이어가기 ↗</button>
      <button type="button" className="button button-quiet" onClick={() => choose("chatgpt")}>ChatGPT에서 이어가기 ↗</button>
    </div>
  </details>;
}

export interface ProposalCardProps {
  nudge: Nudge;
  content: string;
  topic?: WorkspaceTopic;
  themeIndex?: number;
  accepted?: boolean;
  stale?: boolean;
  finishing?: boolean;
  onContentChange: (content: string) => void;
  onAccept: () => void;
  onComplete: (note: string) => void;
  onSnooze: () => void;
  onDismiss: () => void;
  onAnswer: (id: string) => void;
  onContinue: () => void;
}

export function SmallProposal({ nudge, topic, themeIndex = -1, accepted, stale, selected, onClick }: {
  nudge: Nudge; topic?: WorkspaceTopic; themeIndex?: number; accepted?: boolean; stale?: boolean; selected?: boolean; onClick: () => void;
}) {
  return <button type="button" className={`small-proposal small-proposal-${nudge.slot}${selected ? " is-selected" : ""}`} style={topicThreadStyle(themeIndex)} onClick={onClick} aria-pressed={selected}>
    <span className="small-proposal-meta"><TopicName name={topic?.name ?? nudge.new_topic_name ?? "새로운 연결"} themeIndex={themeIndex} /><span>{nudge.est_minutes}분</span></span>
    <strong>{nudge.title}</strong>{stale && <span className="small-proposal-action">이어서 할까요, 접을까요?</span>}<span className="small-proposal-open">{accepted ? "진행 중 카드 펼쳐보기" : "펼쳐보기"}</span>
  </button>;
}

export function ProposalCard({ nudge, content, topic, themeIndex = -1, accepted, stale, finishing, onContentChange, onAccept, onComplete, onSnooze, onDismiss, onAnswer, onContinue }: ProposalCardProps) {
  const id = useId();
  const [completing, setCompleting] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  async function handoff(service: "claude" | "chatgpt") {
    const target = window.open("about:blank", "_blank");
    if (target) target.opener = null;
    try {
      await navigator.clipboard.writeText(buildHandoff(topic, nudge, content));
      if (target) target.location.href = service === "claude" ? "https://claude.ai/new" : "https://chatgpt.com/";
      setMessage(target ? "고친 초안과 넘기기 문구를 복사했어요. 새 대화에 붙여넣어 주세요." : "넘기기 문구를 복사했어요. 새 탭이 차단되어 서비스를 직접 열어 주세요.");
    } catch {
      target?.close();
      setMessage("복사하지 못했어요. 초안의 복사 버튼으로 다시 시도해 주세요.");
    }
  }

  return <article className={`proposal-card proposal-${nudge.slot}${finishing ? " is-finishing" : ""}`} style={topicThreadStyle(themeIndex)} aria-labelledby={`${id}-title`} inert={finishing}>
    <ThreadDrawing variant="card" straight={finishing} />
    <div className="proposal-meta"><TopicName name={topic?.name ?? nudge.new_topic_name ?? "새로운 연결"} themeIndex={themeIndex} /><span className="proposal-time">{nudge.est_minutes}분</span></div>
    <header className="proposal-heading"><h2 id={`${id}-title`}>{nudge.title}</h2></header>
    <details className="proposal-why"><summary>왜?</summary><p>{nudge.why_now}</p><p className="proposal-action">{nudge.action}</p><ul className="proposal-evidence">{nudge.evidence.map((entry, index) => <li key={index}><span className="chip">{entry.source === "topic" ? "토픽" : entry.source === "profile" ? "프로필" : "피드백"}</span>{entry.fact}</li>)}</ul></details>
    <section className="proposal-draft" aria-label="준비된 초안"><div className="draft-label"><span className="section-kicker">초안</span></div><HeadStart content={content} onChange={onContentChange} /></section>
    {nudge.type === "unblock" && <div className="question-options" aria-label="질문의 답 고르기">{nudge.head_start.options.map((option) => <button key={option.id} type="button" className="button" onClick={() => onAnswer(option.id)}>{option.label}</button>)}</div>}
    <div className="first-step"><span className="first-step-symbol" aria-hidden="true">↳</span><div><strong>먼저 이것만</strong><p>{nudge.first_step}</p></div></div>
    {stale && <div className="stale-card"><p>이어서 할까요, 접을까요?</p><div className="button-row"><button type="button" className="button button-secondary" onClick={onContinue}>이어서 할게요</button><button type="button" className="button button-quiet" onClick={onDismiss}>접을게요</button></div></div>}
    {!completing && <div className="proposal-actions">
      {accepted ? <button type="button" className="button button-start" onClick={() => setCompleting(true)}>다 했어요</button> : <button type="button" className="button button-start" onClick={onAccept}>시작</button>}
      <IconButton icon="clock" label="나중에" onClick={onSnooze} />
      <IconButton icon="close" label="관심 없어요" onClick={onDismiss} />
      <HandoffMenu onChoose={handoff} />
    </div>}
    {completing && <form className="completion-form" onSubmit={(event) => { event.preventDefault(); onComplete(note); }}><label htmlFor={`${id}-note`}>남겨둘 한 줄 <span className="muted">(선택)</span></label><input id={`${id}-note`} autoFocus maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} placeholder="어떻게 마무리했나요?" /><div className="proposal-actions"><button type="submit" className="button button-primary">완료로 남기기</button><button type="button" className="button button-quiet" onClick={() => setCompleting(false)}>취소</button><HandoffMenu onChoose={handoff} /></div></form>}
    {message && <p className="inline-message" role="status">{message}</p>}
  </article>;
}
