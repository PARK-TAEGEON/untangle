// parse_export.js — Untangle 내보내기 결과 파서 + 사전 분류 (참고 구현, 의존성 없음)
//
// 사용: node parse_export.js <내보내기 결과.txt> [source=chatgpt] [today=YYYY-MM-DD]
// 출력: topic_schema.json 형식의 JSON + quality(파싱 품질)
//
// quality.ok가 false면 형식이 깨진 것이므로 대체 경로(병합 프롬프트 API 호출)로 넘긴다.
'use strict';

const CATEGORY = { '학교': 'school', '개인 프로젝트': 'personal', '일': 'work', '지원·커리어': 'career', '기타': 'other' };
const CATEGORY_LABEL = { school: '학교', personal: '개인 프로젝트', work: '일', career: '지원·진로', other: '기타' };
const PROGRESS = { '진행 중': 'in_progress', '멈춤': 'stalled', '끝남': 'done', '아이디어만': 'idea_only', '모름': 'unknown' };
const TOUCHED = { '최근 2주': 'recent_2w', '최근 한 달': 'recent_1m', '그 이전': 'older', '모름': 'unknown' };
const FIELD = {
  '한 줄 설명': 'one_liner',
  '종류': 'category',
  '진행 여부': 'progress',
  '마지막으로 다룬 시기': 'last_touched',
  '목표': 'goal',
  '현재 상태': 'status_text',
  '마지막 상태': 'status_text',
  '지금까지 만든 것': 'outputs',
  '최근에 내린 결정': 'recent_decisions',
  '막힌 점이나 미정인 것': 'blockers',
  '마감·일정': 'deadline_raw',
  '마감': 'deadline_raw',
  '내가 말했던 다음 할 일': 'next_steps',
  '해보려던 것': 'next_steps',
  '함께하는 사람': 'collaborators',
  '관련 대화 주제': 'related',
};
const ME_FIELD = {
  '하는 일/역할': 'roles',
  '관심사': 'interests',
  '요즘 가장 시간을 쓰는 일': 'current_focus',
  '자주 쓰는 도구': 'tools',
  '내가 선호한다고 말한 작업 방식': 'work_style',
};
const LIST_FIELDS = new Set(['outputs', 'recent_decisions', 'next_steps']);
const ACTIVE_CAP = 9;
const TOUCH_RANK = { recent_2w: 0, recent_1m: 1, older: 2, unknown: 3 };

const clean = (s) => s.replace(/&#x20;/g, ' ').replace(/\\(.)/g, '$1').trim();
const stripDot = (s) => s.replace(/[.。]\s*$/, '').trim();
const isUnknown = (s) => !s || /^모름\.?$/.test(s.trim());
const endsUnknown = (s) => /모름\.?$/.test(s.trim());
const splitList = (s) => stripDot(s).split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);

function parseDeadline(raw, today) {
  if (isUnknown(raw)) return { deadline: null, label: null, text: null };
  const found = [];
  const push = (y, m, d, index, length) => {
    // 달력에 없는 날짜(2월 31일 등)는 날짜로 읽지 않는다
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(m) - 1 || dt.getUTCDate() !== Number(d)) return;
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    found.push({ iso, index, end: index + length });
  };
  for (const m of raw.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})/g)) push(m[1], m[2], m[3], m.index, m[0].length);
  for (const m of raw.matchAll(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g)) push(m[1], m[2], m[3], m.index, m[0].length);
  // 지난 날짜는 마감으로 쓰지 않는다. 원문만 deadline_text에 남긴다.
  const future = found.filter((d) => d.iso >= today).sort((a, b) => (a.iso < b.iso ? -1 : 1));
  if (!future.length) return { deadline: null, label: null, text: raw };
  const d = future[0];
  const lm = raw.slice(d.end).match(/^\s*[(（]([^)）]+)[)）]/);
  // 날짜(와 괄호 설명)를 뺀 나머지 글
  const rest = (raw.slice(0, d.index) + ' ' + raw.slice(d.end + (lm ? lm[0].length : 0)))
    .replace(/^[\s.,·:\-–]+|[\s.,·]+$/g, '').trim();
  if (lm) return { deadline: d.iso, label: lm[1].trim(), text: rest ? raw : null };
  // 괄호 설명이 없으면: 나머지가 짧으면 그것을 설명으로, 길면 원문을 deadline_text에 남긴다
  if (rest && rest.length <= 20) return { deadline: d.iso, label: rest, text: null };
  return { deadline: d.iso, label: null, text: rest ? raw : null };
}

function parseExport(text, { source = 'other', today } = {}) {
  today = today || new Date().toISOString().slice(0, 10);
  const me = {};
  const themeOrder = [];
  const projects = [];
  let section = null;
  let theme = null;
  let cur = null;
  let last = null; // 마지막으로 읽은 칸 {value, items}

  for (const rawLine of text.split(/\r?\n/)) {
    const indent = rawLine.match(/^\s*/)[0].length;
    const line = clean(rawLine);
    if (!line) continue;
    let m;
    if (/^##\s+나\s*$/.test(line)) { section = 'me'; cur = null; last = null; continue; }
    if ((m = line.match(/^##\s+테마\s*[:：]\s*(.+)$/))) {
      theme = m[1].trim(); section = 'theme'; cur = null; last = null;
      if (!themeOrder.includes(theme)) themeOrder.push(theme);
      continue;
    }
    if (/^##\s+/.test(line)) { section = 'projects'; theme = null; cur = null; last = null; continue; }
    if ((m = line.match(/^###\s+(.+)$/))) {
      const name = m[1].replace(/\s*←.*$/, '').trim();
      cur = { name, theme, raw: {} };
      projects.push(cur); section = 'project'; last = null;
      continue;
    }
    if (indent === 0 && (m = line.match(/^-\s+([^:：]{1,30})[:：]\s*(.*)$/))) {
      last = { value: m[2].trim(), items: [] };
      const key = m[1].trim();
      if (section === 'me') me[key] = last; else if (cur) cur.raw[key] = last;
      continue;
    }
    if (last && indent > 0 && (m = line.match(/^(?:\d+[.)]|[-*])\s+(.+)$/))) { last.items.push(m[1].trim()); continue; }
    if (last && indent > 0) { // 줄바꿈된 이어쓰기
      if (last.items.length) last.items[last.items.length - 1] += ' ' + line; else last.value += ' ' + line;
    }
  }

  // 프로필
  const meVal = (k) => { const f = Object.entries(me).find(([key]) => ME_FIELD[key] === k); return f ? f[1] : null; };
  const meList = (k, max) => { const f = meVal(k); if (!f) return []; const s = f.items.length ? f.items : (isUnknown(f.value) ? [] : splitList(f.value)); return s.slice(0, max); };
  const focusField = meVal('current_focus');
  const focus = !focusField ? [] : focusField.items.length ? focusField.items.slice(0, 3)
    : isUnknown(focusField.value) ? [] : /\.\s+\S/.test(focusField.value) ? [focusField.value] : splitList(focusField.value).slice(0, 3);
  const ws = meVal('work_style');
  const roles = meList('roles', 8);
  const profile = {
    summary: roles.slice(0, 3).join(', '),
    roles,
    interests: meList('interests', 8),
    current_focus: focus,
    tools: meList('tools', 8),
    work_style: ws && !isUnknown(ws.value) ? ws.value : null,
  };

  // 토픽
  let recognized = 0;
  const topics = projects.map((p) => {
    const f = {};
    for (const [key, field] of Object.entries(p.raw)) { if (FIELD[key] && !(FIELD[key] in f)) f[FIELD[key]] = field; }
    const text = (k) => { const x = f[k]; if (!x) return null; const s = [x.value, ...x.items].filter(Boolean).join(' ').trim(); return isUnknown(s) ? null : s; };
    const list = (k) => { const x = f[k]; if (!x) return []; const s = x.items.length ? x.items : (x.value ? [x.value] : []); return s.filter((i) => !isUnknown(i) && !endsUnknown(i)).slice(0, 3); };
    const progressRaw = f.progress ? stripDot(f.progress.value) : '';
    if (f.one_liner && PROGRESS[progressRaw]) recognized++;
    const category = CATEGORY[f.category ? stripDot(f.category.value) : ''] || 'other';
    const dl = parseDeadline(text('deadline_raw') || '', today);
    const collab = text('collaborators');
    const t = {
      id: '',
      name: p.name,
      one_liner: text('one_liner') || '',
      theme: p.theme || CATEGORY_LABEL[category],
      category,
      progress: PROGRESS[progressRaw] || 'unknown',
      last_touched: TOUCHED[f.last_touched ? stripDot(f.last_touched.value) : ''] || 'unknown',
      goal: text('goal'),
      status_text: text('status_text'),
      outputs: list('outputs'),
      recent_decisions: list('recent_decisions'),
      blockers: text('blockers'),
      next_steps: list('next_steps'),
      deadline: dl.deadline,
      deadline_label: dl.label,
      deadline_text: dl.text,
      collaborators: !collab || /^혼자\.?$/.test(collab) ? [] : splitList(collab),
      related: text('related') ? splitList(text('related')).slice(0, 5) : [],
      sources: [source],
      merged_from: [],
      suggested_state: 'later',
      suggested_reason: '',
    };
    return t;
  });

  classify(topics);

  // 테마 순서: 활성 토픽이 많은 테마 먼저 (같으면 원문 순서)
  const names = [...new Set([...themeOrder, ...topics.map((t) => t.theme)])];
  const activeCount = (n) => topics.filter((t) => t.theme === n && t.suggested_state === 'active').length;
  const themes = names.map((n, i) => ({ n, i })).sort((a, b) => activeCount(b.n) - activeCount(a.n) || a.i - b.i).map((x) => x.n);

  // 토픽 순서: 테마 → 상태 → 마감 → 원문 순서
  const stateRank = { active: 0, later: 1, remove: 2 };
  topics.forEach((t, i) => { t._i = i; });
  topics.sort((a, b) => themes.indexOf(a.theme) - themes.indexOf(b.theme)
    || stateRank[a.suggested_state] - stateRank[b.suggested_state]
    || (a.deadline || '9999').localeCompare(b.deadline || '9999')
    || a._i - b._i);
  topics.forEach((t, i) => { t.id = `t${i + 1}`; delete t._i; });

  const ratio = projects.length ? recognized / projects.length : 0;
  const quality = { ok: projects.length > 0 && ratio >= 0.8, projects: projects.length, recognized, ratio: Number(ratio.toFixed(2)) };
  return { profile, themes, topics, quality };
}

// 사전 분류 규칙. 병합 프롬프트(대체 경로)의 규칙과 같아야 한다.
function classify(topics) {
  const md = (iso) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;
  for (const t of topics) {
    if (t.progress === 'done') { t.suggested_state = 'remove'; t.suggested_reason = '끝난 일'; continue; }
    if (t.progress === 'in_progress' && (t.deadline || t.next_steps.length)) {
      t.suggested_state = 'active';
      t.suggested_reason = t.deadline ? `${md(t.deadline)} ${t.deadline_label || '마감'}` : '진행 중, 다음 할 일 있음';
      continue;
    }
    t.suggested_state = 'later';
    t.suggested_reason = { stalled: '멈춘 상태', idea_only: '아이디어 단계', unknown: '진행 여부를 알 수 없음', in_progress: '다음 할 일이 정해지지 않음' }[t.progress];
  }
  // 활성이 상한을 넘으면: 마감 있는 것(가까운 순) → 최근에 다룬 순 → 원문 순서로 남긴다
  const active = topics.map((t, i) => ({ t, i })).filter((x) => x.t.suggested_state === 'active');
  if (active.length > ACTIVE_CAP) {
    active.sort((a, b) => (a.t.deadline ? 0 : 1) - (b.t.deadline ? 0 : 1)
      || (a.t.deadline || '').localeCompare(b.t.deadline || '')
      || TOUCH_RANK[a.t.last_touched] - TOUCH_RANK[b.t.last_touched]
      || a.i - b.i);
    for (const x of active.slice(ACTIVE_CAP)) {
      x.t.suggested_state = 'later';
      x.t.suggested_reason = `활성 ${ACTIVE_CAP}개를 넘어 나중으로 조정`;
    }
  }
}

module.exports = { parseExport, classify, parseDeadline };

if (require.main === module) {
  const [file, source = 'chatgpt', today] = process.argv.slice(2);
  if (!file) { console.error('사용: node parse_export.js <파일> [source] [today]'); process.exit(1); }
  const text = require('fs').readFileSync(file, 'utf8');
  console.log(JSON.stringify(parseExport(text, { source, today }), null, 2));
}
