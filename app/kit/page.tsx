"use client";

import Link from "next/link";
import { useState } from "react";
import { HeadStart } from "../../components/head-start";
import { ProposalCard, SmallProposal } from "../../components/proposal-card";
import { Brand, CardEmpty, CardSkeleton, ThemeTabs, ThreadDrawing, TopicName } from "../../components/ui";
import { IconButton } from "../../components/icons";
import { SettingsLink } from "../../components/settings-link";
import type { LineIconName } from "../../components/icons";
import type { Nudge } from "../../lib/card-types";
import type { WorkspaceTopic } from "../../lib/workspace";

const THEMES = ["대학 수업", "게임 개발", "웹 서비스", "콘텐츠", "진로 준비", "개발 도구", "기록", "새로운 시도"];
const DRAFT = "## 필터 변경 뒤 상세 화면\n\n| 방식 | 확인할 점 |\n| --- | --- |\n| 상세 유지 | 현재 작품을 계속 볼 수 있어요. |\n| 상세 닫기 | 바뀐 목록에서 다시 고를 수 있어요. |\n\n- [ ] 비교표에서 설명을 한 곳 고치기\n- [ ] 발표에서 확인할 동작 하나 고르기";

function fictionalTopic(id: string, name: string, theme: string, status: string): WorkspaceTopic {
  return {
    id, name, theme, one_liner: "부품을 살펴보기 위해 직접 지어낸 프로젝트입니다.",
    category: "personal", progress: "in_progress", last_touched: "recent_2w",
    goal: "작은 예제를 만들고 동작을 한 번 확인합니다.", status_text: status,
    outputs: ["동작을 비교하는 작은 예제"], recent_decisions: ["한 번에 한 가지 동작만 비교합니다."],
    blockers: null, next_steps: ["예제에서 동작을 하나 고릅니다."],
    deadline: null, deadline_label: null, deadline_text: null, collaborators: [], related: [],
    sources: ["other"], merged_from: [], suggested_state: "active", suggested_reason: "진행 중, 다음 할 일 있음",
    state: "active", starred: false, manual_order: null, updated_at: null,
  };
}

const TOPICS = [
  fictionalTopic("kit-topic-1", "전시 안내 팀플", THEMES[0], "작품 목록과 상세 화면이 연결되어 있고 필터 뒤 동작을 비교하려고 합니다."),
  fictionalTopic("kit-topic-2", "책갈피 탐험 게임", THEMES[1], "세 번째 방의 다리와 돌아가는 통로 중 주 경로를 고르려고 합니다."),
  fictionalTopic("kit-topic-3", "키보드 탐색 예제", THEMES[2], "상세를 닫은 뒤 초점이 돌아갈 위치를 확인하는 예제가 있습니다."),
];

const NUDGES: Nudge[] = [
  {
    id: "kit-continue", slot: "focus", topic_id: TOPICS[0].id, new_topic_name: null, type: "continue",
    title: "발표에서 확인할 동작 선택하기",
    action: "준비한 비교표에서 설명을 한 곳 고치고, 발표에서 확인할 동작 하나를 고르면 끝입니다.",
    est_minutes: 10, why_now: "목록과 상세 화면이 연결되어 있어, 필터 뒤 동작을 작은 예제로 비교할 수 있어요.",
    evidence: [{ source: "topic", fact: TOPICS[0].status_text! }],
    head_start: { kind: "checklist", content: DRAFT, options: [] },
    first_step: "비교표의 두 설명 중 지금 만든 화면과 다른 곳을 먼저 골라보세요.",
  },
  {
    id: "kit-unblock", slot: "focus", topic_id: TOPICS[1].id, new_topic_name: null, type: "unblock",
    title: "먼저 걸어볼 경로 선택하기",
    action: "다리와 돌아가는 통로 중 회색 블록으로 먼저 확인할 경로 하나를 고르면 끝입니다.",
    est_minutes: 5, why_now: "세 번째 방의 주 경로를 고르면 한 가지 동작부터 확인할 수 있어요.",
    evidence: [{ source: "topic", fact: TOPICS[1].status_text! }],
    head_start: { kind: "question", content: "세 번째 방에서 먼저 걸어볼 경로는 어느 쪽인가요?", options: [
      { id: "bridge", label: "다리", value: "다리 경로를 회색 블록으로 먼저 확인합니다." },
      { id: "detour", label: "돌아가는 통로", value: "돌아가는 통로를 회색 블록으로 먼저 확인합니다." },
    ] },
    first_step: "스케치를 보며 먼저 움직여 볼 쪽을 골라보세요.",
  },
  {
    id: "kit-expand", slot: "explore", topic_id: TOPICS[2].id, new_topic_name: null, type: "expand",
    title: "화면을 보지 않고 초점 흐름 기록하기",
    action: "예제의 이동 순서를 소리 내어 읽고, 화면을 보지 않고도 설명되는지 한 번 확인하면 끝입니다.",
    est_minutes: 10, why_now: "이미 있는 초점 복귀 예제를 말로 설명해 보면, 눈으로 볼 때 놓친 전환을 찾아볼 수 있어요.",
    evidence: [{ source: "topic", fact: TOPICS[2].status_text! }],
    head_start: { kind: "outline", content: "## 초점 흐름을 읽는 순서\n1. 목록에서 작품 하나를 고릅니다.\n2. 상세 화면을 엽니다.\n3. 닫기 버튼으로 목록에 돌아옵니다.\n4. 돌아온 위치를 한 문장으로 설명합니다.\n\n확인할 질문: 다음에 누를 수 있는 것이 무엇인지 이 설명만으로 알 수 있나요?", options: [] },
    first_step: "현재 예제의 닫기 버튼까지 이동하는 순서를 먼저 읽어보세요.",
  },
  {
    id: "kit-new-project", slot: "explore", topic_id: "new", new_topic_name: "선택 이유 한 장 노트", type: "new_project",
    title: "한 번의 선택을 짧은 노트로 기록하기",
    action: "준비한 목차에서 지금 기록할 선택 하나를 고르고, 그 선택을 설명할 한 문장을 고치면 끝입니다.",
    est_minutes: 10, why_now: "작은 예제에서 고른 동작을 짧게 기록하면 다음 비교를 시작할 때 다시 살펴볼 수 있어요.",
    evidence: [{ source: "topic", fact: "한 번에 한 가지 동작만 비교합니다." }],
    head_start: { kind: "draft", content: "# 선택 이유 한 장 노트\n\n## 이번에 고른 것\n작은 예제에서 확인할 동작을 하나 고릅니다.\n\n## 비교할 것\n현재 동작과 다른 동작 하나를 나란히 살펴봅니다.\n\n## 남길 기록\n어떤 차이를 직접 확인했는지 한 문장으로 적습니다.", options: [] },
    first_step: "전시 안내와 탐험 게임 중 이번에 남길 선택 하나를 골라보세요.",
  },
];

const CONFIRM_GROUPS = [
  { state: "active", title: "지금 할 일" }, { state: "later", title: "나중에" }, { state: "remove", title: "정리해도 될 것" },
] as const;
type ConfirmationState = typeof CONFIRM_GROUPS[number]["state"];

export default function KitPage() {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(NUDGES.map((nudge) => [nudge.id, nudge.head_start.content])));
  const [standaloneDraft, setStandaloneDraft] = useState(DRAFT);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState(NUDGES[0].id);
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [straight, setStraight] = useState(false);
  const [notice, setNotice] = useState("부품을 눌러 동작을 살펴보세요.");
  const [groups, setGroups] = useState<Record<string, ConfirmationState>>({ "kit-topic-1": "active", "kit-topic-2": "later", "kit-topic-3": "remove" });
  const [stars, setStars] = useState<Record<string, boolean>>({ "kit-topic-1": true });

  return <main className="kit-shell">
    <header className="kit-header"><Brand /><nav className="app-nav" aria-label="주 메뉴"><Link href="/">오늘</Link><Link href="/topics">현재 토픽</Link></nav><SettingsLink /></header>
    <section className="kit-section">
      <p className="eyebrow">실타래 · 디자인 v0.2</p><h1>한 걸음을 만드는 부품들</h1>
      <p>직접 지어낸 가상 예시입니다. 여기서 고친 내용은 이 페이지 안에서만 바뀌어요.</p>
      <p className="inline-message" role="status">{notice}</p>
    </section>

    <section className="kit-section" aria-labelledby="kit-flow-title">
      <h2 id="kit-flow-title">오늘에서 토픽 보드까지</h2>
      <div className="kit-flow-grid">
        <article className="kit-flow-card"><h3>오늘</h3><p>가장 먼저 이어갈 카드 한 장과 다른 제안을 한 열로 살펴봐요.</p><Link href="/">오늘 보기</Link></article>
        <article className="kit-flow-card"><h3>현재 토픽</h3><p>테마별로 모은 프로젝트 상자에서 할 일을 고르고 나중에 볼 일도 꺼내요.</p><Link href="/topics">현재 토픽 보기</Link></article>
        <article className="kit-flow-card"><h3>토픽 보드</h3><p>한 프로젝트의 목표·기록·제안을 같은 공간에서 이어가요.</p><span className="muted">토픽 이름을 누르면 열려요.</span></article>
      </div>
      <p className="muted">토픽 목록의 개수는 제한하지 않아요. 제안을 요청할 때 보낼 토픽만 최대 9개를 고릅니다.</p>
    </section>

    <section className="kit-section" aria-labelledby="kit-buttons-title">
      <h2 id="kit-buttons-title">버튼과 꼬리표</h2>
      <div className="kit-row">
        <button className="button button-primary" type="button" onClick={() => setNotice("주요 버튼을 눌렀어요.")}>주요 버튼</button>
        <button className="button button-start" type="button" onClick={() => setNotice("시작 버튼을 눌렀어요.")}>시작</button>
        <button className="button button-secondary" type="button" onClick={() => setNotice("보조 버튼을 눌렀어요.")}>보조 버튼</button>
        <button className="button button-quiet" type="button" onClick={() => setNotice("글자 버튼을 눌렀어요.")}>글자 버튼</button>
        <button className="button" type="button" disabled>누를 수 없는 버튼</button>
      </div>
      <div className="kit-row"><span className="chip">진행 중</span><span className="chip">나중에</span></div>
      <div className="kit-row">{([['clock', '나중에'], ['close', '관심 없어요'], ['external', '다른 AI에서 이어가기'], ['edit', '고치기'], ['copy', '복사'], ['preview', '미리보기'], ['star', '별 표시'], ['more', '토픽 메뉴']] satisfies Array<[LineIconName, string]>).map(([icon, label]) => <IconButton key={icon} icon={icon} label={label} onClick={() => setNotice(`${label} 아이콘을 눌렀어요.`)} />)}</div>
    </section>

    <section className="kit-section" aria-labelledby="kit-threads-title">
      <h2 id="kit-threads-title">테마를 구분하는 여덟 가지 실</h2>
      <div className="kit-row">{THEMES.map((theme, index) => <TopicName key={theme} name={theme} themeIndex={index} />)}</div>
      <ThemeTabs themes={THEMES} selected={selectedTheme} onSelect={(theme) => { setSelectedTheme(theme); setNotice(`${theme ?? "전체"} 테마를 골랐어요.`); }} />
      <p className="muted">선택한 테마: {selectedTheme ?? "전체"}</p>
      <div className="kit-row"><ThreadDrawing variant="logo" /><ThreadDrawing variant="card" straight={straight} /><button type="button" className="button button-quiet" onClick={() => setStraight((current) => !current)}>{straight ? "엉킨 선 보기" : "완료한 선 보기"}</button></div>
    </section>

    <section className="kit-section" aria-labelledby="kit-topics-title">
      <h2 id="kit-topics-title">테마별 토픽 상자</h2>
      <div className="topics-groups">{TOPICS.map((topic, index) => <section className="theme-box" key={topic.id}><h3 className="theme-box-header">{topic.theme}</h3><ul className="topics-grid theme-topic-list"><li className="topic-tile">
        <button type="button" className="topic-tile-link" onClick={() => setNotice(`‘${topic.name}’의 가상 보드를 고른 동작이에요.`)}>
          <TopicName name={topic.name} themeIndex={index} />
          <span className="topic-tile-description">{topic.one_liner}</span>
          <span className="topic-tile-meta"><span>{index === 0 ? "3일 남음" : index === 1 ? "일정 없음" : "지난 일정"}</span><span>가상 예시</span></span>
        </button>
        <div className="topic-tile-actions"><IconButton icon="star" label={`${topic.name} ${stars[topic.id] ? "별 해제" : "별 표시"}`} aria-pressed={Boolean(stars[topic.id])} onClick={() => { setStars((current) => ({ ...current, [topic.id]: !current[topic.id] })); setNotice(`‘${topic.name}’의 가상 별 표시를 바꿨어요.`); }} /><IconButton icon="more" label={`${topic.name} 메뉴`} onClick={() => setNotice("토픽 메뉴에서 테마 이동·나중에·삭제를 고를 수 있어요.")} /></div>
      </li></ul></section>)}</div>
    </section>

    <section className="kit-section" aria-labelledby="kit-small-title">
      <h2 id="kit-small-title">작은 제안 카드</h2>
      <div className="kit-grid">{NUDGES.map((nudge) => <SmallProposal key={nudge.id} nudge={nudge} topic={TOPICS.find((topic) => topic.id === nudge.topic_id)} themeIndex={THEMES.indexOf(TOPICS.find((topic) => topic.id === nudge.topic_id)?.theme ?? "")} accepted={accepted[nudge.id]} selected={selected === nudge.id} onClick={() => { setSelected(nudge.id); setNotice(`‘${nudge.title}’ 카드를 골랐어요.`); }} />)}</div>
    </section>

    <section className="kit-section" aria-labelledby="kit-cards-title">
      <h2 id="kit-cards-title">네 가지 제안</h2>
      <div className="kit-grid">{NUDGES.map((nudge) => <ProposalCard key={nudge.id} nudge={nudge} content={drafts[nudge.id]} topic={TOPICS.find((topic) => topic.id === nudge.topic_id)} themeIndex={THEMES.indexOf(TOPICS.find((topic) => topic.id === nudge.topic_id)?.theme ?? "")} accepted={accepted[nudge.id]}
        onContentChange={(content) => setDrafts((current) => ({ ...current, [nudge.id]: content }))}
        onAccept={() => { setAccepted((current) => ({ ...current, [nudge.id]: true })); setNotice(`‘${nudge.title}’을 진행 중으로 표시했어요.`); }}
        onComplete={(note) => { setAccepted((current) => ({ ...current, [nudge.id]: false })); setNotice(note ? `완료 메모를 확인했어요: ${note}` : "완료한 카드의 예시를 확인했어요."); }}
        onSnooze={() => setNotice(`‘${nudge.title}’을 나중에 두는 동작입니다.`)}
        onDismiss={() => setNotice(`‘${nudge.title}’의 관심 없어요 동작입니다.`)}
        onAnswer={(id) => setNotice(`고른 답: ${nudge.head_start.options.find((option) => option.id === id)?.value ?? "선택한 답"}`)}
        onContinue={() => setNotice("진행 중인 카드를 이어가는 동작입니다.")}
      />)}</div>
    </section>

    <section className="kit-section" aria-labelledby="kit-draft-title">
      <h2 id="kit-draft-title">표와 체크리스트가 있는 초안</h2>
      <p>체크를 바꾸거나 ‘고치기’를 눌러 원문을 고쳐 보세요.</p>
      <div className="proposal-draft kit-wide"><div className="draft-label"><span className="section-kicker">초안</span></div><HeadStart content={standaloneDraft} onChange={setStandaloneDraft} /></div>
    </section>

    <section className="kit-section" aria-labelledby="kit-confirm-title">
      <h2 id="kit-confirm-title">프로젝트 3개를 찾았어요</h2>
      <p>먼저 세 묶음으로 나눠 봤어요. 틀린 것만 옮기면 돼요.</p>
      <ThreadDrawing variant="onboarding" themes={3} />
      <div className="ob-confirm-groups">{CONFIRM_GROUPS.map((group) => {
        const topics = TOPICS.filter((topic) => groups[topic.id] === group.state);
        return <section className={`ob-group ob-group-${group.state}`} key={group.state}>
          <div className="ob-group-header"><h3>{group.title} <span>{topics.length}</span></h3></div>
          {topics.length === 0 ? <p className="ob-hint">이 묶음에는 토픽이 없어요.</p> : <ul className="ob-topic-list">{topics.map((topic) => <li className="ob-topic" key={topic.id}>
            <h4>{topic.name}</h4><div className="ob-topic-meta"><span className="chip">{topic.theme}</span><span>가상 예시</span></div>
            <p className="muted">다른 묶음으로 옮겨 보세요.</p>
            <div className="ob-topic-actions">{CONFIRM_GROUPS.filter((target) => target.state !== group.state).map((target) => <button type="button" className="button button-quiet" key={target.state} onClick={() => setGroups((current) => ({ ...current, [topic.id]: target.state }))}>{target.state === "active" ? "활성으로" : target.state === "later" ? "나중에" : "삭제"}</button>)}</div>
          </li>)}</ul>}
        </section>;
      })}</div>
      <div className="kit-row"><button type="button" className="button button-primary" onClick={() => setNotice("확인 묶음의 가상 예시를 살펴봤어요. 실제 목록은 바뀌지 않아요.")}>이대로 시작</button><p className="muted">내용은 이 브라우저에만 저장돼요.</p></div>
    </section>

    <section className="kit-section" aria-labelledby="kit-states-title">
      <h2 id="kit-states-title">빈 화면 · 오류 · 준비 중</h2>
      <div className="kit-grid">
        <CardEmpty onGenerate={() => setNotice("새 제안을 받는 버튼의 예시입니다.")} />
        <CardEmpty failed message="잠시 뒤 다시 눌러 주세요." onGenerate={() => setNotice("제안 생성을 다시 시도하는 버튼의 예시입니다.")} />
        <CardSkeleton />
      </div>
    </section>
  </main>;
}
