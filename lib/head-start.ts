/** Locate the checkbox's single state character from a parsed list item's source offset. */
export function taskMarkerOffset(content: string, itemOffset: number | undefined, itemEnd = content.length): number | null {
  if (itemOffset === undefined || !Number.isInteger(itemOffset) || itemOffset < 0 || itemOffset >= content.length) return null;
  const newline = content.indexOf("\n", itemOffset);
  const line = content.slice(itemOffset, newline < 0 ? undefined : newline).replace(/\r$/, "");
  const listMarker = line.match(/^[\t ]*(?:[-+*]|\d{1,9}[.)])(?:[\t ]+|$)/);
  if (!listMarker) return null;
  const firstContent = line.slice(listMarker[0].length);
  if (/^\[([ xX])\](?:[\t ]|$)/.test(firstContent)) return itemOffset + listMarker[0].length + 1;
  if (firstContent.trim() || newline < 0) return null;

  // GFM also permits the first paragraph (and task marker) on the next line.
  let offset = newline + 1;
  while (offset < Math.min(itemEnd, content.length)) {
    const end = content.indexOf("\n", offset);
    const continuation = content.slice(offset, end < 0 ? itemEnd : Math.min(end, itemEnd)).replace(/\r$/, "");
    if (continuation.trim()) {
      const marker = continuation.match(/^[\t ]*(?:>[\t ]*)*\[([ xX])\](?:[\t ]|$)/);
      return marker ? offset + marker[0].indexOf("[") + 1 : null;
    }
    if (end < 0) break;
    offset = end + 1;
  }
  return null;
}

/** Preserve every other source character, including Markdown syntax and line endings. */
export function setTaskChecked(content: string, offset: number, checked: boolean): string {
  if (!Number.isInteger(offset) || offset < 1 || offset >= content.length - 1 ||
    content[offset - 1] !== "[" || content[offset + 1] !== "]" || !/[ xX]/.test(content[offset])) return content;
  const wasChecked = content[offset].toLowerCase() === "x";
  if (wasChecked === checked) return content;
  return content.slice(0, offset) + (checked ? "x" : " ") + content.slice(offset + 1);
}
