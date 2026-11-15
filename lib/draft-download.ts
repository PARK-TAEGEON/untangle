/** Download the current Markdown source locally; no input or content leaves the browser. */
export function downloadDraft(content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8", endings: "transparent" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  let started = false;
  const release = () => { try { URL.revokeObjectURL(url); } catch { /* Cleanup must not undo a started download. */ } };
  try {
    link.href = url;
    link.download = "untangle-초안.md";
    link.hidden = true;
    document.body.append(link);
    link.click();
    started = true;
  } finally {
    link.remove();
    if (started) {
      // The browser may consume the URL after the click handler has returned.
      try { window.setTimeout(release, 1000); } catch { release(); }
    } else release();
  }
}
