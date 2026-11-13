"use client";

import { createContext, useContext, useId, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import Markdown from "react-markdown";
import type { Components, ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { setTaskChecked, taskMarkerOffset } from "../lib/head-start";
import { IconButton } from "./icons";

export interface HeadStartProps {
  content: string;
  onChange: (content: string) => void;
  readOnly?: boolean;
}

const HeadStartContext = createContext<HeadStartProps | null>(null);
const TaskContext = createContext<{ offset: number | null; label: string }>({ offset: null, label: "체크리스트 항목" });

interface TextNode {
  type: string;
  value?: string;
  tagName?: string;
  children?: readonly TextNode[];
}

function textLabel(node: TextNode | undefined): string {
  if (!node || node.tagName === "ul" || node.tagName === "ol") return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textLabel).join("");
}

function MarkdownTaskItem({ node, children, className, ...props }: ComponentPropsWithoutRef<"li"> & ExtraProps) {
  const context = useContext(HeadStartContext);
  const isTask = className?.split(/\s+/).includes("task-list-item");
  const offset = context && isTask ? taskMarkerOffset(context.content, node?.position?.start.offset, node?.position?.end.offset) : null;
  const label = textLabel(node).replace(/\s+/g, " ").trim() || "체크리스트 항목";
  return (
    <TaskContext.Provider value={{ offset, label }}>
      <li {...props} className={[className, offset === null ? "" : "hs-checkitem"].filter(Boolean).join(" ")}>{children}</li>
    </TaskContext.Provider>
  );
}

function MarkdownCheckbox({ checked }: ComponentPropsWithoutRef<"input"> & ExtraProps) {
  const context = useContext(HeadStartContext);
  const task = useContext(TaskContext);
  return <label className="hs-checkbox-target"><input
    type="checkbox"
    className="hs-checkbox"
    checked={Boolean(checked)}
    disabled={!context || context.readOnly || task.offset === null}
    aria-label={`${task.label} 완료`}
    onChange={(event) => {
      if (!context || context.readOnly || task.offset === null) return;
      context.onChange(setTaskChecked(context.content, task.offset, event.target.checked));
    }}
  /></label>;
}

const markdownComponents: Components = {
  li: MarkdownTaskItem,
  input: MarkdownCheckbox,
  ul({ node: _node, className, ...props }) {
    return <ul {...props} className={[className, className?.includes("contains-task-list") ? "hs-checklist" : ""].filter(Boolean).join(" ")} />;
  },
  ol({ node: _node, className, ...props }) {
    return <ol {...props} className={[className, className?.includes("contains-task-list") ? "hs-checklist" : ""].filter(Boolean).join(" ")} />;
  },
  table({ node: _node, children, ...props }) {
    return <div className="hs-table-wrap"><table {...props}>{children}</table></div>;
  },
  a({ node: _node, href, children, ...props }) {
    return href ? <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
  },
  // Draft previews do not fetch external image URLs supplied by imported text.
  img({ alt }) {
    return <span className="hs-image-alt">{alt || "이미지"}</span>;
  },
};

/** A controlled Markdown draft, reusable in a card detail panel or the component kit. */
export function HeadStart({ content, onChange, readOnly = false }: HeadStartProps) {
  const [editing, setEditing] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const editorId = useId();

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(content);
      setCopyMessage("초안을 복사했어요.");
    } catch {
      setCopyMessage("복사하지 못했어요. 원문을 선택해 복사해 주세요.");
    }
  }

  return <section className={readOnly ? "hs-root hs-readonly" : "hs-root"} aria-label="준비된 초안">
    <div className="hs-toolbar">
      {!readOnly && <IconButton icon={editing ? "preview" : "edit"} label={editing ? "미리보기" : "고치기"} aria-pressed={editing} onClick={() => { setEditing((current) => !current); setCopyMessage(""); }} />}
      <IconButton icon="copy" label="복사" onClick={copyDraft} />
    </div>
    {copyMessage && <p className="hs-message" role="status">{copyMessage}</p>}
    {editing && !readOnly ? <div className="hs-editor">
      <label htmlFor={editorId}>초안 원문</label>
      <textarea id={editorId} value={content} rows={12} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </div> : <div className="hs-preview">
      <HeadStartContext.Provider value={{ content, onChange, readOnly }}>
        <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>{content}</Markdown>
      </HeadStartContext.Provider>
    </div>}
  </section>;
}
