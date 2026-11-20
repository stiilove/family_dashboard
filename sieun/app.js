/* ============================================================
   시은이 아침 퀘스트
   - localStorage + Firebase RTDB 동기화 (/sieunMorning.json)
   - Open-Meteo 날씨·미세먼지 (시흥 기준)
   - Web Audio 효과음 / 일주일 완주 축하
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 상수 ---------------- */
  var LS_KEY = 'sieunMorning.v1';
  var W_KEY = 'sieunWeather.v1';
  var FB_URL = 'https://family-dashboard-34895-default-rtdb.asia-southeast1.firebasedatabase.app/sieunMorning.json';
  var DEPART_DEFAULT = '08:30';
  var LAT = 37.38, LON = 126.80;       // 시흥시
  var POLL_MS = 20000;

  var QUESTS = [
    { id: 'brush', num: 1, title: '양치하기', img: 'assets/quest-brush.jpg' },
    { id: 'wash',  num: 2, title: '세수하기', img: 'assets/quest-wash.jpg' },
    { id: 'dress', num: 3, title: '옷 갈아입기', img: 'assets/quest-dress.jpg' }
  ];

  var WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
  var WEEKDAY_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

  /* ---------------- 유틸 ---------------- */
  function $(sel) { return document.querySelector(sel); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function keyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function mondayOf(d) { var x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); }
  function todayKey() { return keyOf(new Date()); }

  /* ---------------- 상태 ---------------- */
  function defaultState() {
    return { v: 1, departure: DEPART_DEFAULT, muted: false, days: {}, celebrate: {}, updatedAt: 0 };
  }

  function normalize(s) {
    var out = defaultState();
    if (!s || typeof s !== 'object') return out;
    out.departure = (/^\d{2}:\d{2}$/.test(s.departure || '') ? s.departure : DEPART_DEFAULT);
    out.muted = !!s.muted;
    out.days = (s.days && typeof s.days === 'object') ? s.days : {};
    out.celebrate = (s.celebrate && typeof s.celebrate === 'object') ? s.celebrate : {};
    out.updatedAt = Number(s.updatedAt) || 0;
    return out;
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* 저장소를 못 쓰면 메모리로만 동작 */ }
    return defaultState();
  }

  function pruneDays(days) {
    var keys = Object.keys(days).sort();
    if (keys.length <= 70) return days;
    keys.slice(0, keys.length - 70).forEach(function (k) { delete days[k]; });
    return days;
  }

  var state = loadLocal();

  function saveLocal(bump) {
    if (bump !== false) state.updatedAt = Date.now();
    pruneDays(state.days);
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { }
  }

  /* ---------------- Firebase 동기화 ---------------- */
  var syncOk = null;

  function setSyncNote() {
    var el = $('#sync-note');
    if (!el) return;
    if (syncOk === true) {
      el.textContent = '☁️ 가족과 연결됐어요 · 폰에서도 같이 보여요';
      el.className = 'sync-note ok';
    } else if (syncOk === false) {
      el.textContent = '📴 지금은 이 기기에만 저장 중 (연결되면 자동으로 맞춰져요)';
      el.className = 'sync-note off';
    } else {
      el.textContent = '☁️ 가족과 연결 확인 중…';
      el.className = 'sync-note';
    }
  }

  function fbPullRaw() {
    return fetch(FB_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      });
  }

  function fbPull() {
    return fbPullRaw().then(function (remote) {
      syncOk = true;
      setSyncNote();
      if (remote && typeof remote === 'object' && typeof remote.updatedAt === 'number') {
        if ((remote.updatedAt || 0) > (state.updatedAt || 0)) {
          state = normalize(remote);
          saveLocal(false);
          renderAll();
          fbPullDone = true;
        }
      }
    }).catch(function () {
      syncOk = false;
      setSyncNote();
    });
  }

  var fbPullDone = false;

  var pushTimer = null;
  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 500);
  }

  function pushNow() {
    fetch(FB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    }).then(function (res) {
      syncOk = res.ok;
      setSyncNote();
    }).catch(function () {
      syncOk = false;
      setSyncNote();
    });
  }

  /* ---------------- 효과음 (Web Audio) ---------------- */
  var audioCtx = null;

  function audio() {
    if (state.muted) return null;
    if (!audioCtx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { audioCtx = new C(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') { audioCtx.resume().catch(function () { }); }
    return audioCtx;
  }

  function tone(freq, delay, dur, type, vol) {
    var ctx = audio();
    if (!ctx) return;
    var t0 = ctx.currentTime + delay;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.16, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.06);
  }

  function sfxChime() {
    tone(784, 0, 0.16, 'sine', 0.14);
    tone(1046, 0.09, 0.22, 'sine', 0.12);
    tone(1318, 0.19, 0.28, 'triangle', 0.09);
  }
  function sfxUndo() {
    tone(392, 0, 0.12, 'triangle', 0.09);
    tone(294, 0.08, 0.16, 'triangle', 0.08);
  }
  function sfxAllDone() {
    [523, 659, 784, 1046].forEach(function (f, i) { tone(f, i * 0.11, 0.3, 'triangle', 0.13); });
    tone(1568, 0.46, 0.45, 'sine', 0.09);
  }
  function sfxFanfare() {
    [523, 587, 659, 784, 880, 1046].forEach(function (f, i) { tone(f, i * 0.09, 0.26, 'triangle', 0.11); });
    [1046, 1318, 1568].forEach(function (f) { tone(f, 0.62, 0.6, 'sine', 0.08); });
  }

  /* ---------------- 시계 (픽셀 디지털) ---------------- */
  function tickClock() {
    var now = new Date();
    var h = now.getHours();
    var m = now.getMinutes();
    var h12 = h % 12 === 0 ? 12 : h % 12;
    var txt = pad2(h12) + ':' + pad2(m);
    var el = $('#time-text');
    if (el.textContent !== txt) el.textContent = txt;
    $('#ampm').textContent = h < 12 ? '오전' : '오후';
  }

  /* ---------------- 날짜 ---------------- */
  function renderDate() {
    var now = new Date();
    $('#date-main').textContent = (now.getMonth() + 1) + '월 ' + now.getDate() + '일';
    $('#date-day').textContent = WEEKDAY_LONG[now.getDay()];
  }

  /* ---------------- 남은 시간 · 게이지 ---------------- */
  function departureDate() {
    var parts = state.departure.split(':');
    var d = new Date();
    d.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
    return d;
  }

  function formatDeparture(str) {
    var p = str.split(':');
    var h = Number(p[0]);
    var mm = p[1] || '00';
    var ampm = h < 12 ? '오전' : '오후';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return ampm + ' ' + h12 + ':' + mm;
  }

  function renderDeparture() {
    $('#depart-time').textContent = formatDeparture(state.departure);
  }

  function renderTimeLeft() {
    var now = new Date();
    var left = Math.round((departureDate().getTime() - now.getTime()) / 60000);
    var txt;
    var late = false;
    if (left > 0) {
      txt = left >= 60
        ? Math.floor(left / 60) + '시간 ' + (left % 60) + '분 남았어요'
        : left + '분 남았어요';
    } else if (left > -60) {
      txt = '지금 출발 시간이에요!';
      late = true;
    } else {
      txt = '오늘 출발 시간이 지났어요';
      late = true;
    }
    var el = $('#mins');
    if (el.textContent !== txt) el.textContent = txt;
    el.classList.toggle('late', late);
  }

  /* ---------------- 퀘스트 ---------------- */
  function todayRecord(force) {
    var k = todayKey();
    if (!state.days[k] && force) state.days[k] = {};
    return state.days[k] || {};
  }

  function isDone(id) { return !!todayRecord(false)[id]; }

  function doneCount() {
    return QUESTS.filter(function (q) { return isDone(q.id); }).length;
  }

  function buildQuests() {
    var wrap = $('#quests');
    wrap.innerHTML = '';
    QUESTS.forEach(function (q) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'quest';
      card.dataset.id = q.id;
      card.setAttribute('aria-pressed', 'false');
      card.setAttribute('aria-label', q.title + ' 퀘스트');
      card.innerHTML =
        '<span class="q-num">' + q.num + '</span>' +
        '<span class="q-bubble">같이 하자!</span>' +
        '<img class="q-img" src="' + q.img + '" alt="">' +
        '<span class="q-check"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.6l4.4 4.4L19 7.4"/></svg></span></span>' +
        '<span class="q-title">' + q.title + '</span>';
      card.addEventListener('click', function () { toggleQuest(q.id, card); });
      wrap.appendChild(card);
    });
  }

  var celebratedToday = '';

  function toggleQuest(id, card) {
    var rec = todayRecord(true);
    var wasDone = !!rec[id];
    if (wasDone) {
      delete rec[id];
    } else {
      rec[id] = true;
    }
    if (Object.keys(rec).length === 0) delete state.days[todayKey()];

    saveLocal();
    schedulePush();
    updateQuests(wasDone ? null : card);

    if (!wasDone) {
      sfxChime();
      burstSparks(card, 8);
      if (doneCount() === QUESTS.length) {
        var key = todayKey();
        var w = weekInfo();
        if (w.complete) {
          celebratedToday = key;
          setTimeout(function () { showCheer(false); }, 420);
        } else if (celebratedToday !== key) {
          celebratedToday = key;
          setTimeout(function () { sfxAllDone(); toast('우와! 오늘 아침 퀘스트 다 했어! 🎉'); }, 260);
        }
      }
    } else {
      sfxUndo();
    }
    renderWeek();
    renderGauge();
  }

  function updateQuests(justDoneCard) {
    var firstOpen = null;
    var cards = document.querySelectorAll('.quest');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var done = isDone(card.dataset.id);
      card.classList.toggle('done', done);
      card.setAttribute('aria-pressed', done ? 'true' : 'false');
      if (!done && !firstOpen) firstOpen = card;
    }
    for (var j = 0; j < cards.length; j++) cards[j].classList.toggle('next', cards[j] === firstOpen && doneCount() < QUESTS.length);

    if (justDoneCard) {
      justDoneCard.classList.add('just-done');
      setTimeout(function () { justDoneCard.classList.remove('just-done'); }, 520);
    }
  }

  function renderGauge() {
    var done = doneCount();
    var p = (done / QUESTS.length) * 100;
    $('#gauge-fill').style.setProperty('--p', p);
    $('#gauge-face').style.setProperty('--p', p);
    var bubble = $('#gauge-bubble');
    var allDone = done >= QUESTS.length;
    var text = allDone ? '다 했어! 최고야!' : (QUESTS.length - done) + '개 남았어! 힘내!';
    if (bubble.textContent !== text) bubble.textContent = text;
    bubble.classList.toggle('all-done', allDone);
  }

  function burstSparks(host, count) {
    var glyphs = ['✨', '⭐', '💫', '🌟', '💛'];
    for (var i = 0; i < count; i++) {
      (function (i) {
        var s = document.createElement('span');
        s.className = 'spark';
        s.textContent = glyphs[i % glyphs.length];
        var ang = Math.random() * Math.PI * 2;
        var dist = 70 + Math.random() * 110;
        s.style.left = 'calc(50% + ' + (Math.random() * 50 - 25) + 'px)';
        s.style.top = 'calc(50% + ' + (Math.random() * 50 - 25) + 'px)';
        s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
        s.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
        s.style.setProperty('--rot', (Math.random() * 400 - 200) + 'deg');
        s.style.animationDelay = (Math.random() * 0.1) + 's';
        host.appendChild(s);
        setTimeout(function () { s.remove(); }, 1400);
      })(i);
    }
  }

  /* ---------------- 주간 스탬프 ---------------- */
  function weekInfo() {
    var today = new Date();
    var mon = mondayOf(today);
    var todayStart = startOfDay(today);
    var days = [];
    for (var i = 0; i < 5; i++) {
      var d = addDays(mon, i);
      var k = keyOf(d);
      var rec = state.days[k] || {};
      var done = QUESTS.filter(function (q) { return !!rec[q.id]; }).length;
      days.push({
        date: d, key: k, done: done, full: done === QUESTS.length,
        isToday: k === keyOf(today),
        future: startOfDay(d) > todayStart
      });
    }
    var weekKey = keyOf(mon);
    var complete = days.every(function (x) { return x.full; });
    return {
      mon: mon, days: days, weekKey: weekKey,
      complete: complete,
      celebrated: !!state.celebrate[weekKey],
      fullDays: days.filter(function (x) { return x.full; }).length
    };
  }

  function renderWeek() {
    var w = weekInfo();
    var host = $('#week-days');
    host.innerHTML = '';

    w.days.forEach(function (d) {
      var el = document.createElement('div');
      el.className = 'wday';
      if (d.full) el.classList.add('full');
      else if (d.done > 0) el.classList.add('partial');
      if (d.future) el.classList.add('future');
      if (d.isToday) el.classList.add('today');
      var mark = d.full ? '★' : (d.done > 0 ? '·' : '');
      el.innerHTML = '<span class="wday-name">' + WEEKDAY[d.date.getDay()] + '</span>' +
        '<span class="wday-mark">' + mark + '</span>';
      el.title = (d.date.getMonth() + 1) + '월 ' + d.date.getDate() + '일 · ' + d.done + '/3 완료';
      host.appendChild(el);
    });

    var badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'wday trophy';
    if (w.complete) badge.classList.add('done');
    badge.innerHTML = '<span class="wday-name">완주</span><span class="wday-mark">🏆</span>';
    badge.setAttribute('aria-label', '일주일 완주 배지');
    badge.addEventListener('click', function () {
      if (w.complete) { showCheer(false); return; }
      toast('월~금 5일을 모두 하면 완주 배지가 생겨! ' + w.fullDays + '/5일 했어');
    });
    host.appendChild(badge);

    var cap = $('#week-caption');
    if (w.complete) {
      cap.innerHTML = '월~금 모두 완료! <b>일주일 완주 🎉</b>';
    } else {
      cap.innerHTML = '이번 주 <b>' + w.fullDays + '/5일</b> 완료 · 금요일까지 다 하면 완주 배지!';
    }
  }

  /* ---------------- 날씨 ---------------- */
  function readWeatherCache() {
    try {
      var raw = localStorage.getItem(W_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || (!obj.forecast && !obj.air)) return null;
      return obj;
    } catch (e) { return null; }
  }

  function fetchForecast() {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + LAT + '&longitude=' + LON +
      '&current=temperature_2m,weather_code' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&hourly=temperature_2m&timezone=Asia%2FSeoul&forecast_days=7';
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('weather ' + res.status);
      return res.json();
    });
  }

  function fetchAir() {
    var url = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + LAT + '&longitude=' + LON +
      '&current=pm10,pm2_5&timezone=Asia%2FSeoul';
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('air ' + res.status);
      return res.json();
    });
  }

  function weatherIcon(code) {
    if (code === 0) return '☀️';
    if (code <= 2) return '🌤️';
    if (code === 3) return '☁️';
    if (code === 45 || code === 48) return '🌫️';
    if (code >= 51 && code <= 57) return '🌦️';
    if (code >= 61 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '❄️';
    if (code >= 80 && code <= 82) return '🌧️';
    if (code >= 85 && code <= 86) return '🌨️';
    if (code >= 95) return '⛈️';
    return '🌤️';
  }

  function morningTemp(f) {
    try {
      var idx = f.hourly.time.indexOf(todayKey() + 'T08:00');
      if (idx >= 0) return Math.round(f.hourly.temperature_2m[idx]);
    } catch (e) { }
    if (f.current && typeof f.current.temperature_2m === 'number') return Math.round(f.current.temperature_2m);
    return Math.round(f.daily.temperature_2m_min[0]);
  }

  function airGrade(air) {
    if (!air || !air.current) return null;
    var pm10 = air.current.pm10;
    var pm25 = air.current.pm2_5;
    function g10(v) { return v <= 30 ? 0 : v <= 80 ? 1 : v <= 150 ? 2 : 3; }
    function g25(v) { return v <= 15 ? 0 : v <= 35 ? 1 : v <= 75 ? 2 : 3; }
    var a = typeof pm10 === 'number' ? g10(pm10) : -1;
    var b = typeof pm25 === 'number' ? g25(pm25) : -1;
    var level = Math.max(a, b);
    if (level < 0) return null;
    var names = ['좋음', '보통', '나쁨', '매우나쁨'];
    var classes = ['good', 'normal', 'bad', 'worst'];
    return {
      level: level,
      label: names[level],
      cls: classes[level],
      part: b > a ? '초미세먼지' : '미세먼지'
    };
  }

  function tipText(f, air) {
    var t = morningTemp(f);
    var core;
    if (t <= -5) core = '나갈 때 아침 ' + t + '° 많이 추워요 — 패딩에 목도리까지';
    else if (t <= 3) core = '나갈 때 아침 ' + t + '° 추워요 — 두꺼운 겉옷';
    else if (t <= 9) core = '나갈 때 아침 ' + t + '° 쌀쌀해요 — 겉옷 하나';
    else if (t <= 15) core = '나갈 때 아침 ' + t + '° 선선해요 — 얇은 겉옷';
    else if (t <= 22) core = '나갈 때 아침 ' + t + '° 포근해요 — 가벼운 옷';
    else core = '나갈 때 아침 ' + t + '° 더워요 — 시원한 옷';

    var extras = [];
    var pop = 0;
    try { pop = f.daily.precipitation_probability_max[0] || 0; } catch (e) { }
    if (pop >= 50) extras.push('☔ 우산');
    var g = airGrade(air);
    if (g && g.level >= 2) extras.push('😷 마스크');
    return extras.length ? core + ' · ' + extras.join(' · ') : core;
  }

  function renderWeather(data) {
    var f = data && data.forecast;
    var air = data && data.air;

    var dustEl = $('#dust');
    var g = airGrade(air);
    if (g) {
      dustEl.dataset.grade = g.cls;
      dustEl.querySelector('span').innerHTML = g.part + ' <b>' + g.label + '</b>';
    } else {
      dustEl.dataset.grade = '';
      dustEl.querySelector('span').innerHTML = '미세먼지 <b>—</b>';
    }

    var strip = $('#week-strip');
    strip.innerHTML = '';
    if (f && f.daily && f.daily.time) {
      var today = new Date();
      for (var i = 0; i < Math.min(7, f.daily.time.length); i++) {
        var d = addDays(today, i);
        var cell = document.createElement('div');
        cell.className = 'wc' + (i === 0 ? ' today' : '');
        var head = i === 0 ? '오늘' : WEEKDAY[d.getDay()];
        var dateStr = (d.getMonth() + 1) + '/' + d.getDate();
        var max = Math.round(f.daily.temperature_2m_max[i]);
        var min = Math.round(f.daily.temperature_2m_min[i]);
        cell.innerHTML =
          '<span class="wc-day">' + head + ' ' + dateStr + '</span>' +
          '<span class="wc-icon">' + weatherIcon(f.daily.weather_code[i]) + '</span>' +
          '<span class="wc-temp">' + max + '°<i> ' + min + '°</i></span>';
        strip.appendChild(cell);
      }
      $('#tip').textContent = tipText(f, air);
    } else {
      $('#tip').textContent = '날씨를 못 불러왔어요. 잠시 뒤 다시 볼게요.';
    }
  }

  function loadWeather() {
    var cached = readWeatherCache();
    if (cached) renderWeather(cached);

    var forecast = null;
    var air = null;

    fetchForecast().then(function (j) { forecast = j; }).catch(function () { })
      .then(function () { return fetchAir().then(function (j) { air = j; }).catch(function () { }); })
      .then(function () {
        if (!forecast && !air) {
          if (!cached) renderWeather(null);
          return;
        }
        var data = {
          forecast: forecast || (cached && cached.forecast) || null,
          air: air || (cached && cached.air) || null,
          at: Date.now()
        };
        try { localStorage.setItem(W_KEY, JSON.stringify(data)); } catch (e) { }
        renderWeather(data);
      });
  }

  /* ---------------- 토스트 ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2200);
  }

  /* ---------------- 일주일 완주 축하 ---------------- */
  var cheerMarkedWeek = null;

  function confetti(host, count) {
    var colors = ['#f6c453', '#f2a3b8', '#7fd0a0', '#7fb2ea', '#c9a7ea', '#ffd9a0'];
    for (var i = 0; i < count; i++) {
      (function (i) {
        var c = document.createElement('span');
        c.className = 'confetti';
        c.style.left = (6 + Math.random() * 88) + '%';
        c.style.background = colors[i % colors.length];
        c.style.animationDelay = (Math.random() * 0.9) + 's';
        c.style.animationDuration = (3.2 + Math.random() * 1.8) + 's';
        c.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');
        c.style.width = (6 + Math.random() * 6) + 'px';
        c.style.height = (8 + Math.random() * 8) + 'px';
        host.appendChild(c);
      })(i);
    }
  }

  function clearConfetti() {
    var old = document.querySelectorAll('.cheer .confetti');
    for (var i = 0; i < old.length; i++) old[i].remove();
  }

  function showCheer(preview) {
    var overlay = $('#cheer-overlay');
    overlay.hidden = false;
    clearConfetti();
    $('#cheer-kicker').textContent = preview ? '부모님 미리보기' : '월요일부터 금요일까지';
    $('#cheer-sub').innerHTML = preview
      ? '시은이가 일주일을 완주하면<br>이렇게 축하해 줄게요!'
      : '5일 내내 양치·세수·옷 갈아입기를<br>모두 해냈어. 정말 대단해!';
    confetti($('.cheer'), 30);
    sfxFanfare();
    if (!preview) {
      var w = weekInfo();
      cheerMarkedWeek = w.weekKey;
      if (w.complete && !state.celebrate[w.weekKey]) {
        state.celebrate[w.weekKey] = Date.now();
        saveLocal();
        schedulePush();
      }
      renderWeek();
    }
  }

  function closeCheer() {
    $('#cheer-overlay').hidden = true;
    clearConfetti();
  }

  function maybeShowCheer() {
    var w = weekInfo();
    if (!w.complete || w.celebrated) return false;
    if (cheerMarkedWeek === w.weekKey) return false;
    showCheer(false);
    return true;
  }

  /* ---------------- 설정 ---------------- */
  function openSettings() {
    $('#dep-input').value = state.departure;
    var t = $('#mute-toggle');
    t.setAttribute('aria-pressed', state.muted ? 'false' : 'true');
    t.textContent = state.muted ? '꺼짐 🔇' : '켜짐 🔊';
    setSyncNote();
    $('#settings-overlay').hidden = false;
  }

  function closeSettings() { $('#settings-overlay').hidden = true; }

  function applyMuteUI(muted) {
    var btn = $('#btn-sound');
    btn.textContent = muted ? '🔇' : '🔊';
    btn.dataset.muted = muted ? 'true' : 'false';
    var t = $('#mute-toggle');
    t.setAttribute('aria-pressed', muted ? 'false' : 'true');
    t.textContent = muted ? '꺼짐 🔇' : '켜짐 🔊';
  }

  function setMuted(muted) {
    state.muted = muted;
    saveLocal();
    schedulePush();
    applyMuteUI(muted);
  }

  function resetWeek() {
    var w = weekInfo();
    if (!window.confirm('이번 주(월~금) 퀘스트 기록과 완주 배지를 지울까요? 되돌릴 수 없어요.')) return;
    w.days.forEach(function (d) { delete state.days[d.key]; });
    delete state.celebrate[w.weekKey];
    saveLocal();
    schedulePush();
    renderAll();
    toast('이번 주 기록을 지웠어요');
  }

  /* ---------------- 렌더 ---------------- */
  var lastDayKey = '';

  function renderAll() {
    renderDate();
    renderDeparture();
    renderTimeLeft();
    updateQuests(null);
    renderGauge();
    renderWeek();
    lastDayKey = todayKey();
  }

  /* ---------------- 이벤트 ---------------- */
  function bindEvents() {
    $('#cheer-ok').addEventListener('click', closeCheer);
    $('#cheer-overlay').addEventListener('click', function (e) {
      if (e.target === this) closeCheer();
    });

    $('#settings-close').addEventListener('click', closeSettings);
    $('#settings-overlay').addEventListener('click', function (e) {
      if (e.target === this) closeSettings();
    });


    $('#dep-input').addEventListener('change', function () {
      var v = this.value;
      if (!/^\d{2}:\d{2}$/.test(v)) return;
      state.departure = v;
      saveLocal();
      schedulePush();
      renderDeparture();
      renderTimeLeft();
      toast('출발 시각을 ' + formatDeparture(v) + '(으)로 바꿨어요');
    });

    $('#mute-toggle').addEventListener('click', function () { setMuted(!state.muted); });

    $('#btn-settings').addEventListener('click', openSettings);

    $('#btn-sound').addEventListener('click', function () {
      setMuted(!state.muted);
      if (!state.muted) sfxChime();
    });

    $('#cheer-preview-btn').addEventListener('click', function () {
      closeSettings();
      showCheer(true);
    });

    $('#reset-week').addEventListener('click', resetWeek);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#cheer-overlay').hidden) closeCheer();
      else if (!$('#settings-overlay').hidden) closeSettings();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        renderTimeLeft();
        fbPull();
        if (lastDayKey !== todayKey()) { renderAll(); maybeShowCheer(); }
      }
    });
  }

  /* ---------------- 시작 ---------------- */
  function init() {
    buildQuests();
    bindEvents();
    applyMuteUI(state.muted);
    renderAll();
    tickClock();
    loadWeather();

    setInterval(function () {
      tickClock();
      renderTimeLeft();
      if (lastDayKey !== todayKey()) { renderAll(); maybeShowCheer(); }
    }, 1000);

    setInterval(function () {
      if (document.visibilityState === 'visible') fbPull();
    }, POLL_MS);

    setInterval(loadWeather, 30 * 60 * 1000);

    // 처음 한 번: 서버 상태가 더 새로우면 받아오고, 아니면 올린다
    fbPullRaw().then(function (remote) {
      syncOk = true;
      setSyncNote();
      if (remote && typeof remote === 'object' && typeof remote.updatedAt === 'number') {
        if ((remote.updatedAt || 0) > (state.updatedAt || 0)) {
          state = normalize(remote);
          saveLocal(false);
          renderAll();
          return;
        }
      }
      if (state.updatedAt > 0) pushNow();
    }).catch(function () {
      syncOk = false;
      setSyncNote();
    });

    setTimeout(function () { maybeShowCheer(); }, 1400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
