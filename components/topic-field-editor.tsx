"use client";

import { useId, useState } from "react";
import { editTopicField } from "../lib/topic-edit";
import type { EditableTopicField } from "../lib/topic-edit";
import { IconButton } from "./icons";
import { useWorkspace } from "./workspace-provider";

export function TopicFieldEditor({ topicId, field, title, value }: { topicId: string; field: EditableTopicField; title: string; value: string | string[] | null }) {
  const { update } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const helpId = useId();
  const begin = () => {
    setDraft(Array.isArray(value) ? value.join("\n") : value ?? "");
    setError(null);
    setEditing(true);
  };
  return <section className="detail-section topic-editable-field">
    <div className="topic-field-heading"><h2>{title}</h2>{!editing && <IconButton icon="edit" label={`${title} 고치기`} onClick={begin} />}</div>
    {editing ? <form className="topic-field-form" onSubmit={(event) => {
      event.preventDefault();
      if (update((previous) => editTopicField(previous, topicId, field, draft))) {
        setEditing(false);
        setError(null);
      } else {
        setError("저장하지 못했어요. 입력한 내용은 남겨두었어요. 브라우저 저장소를 확인하고 다시 저장해 주세요.");
      }
    }}>
      <label className="sr-only" htmlFor={inputId}>{title}</label>
      <textarea id={inputId} value={draft} onChange={(event) => setDraft(event.target.value)} rows={field === "next_steps" ? 4 : 3} autoFocus aria-describedby={field === "next_steps" ? helpId : undefined} />
      {field === "next_steps" && <p className="muted topic-field-help" id={helpId}>할 일 하나를 한 줄에 적어 주세요.</p>}
      {error && <p role="alert" className="app-error">{error}</p>}
      <div className="button-row" aria-label={`${title} 편집`}><button type="submit" className="button button-secondary">저장</button><button type="button" className="button button-quiet" onClick={() => { setEditing(false); setError(null); }}>취소</button></div>
    </form> : Array.isArray(value) ? (value.length > 0 ? <ul>{value.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted">아직 정리된 내용이 없어요.</p>) : <p className={value ? "" : "muted"}>{value || "아직 정리된 내용이 없어요."}</p>}
  </section>;
}
