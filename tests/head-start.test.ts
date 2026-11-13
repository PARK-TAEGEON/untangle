import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HeadStart } from "../components/head-start";
import { setTaskChecked, taskMarkerOffset } from "../lib/head-start";

describe("precise task-list source updates", () => {
  it("changes only the selected marker in duplicate task labels while preserving CRLF and other syntax", () => {
    const content = "# 초안\r\n- [ ] **같은 항목**\r\n- [ ] **같은 항목**\r\n\r\n| 표 | 값 |\r\n| --- | --- |\r\n| A | B |";
    const secondItem = content.indexOf("- [ ]", content.indexOf("- [ ]") + 1);
    const marker = taskMarkerOffset(content, secondItem);
    expect(marker).not.toBeNull();
    const changed = setTaskChecked(content, marker!, true);
    expect(changed).toBe(content.slice(0, marker!) + "x" + content.slice(marker! + 1));
    expect(changed).toContain("- [ ] **같은 항목**\r\n- [x] **같은 항목**");
    expect(setTaskChecked(changed, marker!, false)).toBe(content);
  });

  it("uses UTF-16 source offsets correctly after Korean text and emoji", () => {
    const content = "✨ 준비된 초안\n\n  2) [X] 확인할 **항목**\n";
    const item = content.indexOf("2)");
    const marker = taskMarkerOffset(content, item);
    expect(marker).toBe(content.indexOf("X"));
    expect(setTaskChecked(content, marker!, true)).toBe(content);
    expect(setTaskChecked(content, marker!, false)).toBe(content.replace("[X]", "[ ]"));
  });

  it("finds a task marker on a continuation line without searching later list items", () => {
    const content = "> -\r\n>   [ ] 다음 줄 항목\r\n> - 일반 항목\r\n";
    const marker = taskMarkerOffset(content, content.indexOf("-"), content.indexOf("\r\n> - 일반"));
    expect(marker).toBe(content.indexOf("[") + 1);
    expect(setTaskChecked(content, marker!, true)).toBe(content.replace("[ ]", "[x]"));
    expect(taskMarkerOffset("-\n- [ ] 다른 항목", 0, 1)).toBeNull();
  });

  it.each(["- [ ] 항목", "* [x] 항목", "+ [X] 항목", "1. [ ] 항목", "12) [ ] 항목", "\t-\t[ ]\t항목"])("finds the task marker in %s", (content) => {
    const offset = taskMarkerOffset(content, 0);
    expect(offset).toBe(content.indexOf("[") + 1);
  });

  it.each(["일반 [ ] 문장", "- [a] 잘못된 항목", "- \\[ ] 이스케이프", "- [ ]붙어있는문자", "--- [ ] 구분선"])("does not alter unsupported text: %s", (content) => {
    expect(taskMarkerOffset(content, 0)).toBeNull();
  });

  it("leaves invalid, stale or out-of-range positions untouched", () => {
    const content = "- [ ] 항목";
    for (const offset of [-1, 0, 2, 100, NaN, 3.5]) expect(setTaskChecked(content, offset, true)).toBe(content);
    expect(taskMarkerOffset(content, undefined)).toBeNull();
    expect(taskMarkerOffset(content, -1)).toBeNull();
  });
});

describe("safe GFM draft preview", () => {
  const render = (content: string, readOnly = false) => renderToStaticMarkup(createElement(HeadStart, { content, onChange: vi.fn(), readOnly }));

  it("renders tables, formatting and code as semantic elements", () => {
    const output = render("| 방식 | 확인 |\n| --- | --- |\n| A | **제목** |\n\n`<button>`");
    expect(output).toContain('<div class="hs-table-wrap"><table>');
    expect(output).toContain("<th>방식</th>");
    expect(output).toContain("<strong>제목</strong>");
    expect(output).toContain("<code>&lt;button&gt;</code>");
  });

  it("makes actual nested and quoted Markdown tasks interactive but not code-block lookalikes", () => {
    const output = render("- [ ] 첫 항목\n  - [x] 하위 항목\n\n> - [ ] 인용 항목\n\n-\n  [ ] 다음 줄 항목\n\n> -\n>   [ ] 인용 다음 줄 항목\n\n```\n- [ ] 코드는 그대로\n```");
    expect(output.match(/type="checkbox"/g)).toHaveLength(5);
    expect(output).not.toContain("disabled");
    expect(output).toContain('aria-label="첫 항목 완료"');
    expect(output).toContain('aria-label="하위 항목 완료"');
    expect(output).toContain('aria-label="인용 항목 완료"');
    expect(output).toContain("- [ ] 코드는 그대로");
  });

  it("disables task edits and hides the edit button in read-only mode", () => {
    const output = render("- [x] 완료한 항목", true);
    expect(output).toContain("disabled");
    expect(output).toContain("checked");
    expect(output).not.toContain('aria-label="고치기"');
    expect(output).toContain('aria-label="복사"');
  });

  it("drops raw HTML, rejects script URLs and does not request imported images", () => {
    const output = render('<script>alert("실행")</script>\n\n<img src=x onerror=alert(1)>\n\n[실행](javascript:alert%281%29)\n\n![설명](https://example.com/tracker.png)');
    expect(output).not.toContain("<script");
    expect(output).not.toContain("<img");
    expect(output).not.toContain("onerror");
    expect(output).not.toContain("javascript:");
    expect(output).not.toContain("tracker.png");
    expect(output).toContain("설명");
  });

  it("retains safe links with protection for a new browser tab", () => {
    const output = render("[문서](https://example.com/docs)");
    expect(output).toContain('href="https://example.com/docs"');
    expect(output).toContain('target="_blank"');
    expect(output).toContain('rel="noopener noreferrer"');
  });
});
