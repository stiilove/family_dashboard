/* ============================================================
   우리 가족 기록장 — app.js
   Pure static app: localStorage 기본 저장소 + Firebase 어댑터
   ============================================================ */

'use strict';

/* ==================== Store layer ====================
   인터페이스: load() -> Promise<data|null>
              save(data) -> Promise
              subscribe(cb) -> 원격 변경 시 cb(data)
   LocalStore : localStorage (기본)
   FirebaseStore : Firebase Realtime DB REST + SSE (설정 시)
======================================================== */

class LocalStore {
  constructor(key) { this.key = key; }
  async load() {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { console.error('load fail', e); return null; }
  }
  async save(data) {
    try { localStorage.setItem(this.key, JSON.stringify(data)); }
    catch (e) { console.error('save fail', e); }
  }
  subscribe() { /* 로컬은 자기 탭만 */ }
}

class FirebaseStore {
  constructor(cfg) {
    this.base = (cfg.databaseURL || '').replace(/\/+$/, '');
    this.cfg = cfg;
    this.es = null;
  }
  get url() { return this.base + '/dashboard.json'; }
  authQ() { return this.cfg.auth ? `?auth=${encodeURIComponent(this.cfg.auth)}` : ''; }
  async load() {
    const res = await fetch(this.url + this.authQ());
    if (!res.ok) throw new Error('firebase load ' + res.status);
    const text = await res.text();
    return text === 'null' ? null : JSON.parse(text);
  }
  async save(data) {
    const res = await fetch(this.url + this.authQ(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('firebase save ' + res.status);
    return true;
  }
  subscribe(cb) {
    if (this.es) this.es.close();
    this.es = new EventSource(this.url + this.authQ());
    /* Firebase REST 스트리밍은 event: put / event: patch 처럼
       '이름 붙은' 이벤트로 보내요. onmessage는 이름 없는 이벤트만 받기 때문에
       put/patch를 직접 구독해야 다른 폰의 변경이 바로 들어와요.
       data 모양: {"path":"/cookies/eunji","data":...} */
    const handle = (kind) => (e) => {
      if (!e.data) return;
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg && typeof msg === 'object' && Object.prototype.hasOwnProperty.call(msg, 'path')) {
        if (msg.data === null || msg.data === undefined) return; // 삭제 이벤트는 쓰지 않아요
        cb(msg.data, msg.path, kind);
      } else if (msg) {
        cb(msg, '/', kind);
      }
    };
    this.es.addEventListener('put', handle('put'));
    this.es.addEventListener('patch', handle('patch'));
    this.es.onmessage = handle('put'); // 이름 없는 이벤트 대비
    this.es.onerror = () => { /* EventSource는 자동 재접속 */ };
  }
}

const STORAGE_KEY = 'family-dashboard-v1';

/* 우리 가족 Firebase Realtime Database (asia-southeast1)
   여기 주소만 있으면 가족 폰들이 각자 자동으로 같은 기록장에 붙어요. */
const DEFAULT_FIREBASE_CONFIG = '{"databaseURL":"https://family-dashboard-34895-default-rtdb.asia-southeast1.firebasedatabase.app"}';

let store = new LocalStore(STORAGE_KEY);

/* ==================== 가족 정보 ==================== */

const MEMBERS = [
  { id: 'eunji',  name: '은지',  role: '엄마', avatar: 'assets/avatar-eunji.png'  },
  { id: 'jinu',   name: '진우',  role: '아빠', avatar: 'assets/avatar-jinu.png'   },
  { id: 'sia',    name: '시아',  role: '',     avatar: 'assets/avatar-sia.png'    },
  { id: 'sieun',  name: '시은',  role: '',     avatar: 'assets/avatar-sieun.png'  },
];
const memberById = (id) => MEMBERS.find(m => m.id === id) || MEMBERS[0];

// 가족 카드에 한 줄로 보여줄 포근한 문구
const MEMBER_MOTTOS = {
  eunji: '오늘도 반짝반짝',
  jinu: '우리집 든든이',
  sia: '씩씩한 하루',
  sieun: '몽글몽글 하루',
};

const MISSIONS = [
  { emoji: '🥕', text: '저녁 준비 같이 돕기' },
  { emoji: '🧹', text: '방구석 청소 한 번씩' },
  { emoji: '📚', text: '책 10분 같이 읽기' },
  { emoji: '🦷', text: '양치 후 씨씨 이 닦기' },
  { emoji: '🌱', text: '베란다 물주기 돕기' },
  { emoji: '🧺', text: '빨래 개기 같이 하기' },
  { emoji: '🃏', text: '보드게임 한 판 하기' },
  { emoji: '💌', text: '가족에게 고마운 말 전하기' },
  { emoji: '🍎', text: '과일 씻어 같이 먹기' },
  { emoji: '🛏️', text: '침대 정리 깔끔하게' },
];

const STICKERS = ['❤️', '🐰', '🐹', '🐻', '🌟', '🎉', '👍', '😂', '🥳', '🍰', 'cookie🍪', '🍪', '🌷', '🐣', '💪', '🥰', 'good👍', '🍀', '🎈', '💌', '😴', '🤗', '🎵', '🌈'];

const DEFAULT_STATE = {
  cookies: { eunji: 0, jinu: 0, sia: 0, sieun: 0 },
  money: { eunji: 0, jinu: 0, sia: 0, sieun: 0 },
  cookieLog: [],     // {date, memberId, text, amount, ts, ref?}
  cookieAwards: {},  // "YYYY-MM-DD|ref" -> {memberId, amount}  하루 한 번만 적립되게 하는 장부
  exchanges: [],     // {date, memberId, cookies, won, ts}
  routines: {        // memberId -> [{id, text}]
    eunji: [], jinu: [],
    sia: [{ id: 'sia1', text: '책 30분 읽기' }, { id: 'sia2', text: '공부하기' }, { id: 'sia3', text: '이 닦기' }],
    sieun: [{ id: 'sieun1', text: '낮잠 자기' }, { id: 'sieun2', text: '노래 부르기' }],
  },
  routineDone: {},   // memberId -> date -> {routineId: true}
  events: [],        // {id, date:'YYYY-MM-DD', title}
  todos: {           // memberId -> [{id, text}]
    eunji: [], jinu: [],
    sia: [{ id: 'siaT1', text: '책 30분 읽기' }, { id: 'siaT2', text: '내일 준비물 챙기기' }, { id: 'siaT3', text: '공부하기' }],
    sieun: [{ id: 'sieunT1', text: '장난감 정리' }, { id: 'sieunT2', text: '양치하기' }],
  },
  todoDone: {},      // memberId -> date -> {todoId: true}
  studyFixed: [      // 가정 고정 항목 (모든 멤버 공통)
    { id: 'f1', text: '받아쓰기 연습', cookies: 1 },
    { id: 'f2', text: '독서 20분', cookies: 1 },
    { id: 'f3', text: '수학 문제', cookies: 1 },
  ],
  studyCustom: {},   // memberId -> [{id, text, cookies}]
  studyDone: {},     // memberId -> date -> {itemKey: true}  (itemKey = 'f:'+id or 'c:'+id)
  mission: { date: '', text: '', emoji: '', count: 0, doneDate: '' },
  chat: { messages: [] }, // {id, memberId, text, sticker, ts, reactions:{memberId:true}}
  settings: {
    cookieGoal: 50, exchangeWon: 5000, todoCookie: 1, studyCookie: 1,
    firebase: { config: DEFAULT_FIREBASE_CONFIG, enabled: true },
  },
};

/* ==================== 상태 ==================== */

let state = null;
let saveTimer = null;
let remoteSync = false; // firebase 연결 여부

function deepMerge(base, extra) {
  if (extra === null || extra === undefined) return base;
  if (typeof base !== 'object' || typeof extra !== 'object' || Array.isArray(base) || Array.isArray(extra)) {
    return extra;
  }
  for (const k of Object.keys(extra)) base[k] = deepMerge(base[k], extra[k]);
  return base;
}

async function initStore() {
  const saved = await store.load();
  state = normalizeState(deepMerge(JSON.parse(JSON.stringify(DEFAULT_STATE)), saved || {}));
  applyFirebaseDefaults(saved);
}

/* 예전에 저장된 기록(firebase.config가 비어 있던 시절)도,
   새 폰처럼 저장된 게 아무것도 없는 경우도 모두 기본 Firebase로 자동 연결되게 해요.
   (localStorage에 enabled:false / config:'' 가 남아 있어도 덮어써요) */
function applyFirebaseDefaults(saved) {
  const savedFb = (saved && saved.settings && saved.settings.firebase) || null;
  const savedConfig = savedFb && typeof savedFb.config === 'string' ? savedFb.config.trim() : '';
  if (savedConfig) return; // 누군가 직접 넣은 설정은 그대로 존중
  state.settings.firebase = { config: DEFAULT_FIREBASE_CONFIG, enabled: true };
}

/* Firebase는 빈 배열을 지우고, 배열을 숫자 키 객체로 돌려줄 때가 있어요.
   화면 그리는 코드가 .sort()/.map()을 쓰니 배열 모양을 미리 맞춰둬요. */
const ARRAY_FIELDS = ['events', 'cookieLog', 'exchanges', 'studyFixed'];
function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.values(v).filter(x => x !== null && x !== undefined);
  return [];
}
function normalizeState(s) {
  for (const key of ARRAY_FIELDS) {
    if (s[key] === undefined || s[key] === null) s[key] = [];
    else s[key] = asArray(s[key]);
  }
  if (!s.chat || typeof s.chat !== 'object') s.chat = { messages: [] };
  s.chat.messages = asArray(s.chat.messages);
  for (const nk of ['routines', 'todos', 'studyCustom']) {
    const m = s[nk];
    if (!m || typeof m !== 'object') continue;
    for (const mid of Object.keys(m)) m[mid] = asArray(m[mid]);
  }
  return s;
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    Promise.resolve(store.save(state)).catch(e => {
      console.error('save fail', e);
      updateSyncStatus('저장 실패: ' + e.message);
    });
  }, 250);
}

function connectFirebase() {
  const fb = state.settings.firebase || {};
  const cfgText = (fb.config || '').trim();
  const cfgEnabled = !!fb.enabled;
  remoteSync = false;
  if (!cfgEnabled || !cfgText) {
    store = new LocalStore(STORAGE_KEY); // 동기화 끔 → 이 기기 저장소로
    updateSyncStatus();
    return;
  }
  try {
    const cfg = JSON.parse(cfgText);
    if (!cfg.databaseURL) throw new Error('databaseURL 없음');
    store = new FirebaseStore(cfg);
    remoteSync = true;
    // 원격 데이터로 병합 후 업로드 (처음 연결되는 폰이면 이 기기 기록이 그대로 올라가요)
    store.load().then(remote => {
      state = normalizeState(deepMerge(state, remote || {}));
      // 원격에 옛날 빈 설정이 남아 있어도 지금 연결 설정을 유지해요
      state.settings.firebase = { ...(state.settings.firebase || {}), config: cfgText, enabled: cfgEnabled };
      return store.save(state);
    }).then(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
      renderAll();
      updateSyncStatus('연결됨 ✅ 실시간 동기화 중');
      startSubscribe(); // 첫 업로드가 끝난 뒤에 구독을 열어요 (이 기기 기록이 지워지지 않게)
    }).catch(e => {
      console.error(e);
      remoteSync = false;
      store = new LocalStore(STORAGE_KEY);
      updateSyncStatus('연결 실패: ' + e.message);
    });
    function startSubscribe() {
      store.subscribe((data, path, kind) => {
        if (!data) return;
        applyRemote(data, path, kind);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
        renderAll();
      });
    }
  } catch (e) {
    remoteSync = false;
    updateSyncStatus('설정 오류: ' + e.message);
  }
  updateSyncStatus('연결하는 중…');
}

/* 다른 폰에서 저장한 내용을 이 기기 state에 반영해요.
   put  : 그 경로를 통째로 바꿔요 (보통 '/' 전체)
   patch: 바뀐 항목만 섞어 넣어요 */
function applyRemote(data, path, kind) {
  const parts = String(path || '/').split('/').filter(Boolean);
  if (!parts.length) {
    state = normalizeState(deepMerge(JSON.parse(JSON.stringify(DEFAULT_STATE)), data || {}));
    return;
  }
  let node = state;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!node[k] || typeof node[k] !== 'object') node[k] = {};
    node = node[k];
  }
  const last = parts[parts.length - 1];
  const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (kind === 'patch' && isPlain(data) && isPlain(node[last])) {
    node[last] = deepMerge(node[last], data);
  } else {
    node[last] = data;
  }
  normalizeState(state);
}

function updateSyncStatus(msg) {
  const el = document.getElementById('sync-status');
  const badge = document.getElementById('sync-badge');
  const text = msg || (remoteSync ? '연결됨 ✅ 실시간 동기화 중' : '로컬 저장소만 사용 중 (이 기기에만 저장)');
  if (el) el.textContent = text;
  if (badge) {
    badge.textContent = msg ? text : (remoteSync ? '☁️ 실시간 동기화 중' : '📴 이 기기에만 저장');
    badge.classList.toggle('chip-yellow', !remoteSync);
    badge.classList.toggle('chip-white', remoteSync);
  }
}

/* ==================== 유틸 ==================== */

const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dateKey();
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const fmtKorean = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`;
const won = (n) => n.toLocaleString('ko-KR') + '원';
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
}

function avatarImg(m, cls = 'avatar') {
  return `<img class="${cls}" src="${m.avatar}" alt="${m.name} 아바타" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${m.name[0]}'}))">`;
}

/* ==================== 쿠키 적립 ==================== */

/* ref(항목 표시)를 주면 같은 날 같은 항목으로는 딱 한 번만 적립돼요.
   체크 → 해제 → 다시 체크를 반복해도 쿠키가 불어나지 않아요. */
function awardCookie(memberId, amount, text, ref) {
  if (!amount) return false;
  const key = ref ? `${todayKey()}|${ref}` : null;
  if (key) {
    state.cookieAwards = state.cookieAwards || {};
    if (state.cookieAwards[key]) return false; // 이미 받은 쿠키
    // 지난 날 장부는 쌓아두지 않아요
    for (const k of Object.keys(state.cookieAwards)) {
      if (!k.startsWith(todayKey() + '|')) delete state.cookieAwards[k];
    }
    state.cookieAwards[key] = { memberId, amount };
  }
  state.cookies[memberId] = (state.cookies[memberId] || 0) + amount;
  const entry = { date: todayKey(), memberId, text, amount, ts: Date.now() };
  if (ref) entry.ref = ref;
  state.cookieLog.unshift(entry);
  state.cookieLog = state.cookieLog.slice(0, 300);
  return true;
}

/* 체크 해제 시 그 항목으로 받은 오늘 쿠키를 돌려놔요 (교환으로 모자라도 마이너스는 안 돼요) */
function revokeCookie(ref) {
  const key = `${todayKey()}|${ref}`;
  const rec = state.cookieAwards && state.cookieAwards[key];
  if (!rec) return false;
  delete state.cookieAwards[key];
  const have = state.cookies[rec.memberId] || 0;
  state.cookies[rec.memberId] = Math.max(0, have - rec.amount);
  const idx = state.cookieLog.findIndex(l => l.ref === ref && l.date === todayKey());
  if (idx >= 0) state.cookieLog.splice(idx, 1);
  return true;
}

function exchangeCookies(memberId) {
  const goal = Number(state.settings.cookieGoal) || 50;
  const amount = Number(state.settings.exchangeWon) || 5000;
  const have = state.cookies[memberId] || 0;
  if (have < goal) {
    toast(`쿠키가 부족해요! ${goal - have}개 더 모아요 🍪`);
    return;
  }
  state.cookies[memberId] = have - goal;
  state.money[memberId] = (state.money[memberId] || 0) + amount;
  state.exchanges.unshift({ date: todayKey(), memberId, cookies: goal, won: amount, ts: Date.now() });
  state.exchanges = state.exchanges.slice(0, 200);
  persist(); renderCookieView(); renderHome();
  toast(`${memberById(memberId).name} 저금통에 ${won(amount)} 쏙! 🐷`);
}

/* ==================== 홈 ==================== */

function renderHome() {
  $('#today-line').textContent = fmtKorean(new Date());

  // 가족 카드
  const goal = Number(state.settings.cookieGoal) || 50;
  $('#home-members').innerHTML = MEMBERS.map(m => {
    const c = state.cookies[m.id] || 0;
    const pct = Math.min(100, Math.round(c / goal * 100));
    return `<div class="member-row" data-member="${m.id}">
      ${avatarImg(m)}
      <div class="member-info">
        <div class="member-name">${m.name}</div>
        <div class="member-sub">${MEMBER_MOTTOS[m.id] || '우리집 도장'}</div>
      </div>
      <div class="member-cookies">
        <div><span class="cookie-star">⭐</span><strong>${c}</strong></div>
        <span class="pig">🍪쿠키저금통 🐷</span>
        <div class="mini-progress"><div style="width:${pct}%"></div></div>
      </div>
    </div>`;
  }).join('');
  document.querySelectorAll('#home-members .member-row').forEach(row => {
    row.addEventListener('click', () => {
      currentCookieMember = row.dataset.member;
      switchView('cookie');
    });
  });

  renderMission();
}

function renderMission() {
  const t = todayKey();
  if (state.mission.date !== t || !state.mission.text) {
    const pick = MISSIONS[Math.floor(Math.random() * MISSIONS.length)];
    state.mission = { date: t, text: pick.text, emoji: pick.emoji, count: state.mission.date === t ? state.mission.count : 0, doneDate: state.mission.doneDate === t ? state.mission.doneDate : '' };
  }
  $('#mission-emoji').textContent = state.mission.emoji || '🎲';
  $('#mission-text').textContent = state.mission.text;
  $('#mission-together').textContent = `함께 ${state.mission.count}번`;
}

/* ==================== 루틴 & 도장판 ==================== */

let currentRoutineMember = 'sia';

function routineDoneMap(memberId, dk) {
  return (state.routineDone[memberId] && state.routineDone[memberId][dk]) || {};
}

function isDayStamped(memberId, dk) {
  const list = state.routines[memberId] || [];
  if (!list.length) return false;
  const done = routineDoneMap(memberId, dk);
  return list.some(r => done[r.id]);
}

function renderRoutineView() {
  const m = memberById(currentRoutineMember);
  // 멤버 칩
  $('#routine-member-chips').innerHTML = MEMBERS.map(x =>
    `<button class="member-chip ${x.id === currentRoutineMember ? 'active' : ''}" data-member="${x.id}">${avatarImg(x, 'avatar')} ${x.name}</button>`
  ).join('');
  document.querySelectorAll('#routine-member-chips .member-chip').forEach(c =>
    c.addEventListener('click', () => { currentRoutineMember = c.dataset.member; renderRoutineView(); }));

  // 도장판
  $('#stamp-title').textContent = `${m.name} 도장판`;
  const today = new Date();
  const dk = todayKey();
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    if (isDayStamped(currentRoutineMember, dateKey(d))) streak++;
    else if (i > 0) break; // 오늘 미완이면 어제부터 계산
    else continue;
  }
  $('#stamp-streak').textContent = `🔥 ${streak}일 연속`;
  $('#stamp-desc').textContent = `${m.name}의 하루에 공부나 루틴을 하나라도 마치면 도장이 찍혀요`;

  // 이번 주 월~일
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  $('#stamp-week').innerHTML = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const stamped = isDayStamped(currentRoutineMember, dateKey(d));
    const isToday = dateKey(d) === dk;
    return `<div class="week-day">${DOW[(i + 1) % 7]}
      <div class="stamp-circle ${stamped ? 'stamped' : ''} ${isToday ? 'today' : ''}">${stamped ? avatarImg(m, '') : ''}</div>
    </div>`;
  }).join('');

  const monthPrefix = dk.slice(0, 7);
  let monthCount = 0;
  const cur = new Date(today.getFullYear(), today.getMonth(), 1);
  while (cur.getMonth() === today.getMonth()) {
    if (isDayStamped(currentRoutineMember, dateKey(cur))) monthCount++;
    cur.setDate(cur.getDate() + 1);
  }
  $('#stamp-month').textContent = `이번 달 도장 ${monthCount}개 · 오늘 ${isDayStamped(currentRoutineMember, dk) ? '콕콕' : '준비중'}`;

  // 루틴 체크리스트
  $('#routine-list-title').textContent = `${m.name}의 하루 루틴`;
  const done = routineDoneMap(currentRoutineMember, dk);
  const list = state.routines[currentRoutineMember] || [];
  $('#routine-list').innerHTML = list.length ? list.map(r => `
    <div class="check-item ${done[r.id] ? 'done' : ''}">
      <button class="check-box green ${done[r.id] ? 'checked' : ''}" data-id="${r.id}">✔</button>
      <span class="check-text">${esc(r.text)}</span>
      <button class="icon-btn danger" data-del="${r.id}">❌</button>
    </div>`).join('') : '<p class="empty-note">루틴을 추가해 도장을 모아요!</p>';
  document.querySelectorAll('#routine-list .check-box').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.id;
    state.routineDone[currentRoutineMember] = state.routineDone[currentRoutineMember] || {};
    const map = state.routineDone[currentRoutineMember];
    map[dk] = map[dk] || {};
    const ref = `routine:${currentRoutineMember}:${id}`;
    if (map[dk][id]) {
      delete map[dk][id];
      if (revokeCookie(ref)) toast('쿠키 -1 🍪');
    } else {
      map[dk][id] = true;
      const t = (state.routines[currentRoutineMember].find(r => r.id === id) || {}).text;
      toast(awardCookie(currentRoutineMember, 1, '루틴: ' + t, ref) ? '쿠키 +1 🍪' : '쿠키는 하루 한 번만 적립돼요 🍪');
    }
    persist(); renderRoutineView(); renderHome();
  }));
  document.querySelectorAll('#routine-list [data-del]').forEach(b => b.addEventListener('click', () => {
    state.routines[currentRoutineMember] = (state.routines[currentRoutineMember] || []).filter(r => r.id !== b.dataset.del);
    persist(); renderRoutineView();
  }));
}

/* ==================== 도장판 달력 모달 ==================== */

let calMonth = new Date();
function renderStampCalendar() {
  const m = memberById(currentRoutineMember);
  $('#stamp-cal-title').textContent = `${m.name}의 도장판`;
  $('#cal-month-label').textContent = `${calMonth.getFullYear()}년 ${calMonth.getMonth() + 1}월`;
  const first = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
  const startPad = (first.getDay() + 6) % 7; // 월요일 시작
  const days = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
  let html = DOW.map((d, i) => `<div class="cal-dow">${['월', '화', '수', '목', '금', '토', '일'][i]}</div>`).join('');
  for (let i = 0; i < startPad; i++) html += '<div class="cal-cell blank"></div>';
  for (let d = 1; d <= days; d++) {
    const dk = `${calMonth.getFullYear()}-${pad(calMonth.getMonth() + 1)}-${pad(d)}`;
    const stamped = isDayStamped(currentRoutineMember, dk);
    html += `<div class="cal-cell ${stamped ? 'stamped' : ''}">${stamped ? avatarImg(m, '') : d}</div>`;
  }
  $('#stamp-cal-grid').innerHTML = html;
}

/* ==================== 일정 ==================== */

function renderScheduleView() {
  const today = todayKey();
  const events = (state.events || []).slice().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  $('#event-list').innerHTML = events.length ? events.map(ev => {
    const d = new Date(ev.date + 'T00:00:00');
    const past = ev.date < today;
    return `<div class="event-item" style="${past ? 'opacity:.45' : ''}">
      <div class="event-date-chip">${d.getMonth() + 1}월<br><span class="d">${d.getDate()}일</span><br>${DOW[d.getDay()]}</div>
      <span class="event-text">${esc(ev.title)}${ev.date === today ? ' <span class="chip chip-orange">오늘</span>' : ''}</span>
      <button class="icon-btn danger" data-del="${ev.id}">❌</button>
    </div>`;
  }).join('') : '<p class="empty-note">아직 일정이 없어요. 추가해 보세요!</p>';
  document.querySelectorAll('#event-list [data-del]').forEach(b => b.addEventListener('click', () => {
    state.events = state.events.filter(e => e.id !== b.dataset.del);
    persist(); renderScheduleView();
  }));
}

/* ==================== 칭찬: 오늘 할 일 ==================== */

let currentTodoFilter = null; // null = 전체 보기

function renderTodoView() {
  const dk = todayKey();
  $('#todo-cookie-val').textContent = state.settings.todoCookie;

  $('#todo-member-chips').innerHTML = MEMBERS.map(x =>
    `<button class="member-chip ${currentTodoFilter === x.id ? 'active' : ''}" data-member="${x.id}">${avatarImg(x, 'avatar')} ${x.name}</button>`
  ).join('');
  document.querySelectorAll('#todo-member-chips .member-chip').forEach(c =>
    c.addEventListener('click', () => {
      currentTodoFilter = currentTodoFilter === c.dataset.member ? null : c.dataset.member;
      renderTodoView();
    }));

  const shown = MEMBERS.filter(m => !currentTodoFilter || m.id === currentTodoFilter);
  $('#todo-list').innerHTML = shown.map(m => {
    const todos = state.todos[m.id] || [];
    const doneMap = (state.todoDone[m.id] && state.todoDone[m.id][dk]) || {};
    const doneCount = todos.filter(t => doneMap[t.id]).length;
    return `<div class="member-block">
      <div class="member-block-head">${avatarImg(m)}<div><div class="member-name">${m.name}</div>
        <div class="done-count">${doneCount}/${todos.length}개 완료</div></div></div>
      <div class="check-list">${todos.map(t => {
        const done = !!doneMap[t.id];
        return `<div class="check-item ${done ? 'done' : ''}">
          <button class="check-box green ${done ? 'checked' : ''}" data-member="${m.id}" data-id="${t.id}">✔</button>
          <span class="check-text">${esc(t.text)}</span>
          <button class="icon-btn" data-edit="${m.id}:${t.id}">✏️</button>
          <button class="icon-btn danger" data-del="${m.id}:${t.id}">❌</button>
        </div>`;
      }).join('') || '<p class="empty-note">할 일을 추가해 주세요</p>'}</div>
      <div class="add-row">
        <input type="text" placeholder="${m.name} 할 일 추가" data-add="${m.id}">
        <button class="btn btn-green" data-addbtn="${m.id}">추가</button>
      </div>
    </div>`;
  }).join('');

  // 이벤트
  document.querySelectorAll('#todo-list .check-box').forEach(b => b.addEventListener('click', () => {
    const { member, id } = b.dataset;
    state.todoDone[member] = state.todoDone[member] || {};
    state.todoDone[member][dk] = state.todoDone[member][dk] || {};
    const map = state.todoDone[member][dk];
    const ref = `todo:${member}:${id}`;
    if (map[id]) {
      delete map[id];
      if (revokeCookie(ref)) toast('쿠키 -' + (Number(state.settings.todoCookie) || 1) + ' 🍪');
    } else {
      map[id] = true;
      const amount = Number(state.settings.todoCookie) || 1;
      const t = (state.todos[member] || []).find(x => x.id === id) || {};
      toast(awardCookie(member, amount, '할 일: ' + t.text, ref)
        ? '쿠키 +' + amount + ' 🍪'
        : '쿠키는 하루 한 번만 적립돼요 🍪');
    }
    persist(); renderTodoView(); renderHome();
  }));
  document.querySelectorAll('#todo-list [data-edit]').forEach(b => b.addEventListener('click', () => {
    const [member, id] = b.dataset.edit.split(':');
    const todo = (state.todos[member] || []).find(t => t.id === id);
    const v = prompt('할 일 수정', todo ? todo.text : '');
    if (v && todo) { todo.text = v.trim(); persist(); renderTodoView(); }
  }));
  document.querySelectorAll('#todo-list [data-del]').forEach(b => b.addEventListener('click', () => {
    const [member, id] = b.dataset.del.split(':');
    state.todos[member] = (state.todos[member] || []).filter(t => t.id !== id);
    persist(); renderTodoView();
  }));
  document.querySelectorAll('#todo-list [data-addbtn]').forEach(b => b.addEventListener('click', () => {
    addTodo(b.dataset.addbtn);
  }));
  document.querySelectorAll('#todo-list [data-add]').forEach(inp => inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') addTodo(inp.dataset.add);
  }));
}

function addTodo(memberId) {
  const inp = document.querySelector(`#todo-list [data-add="${memberId}"]`);
  if (!inp || !inp.value.trim()) return;
  state.todos[memberId] = state.todos[memberId] || [];
  state.todos[memberId].push({ id: uid(), text: inp.value.trim() });
  persist(); renderTodoView();
}

/* ==================== 공부 플랜 ==================== */

let currentStudyMember = 'sia';

function studyItems(memberId) {
  const items = [];
  (state.studyFixed || []).forEach(f => items.push({ key: 'f:' + f.id, text: f.text, cookies: Number(f.cookies) || 1, fixed: true, id: f.id }));
  ((state.studyCustom && state.studyCustom[memberId]) || []).forEach(c => items.push({ key: 'c:' + c.id, text: c.text, cookies: Number(c.cookies) || Number(state.settings.studyCookie) || 1, fixed: false, id: c.id }));
  return items;
}

function renderStudyView() {
  const dk = todayKey();
  const m = memberById(currentStudyMember);
  $('#study-member-chip').textContent = m.name;

  const items = studyItems(currentStudyMember);
  const doneMap = (state.studyDone[currentStudyMember] && state.studyDone[currentStudyMember][dk]) || {};
  const doneCount = items.filter(i => doneMap[i.key]).length;

  $('#study-progress-bar').style.width = items.length ? Math.round(doneCount / items.length * 100) + '%' : '0%';
  $('#study-progress-label').textContent = `${doneCount} / ${items.length} 완료`;

  $('#study-list').innerHTML = items.filter(i => i.fixed).map(i => studyRow(m, i, doneMap)).join('');
  $('#study-custom-list').innerHTML = items.filter(i => !i.fixed).map(i => studyRow(m, i, doneMap)).join('')
    || '<p class="empty-note">＋ 공부 추가 버튼으로 항목을 더해요</p>';

  document.querySelectorAll('#study-list .check-box, #study-custom-list .check-box').forEach(b => b.addEventListener('click', () => {
    state.studyDone[currentStudyMember] = state.studyDone[currentStudyMember] || {};
    state.studyDone[currentStudyMember][dk] = state.studyDone[currentStudyMember][dk] || {};
    const map = state.studyDone[currentStudyMember][dk];
    const key = b.dataset.key;
    const item = items.find(i => i.key === key);
    const ref = `study:${currentStudyMember}:${key}`;
    const amount = item ? item.cookies : 1;
    if (map[key]) {
      delete map[key];
      if (revokeCookie(ref)) toast(`쿠키 -${amount} 🍪`);
    } else {
      map[key] = true;
      toast(awardCookie(currentStudyMember, amount, '공부: ' + (item ? item.text : ''), ref)
        ? `쿠키 +${amount} 🍪`
        : '쿠키는 하루 한 번만 적립돼요 🍪');
    }
    persist(); renderStudyView(); renderHome();
  }));
  document.querySelectorAll('#study-list [data-del], #study-custom-list [data-del]').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.del;
    if (key.startsWith('f:')) state.studyFixed = state.studyFixed.filter(f => 'f:' + f.id !== key);
    else state.studyCustom[currentStudyMember] = (state.studyCustom[currentStudyMember] || []).filter(c => 'c:' + c.id !== key);
    persist(); renderStudyView();
  }));
}

function studyRow(m, item, doneMap) {
  const done = !!doneMap[item.key];
  return `<div class="check-item ${done ? 'done' : ''}">
    <button class="check-box green ${done ? 'checked' : ''}" data-key="${item.key}">✔</button>
    <span class="check-text">${esc(item.text)}</span>
    <span class="check-tag">🍪 ${item.cookies}개</span>
    ${item.fixed ? '' : `<button class="icon-btn danger" data-del="${item.key}">❌</button>`}
  </div>`;
}

function renderFixedStudyModal() {
  $('#fixed-study-list').innerHTML = (state.studyFixed || []).map(f => `
    <div class="check-item">
      <span class="check-text">${esc(f.text)}</span>
      <input type="number" class="num-input" value="${f.cookies}" min="1" data-fixc="${f.id}" title="쿠키 개수">
      <button class="icon-btn danger" data-fixdel="${f.id}">❌</button>
    </div>`).join('') || '<p class="empty-note">고정 항목이 없어요</p>';
  document.querySelectorAll('#fixed-study-list [data-fixdel]').forEach(b => b.addEventListener('click', () => {
    state.studyFixed = state.studyFixed.filter(f => f.id !== b.dataset.fixdel);
    persist(); renderFixedStudyModal(); renderStudyView();
  }));
  document.querySelectorAll('#fixed-study-list [data-fixc]').forEach(inp => inp.addEventListener('change', () => {
    const f = state.studyFixed.find(x => x.id === inp.dataset.fixc);
    if (f) { f.cookies = Math.max(1, Number(inp.value) || 1); persist(); renderStudyView(); }
  }));
}

/* ==================== 타이머 ==================== */

const timer = {
  mode: 'countdown',      // countdown | stopwatch
  presetMin: 10,
  totalMs: 600000,
  startTs: null,          // Date.now() when started
  elapsedBase: 0,         // ms elapsed before current run
  running: false,
  tick: null,
};

function timerElapsed() {
  return timer.elapsedBase + (timer.running ? Date.now() - timer.startTs : 0);
}

function timerDisplay() {
  if (timer.mode === 'countdown') {
    const remain = Math.max(0, timer.totalMs - timerElapsed());
    return { text: fmtMs(remain), done: remain <= 0, running: timer.running };
  }
  return { text: fmtMs(timerElapsed()), done: false, running: timer.running };
}

function fmtMs(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? `${h}:${pad(m)}` : `${pad(m)}:${pad(sec)}`);
}

function renderTimer() {
  const d = timerDisplay();
  $('#timer-display').textContent = d.text;
  $('#btn-timer-start').textContent = timer.running ? '⏸ 정지' : '▶ 시작';
  $('#timer-hint').textContent = timer.mode === 'countdown'
    ? `${timer.presetMin}분 · ${timer.running ? '열심히 해볼까요!' : '시작을 놀러요'}`
    : `재는 시간 · ${timer.running ? '가는 중!' : '멈춰 있어요'}`;
  document.querySelectorAll('.preset').forEach(p => p.classList.toggle('active', Number(p.dataset.min) === timer.presetMin));
}

function tickTimer() {
  renderTimer();
  const d = timerDisplay();
  if (timer.mode === 'countdown' && timer.running && d.done) {
    timer.running = false;
    timer.elapsedBase = timer.totalMs;
    toast('타이머 끝! 훌륭해요 🎉');
    renderTimer();
  }
}

function startPauseTimer() {
  if (timer.running) {
    timer.elapsedBase += Date.now() - timer.startTs;
    timer.running = false;
  } else {
    if (timer.mode === 'countdown' && timer.elapsedBase >= timer.totalMs) {
      timer.elapsedBase = 0;
    }
    timer.startTs = Date.now();
    timer.running = true;
  }
  renderTimer();
}

function resetTimer() {
  timer.running = false;
  timer.elapsedBase = 0;
  timer.totalMs = timer.presetMin * 60000;
  renderTimer();
}

/* ==================== 쿠키 뱅크 ==================== */

let currentCookieMember = 'sia';

function renderCookieView() {
  const m = memberById(currentCookieMember);
  const goal = Number(state.settings.cookieGoal) || 50;
  const amount = Number(state.settings.exchangeWon) || 5000;
  const c = state.cookies[currentCookieMember] || 0;
  const pct = Math.min(100, Math.round(c / goal * 100));

  $('#cookie-member-chips').innerHTML = MEMBERS.map(x =>
    `<button class="member-chip ${x.id === currentCookieMember ? 'active' : ''}" data-member="${x.id}">${avatarImg(x, 'avatar')} ${x.name}</button>`
  ).join('');
  document.querySelectorAll('#cookie-member-chips .member-chip').forEach(ch =>
    ch.addEventListener('click', () => { currentCookieMember = ch.dataset.member; renderCookieView(); }));

  $('#cookie-avatar').src = m.avatar;
  $('#cookie-member-name').textContent = m.name;
  $('#cookie-member-sub').textContent = m.role ? `${m.name}(${m.role}) 저금통` : `${m.name} 저금통`;
  $('#cookie-money').textContent = `🌙 ${won(state.money[currentCookieMember] || 0)}`;
  $('#cookie-count').textContent = c;
  $('#cookie-progress-hint').textContent = `${goal}개 모으면 ${won(amount)}! (${pct}%)`;
  $('#cookie-progress-bar').style.width = pct + '%';
  const btn = $('#btn-exchange');
  btn.textContent = `🎁 ${goal}쿠키 → ${won(amount)} 교환하기`;
  btn.disabled = c < goal;

  const logs = state.cookieLog.filter(l => l.memberId === currentCookieMember).slice(0, 20);
  $('#cookie-log').innerHTML = logs.length ? logs.map(l =>
    `<div class="cookie-log-item"><span class="log-date">${l.date.slice(5).replace('-', '/')}</span>
     <span class="log-text">${esc(l.text)}</span><span class="log-amount">+${l.amount} 🍪</span></div>`
  ).join('') : '<p class="empty-note">아직 모은 쿠키가 없어요</p>';
  const todaySum = state.cookieLog.filter(l => l.memberId === currentCookieMember && l.date === todayKey()).reduce((s, l) => s + l.amount, 0);
  $('#cookie-today-badge').textContent = `오늘 +${todaySum}`;

  const exs = state.exchanges.filter(e => e.memberId === currentCookieMember).slice(0, 20);
  $('#exchange-history').innerHTML = exs.length ? exs.map(e =>
    `<div class="exchange-item"><span class="log-date">${e.date.slice(5).replace('-', '/')}</span>
     <span class="log-text">🍪 ${e.cookies}개 교환</span><span class="log-amount plus">+${won(e.won)} 🐷</span></div>`
  ).join('') : '<p class="empty-note">교환 기록이 없어요</p>';
}

/* ==================== 채팅 ==================== */

const CHAT_LOCK_KEY = 'family-dashboard-chat-lock';
let currentChatMember = null;

function renderChatView() {
  // 기기 잠금 복원
  if (!currentChatMember) {
    const locked = localStorage.getItem(CHAT_LOCK_KEY);
    if (locked && MEMBERS.some(m => m.id === locked)) currentChatMember = locked;
  }
  $('#chat-member-chips').innerHTML = MEMBERS.map(x =>
    `<button class="member-chip ${currentChatMember === x.id ? 'active' : ''}" data-member="${x.id}">${avatarImg(x, 'avatar')} ${x.name}</button>`
  ).join('');
  document.querySelectorAll('#chat-member-chips .member-chip').forEach(c =>
    c.addEventListener('click', () => {
      currentChatMember = c.dataset.member;
      localStorage.removeItem(CHAT_LOCK_KEY);
      renderChatView();
    }));
  $('#btn-chat-lock').textContent = currentChatMember ? `🔒 이 기기 잠금 (${memberById(currentChatMember).name})` : '🔒 이 기기 잠금';

  renderChatMessages();
}

function renderChatMessages() {
  const msgs = (state.chat.messages || []).slice().sort((a, b) => a.ts - b.ts);
  $('#chat-messages').innerHTML = msgs.map(msg => {
    const m = memberById(msg.memberId);
    const mine = msg.memberId === currentChatMember;
    const t = new Date(msg.ts);
    const time = `오${t.getHours() < 12 ? '전' : '후'} ${((t.getHours() + 11) % 12) + 1}:${pad(t.getMinutes())}`;
    const reacted = !!(msg.reactions && msg.reactions[currentChatMember]);
    const reactionCount = msg.reactions ? Object.keys(msg.reactions).length : 0;
    const body = msg.sticker
      ? `<div class="bubble sticker">${esc(msg.sticker)}</div>`
      : `<div class="bubble">${esc(msg.text)}</div>`;
    return `<div class="chat-row ${mine ? 'mine' : ''}">
      ${avatarImg(m, 'avatar')}
      <div class="chat-col">
        <span class="chat-name-time">${mine ? '' : m.name + ' '}${time}</span>
        ${body}
        <div class="bubble-actions">
          <button class="react-btn ${reacted ? 'reacted' : ''}" data-react="${msg.id}">❤️${reactionCount ? `<span class="react-count">${reactionCount}</span>` : ''}</button>
          <button class="del-btn" data-msgdel="${msg.id}">✕</button>
        </div>
      </div>
    </div>`;
  }).join('') || '<p class="empty-note">첫 메시지를 남겨보세요!</p>';

  document.querySelectorAll('#chat-messages [data-react]').forEach(b => b.addEventListener('click', () => {
    const msg = state.chat.messages.find(x => x.id === b.dataset.react);
    if (!msg) return;
    msg.reactions = msg.reactions || {};
    if (msg.reactions[currentChatMember]) delete msg.reactions[currentChatMember];
    else msg.reactions[currentChatMember] = true;
    persist(); renderChatMessages();
  }));
  document.querySelectorAll('#chat-messages [data-msgdel]').forEach(b => b.addEventListener('click', () => {
    state.chat.messages = state.chat.messages.filter(x => x.id !== b.dataset.msgdel);
    persist(); renderChatMessages();
  }));
  scrollChatBottom();
}

function scrollChatBottom() {
  const el = $('#chat-messages');
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

function sendChatMessage(text, sticker) {
  if (!currentChatMember) { toast('먼저 프로필을 골라요!'); return; }
  state.chat.messages.push({ id: uid(), memberId: currentChatMember, text: text || '', sticker: sticker || '', ts: Date.now(), reactions: {} });
  state.chat.messages = state.chat.messages.slice(-200);
  persist(); renderChatMessages();
}

function renderStickers() {
  $('#sticker-grid').innerHTML = STICKERS.map(s =>
    `<button data-sticker="${s}">${s.replace(/[a-zA-Z가-힣]/g, '') || s}</button>`).join('');
  document.querySelectorAll('#sticker-grid button').forEach(b =>
    b.addEventListener('click', () => {
      sendChatMessage('', b.dataset.sticker);
      $('#sticker-sheet').classList.add('hidden');
    }));
}

/* ==================== 설정 ==================== */

function openSettings() {
  $('#set-cookie-goal').value = state.settings.cookieGoal;
  $('#set-exchange-won').value = state.settings.exchangeWon;
  $('#set-todo-cookie').value = state.settings.todoCookie;
  $('#set-study-cookie').value = state.settings.studyCookie;
  $('#set-firebase-config').value = state.settings.firebase.config || '';
  $('#set-firebase-enabled').checked = !!state.settings.firebase.enabled;
  updateSyncStatus();
  openModal('modal-settings');
}

function saveSettings() {
  state.settings.cookieGoal = Math.max(1, Number($('#set-cookie-goal').value) || 50);
  state.settings.exchangeWon = Math.max(100, Number($('#set-exchange-won').value) || 5000);
  state.settings.todoCookie = Math.max(1, Number($('#set-todo-cookie').value) || 1);
  state.settings.studyCookie = Math.max(1, Number($('#set-study-cookie').value) || 1);
  const newConfig = $('#set-firebase-config').value.trim();
  const configChanged = newConfig !== state.settings.firebase.config;
  state.settings.firebase.config = newConfig;
  const wasEnabled = state.settings.firebase.enabled;
  state.settings.firebase.enabled = $('#set-firebase-enabled').checked;
  persist();
  closeModal('modal-settings');
  toast('저장했어요 ✅');
  renderAll();
  if (state.settings.firebase.enabled && (!wasEnabled || configChanged)) connectFirebase();
  else updateSyncStatus();
}

function resetData() {
  if (!confirm('정말 모든 기록을 지우고 처음부터 시작할까요?')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(CHAT_LOCK_KEY);
  location.reload();
}

/* ==================== 모달 / 탭 공통 ==================== */

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo({ top: 0 });
  if (name === 'chat') scrollChatBottom();
}

/* ==================== 날씨 (시흥, mock fallback) ==================== */

function renderWeatherMock() {
  $('#weather-icon').textContent = '🌞';
  $('#weather-temp').textContent = '11°';
  $('#weather-sky').textContent = '맑음';
  $('#weather-minmax').textContent = '최저 6° · 최고 15°';
  $('#weather-dust').textContent = '미세먼지 보통';
  $('#weather-tip1').textContent = '초미세먼지 나쁨';
  $('#weather-tip2').textContent = '😷 마스크 챙겨요';
}

async function fetchWeather() {
  try {
    // 시흥시 대략 좌표, Open-Meteo (무료·키 불필요)
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=37.38&longitude=126.80&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FSeoul&forecast_days=1');
    if (!res.ok) throw new Error();
    const j = await res.json();
    const t = Math.round(j.current.temperature_2m);
    const code = j.current.weather_code;
    const sky = code === 0 ? '맑음' : code < 3 ? '대체로 맑음' : code < 50 ? '흐림' : code < 70 ? '비' : '눈';
    $('#weather-icon').textContent = code === 0 ? '🌞' : code < 3 ? '🌤️' : code < 50 ? '☁️' : code < 70 ? '🌧️' : '❄️';
    $('#weather-loc').textContent = '시흥';
    $('#weather-temp').textContent = t + '°';
    $('#weather-sky').textContent = sky;
    $('#weather-minmax').textContent = `최저 ${Math.round(j.daily.temperature_2m_min[0])}° · 최고 ${Math.round(j.daily.temperature_2m_max[0])}°`;
  } catch (e) {
    renderWeatherMock(); // 오프라인이면 mock 값
  }
}

/* ==================== 전체 렌더 & 이벤트 ==================== */

function renderAll() {
  renderHome();
  renderRoutineView();
  renderScheduleView();
  renderTodoView();
  renderStudyView();
  renderCookieView();
  renderChatView();
}

function bindEvents() {
  // 하단 탭
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.addEventListener('click', () => switchView(b.dataset.view)));

  // 홈
  $('#btn-encourage').addEventListener('click', () => toast('오늘도 포근한 하루! 💛'));
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-mission-done').addEventListener('click', () => {
    if (state.mission.doneDate === todayKey()) { toast('오늘은 이미 함께 했어요! 내일 또 만나요 🌙'); return; }
    state.mission.count = (state.mission.count || 0) + 1;
    state.mission.doneDate = todayKey();
    persist(); renderMission();
    toast('가족 미션 성공! 굿굿 🎉');
  });
  $('#btn-mission-reroll').addEventListener('click', () => {
    const t = todayKey();
    const keep = state.mission.date === t ? state.mission : { date: t, count: 0, doneDate: '' };
    let pick;
    do { pick = MISSIONS[Math.floor(Math.random() * MISSIONS.length)]; } while (pick.text === state.mission.text && MISSIONS.length > 1);
    state.mission = { date: t, text: pick.text, emoji: pick.emoji, count: keep.count, doneDate: keep.doneDate };
    persist(); renderMission();
  });

  // 루틴
  $('#btn-stamp-calendar').addEventListener('click', () => {
    calMonth = new Date();
    renderStampCalendar();
    openModal('modal-stamp-calendar');
  });
  $('#cal-prev').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderStampCalendar(); });
  $('#cal-next').addEventListener('click', () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderStampCalendar(); });
  $('#btn-routine-add').addEventListener('click', () => {
    const inp = $('#routine-input');
    if (!inp.value.trim()) return;
    state.routines[currentRoutineMember] = state.routines[currentRoutineMember] || [];
    state.routines[currentRoutineMember].push({ id: uid(), text: inp.value.trim() });
    inp.value = '';
    persist(); renderRoutineView();
  });
  $('#routine-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-routine-add').click(); });

  // 일정
  $('#btn-event-add').addEventListener('click', () => {
    const date = $('#event-date').value;
    const title = $('#event-title').value.trim();
    if (!date || !title) { toast('날짜와 내용을 모두 적어요'); return; }
    state.events.push({ id: uid(), date, title });
    $('#event-title').value = '';
    persist(); renderScheduleView();
    toast('일정 추가! 🎈');
  });
  $('#event-title').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-event-add').click(); });

  // 칭찬
  $('#btn-todo-add').addEventListener('click', () => {
    const target = currentTodoFilter || 'sia';
    const inp = $('#todo-input');
    if (!inp.value.trim()) return;
    state.todos[target] = state.todos[target] || [];
    state.todos[target].push({ id: uid(), text: inp.value.trim() });
    inp.value = '';
    persist(); renderTodoView();
  });
  $('#btn-study-settings').addEventListener('click', () => { renderFixedStudyModal(); openModal('modal-study-settings'); });
  $('#btn-fixed-study-add').addEventListener('click', () => {
    const t = $('#fixed-study-input').value.trim();
    if (!t) return;
    state.studyFixed = state.studyFixed || [];
    state.studyFixed.push({ id: uid(), text: t, cookies: Math.max(1, Number($('#fixed-study-cookies').value) || 1) });
    $('#fixed-study-input').value = '';
    persist(); renderFixedStudyModal(); renderStudyView();
  });
  $('#btn-study-add').addEventListener('click', () => {
    const t = prompt('새 공부 항목 (쿠키 개수는 기본값으로 들어가요)', '');
    if (!t || !t.trim()) return;
    state.studyCustom[currentStudyMember] = state.studyCustom[currentStudyMember] || [];
    state.studyCustom[currentStudyMember].push({ id: uid(), text: t.trim(), cookies: Number(state.settings.studyCookie) || 1 });
    persist(); renderStudyView();
  });
  // study member chips = todo chips 재사용? 별도로 없음: study는 시아 기본, todo chip에서 멤버 눌러도 study 유지
  document.querySelectorAll('#todo-member-chips .member-chip').forEach(() => {});
  $('#study-member-chip').addEventListener('click', () => {
    const idx = MEMBERS.findIndex(m => m.id === currentStudyMember);
    currentStudyMember = MEMBERS[(idx + 1) % MEMBERS.length].id;
    renderStudyView();
  });

  // 타이머
  $('#seg-countdown').addEventListener('click', () => {
    timer.mode = 'countdown';
    $('#seg-countdown').classList.add('active'); $('#seg-stopwatch').classList.remove('active');
    resetTimer();
  });
  $('#seg-stopwatch').addEventListener('click', () => {
    timer.mode = 'stopwatch';
    $('#seg-stopwatch').classList.add('active'); $('#seg-countdown').classList.remove('active');
    resetTimer();
  });
  $('#btn-timer-start').addEventListener('click', startPauseTimer);
  $('#btn-timer-reset').addEventListener('click', resetTimer);
  document.querySelectorAll('.preset').forEach(p => p.addEventListener('click', () => {
    timer.presetMin = Number(p.dataset.min);
    resetTimer();
  }));
  $('#btn-timer-custom').addEventListener('click', () => {
    const v = Number(prompt('몇 분으로 할까요?', '15'));
    if (!v || v <= 0) return;
    timer.presetMin = v;
    resetTimer();
  });
  setInterval(tickTimer, 500);

  // 쿠키
  $('#btn-exchange').addEventListener('click', () => exchangeCookies(currentCookieMember));

  // 채팅
  $('#btn-chat-send').addEventListener('click', () => {
    const inp = $('#chat-input');
    if (!inp.value.trim()) return;
    sendChatMessage(inp.value.trim());
    inp.value = '';
  });
  $('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-chat-send').click(); });
  $('#btn-sticker-picker').addEventListener('click', () => $('#sticker-sheet').classList.toggle('hidden'));
  $('#btn-chat-lock').addEventListener('click', () => {
    if (!currentChatMember) { toast('먼저 프로필을 골라요!'); return; }
    localStorage.setItem(CHAT_LOCK_KEY, currentChatMember);
    toast(`${memberById(currentChatMember).name} 프로필로 이 기기가 잠겼어요 🔒`);
    renderChatView();
  });

  // 모달 닫기
  document.querySelectorAll('.modal-close').forEach(b =>
    b.addEventListener('click', () => closeModal(b.dataset.close)));
  document.querySelectorAll('.modal').forEach(m =>
    m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); }));

  // 설정
  $('#btn-save-settings').addEventListener('click', saveSettings);
  $('#btn-reset-data').addEventListener('click', resetData);
}

/* ==================== 시작 ==================== */

(async function main() {
  await initStore();
  bindEvents();
  renderStickers();
  renderAll();
  fetchWeather();
  connectFirebase();
})();
