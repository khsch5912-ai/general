'use strict';

/* ==========================================================
   Медиатека Khanbaliya
   Маршруты (совместимы со старыми ссылками):
     #                         — все книги
     #book/N                   — части книги
     #book/N/lesson/M          — плеер + заметки
   ========================================================== */

const API_URL = "https://tgbot-ljmn.onrender.com";
const SKIP = 15;
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_STEPS = [0, 15, 30, 60, 'end'];
const COVERS = [
    ['#6B5B52', '#A89A8E'], // Основной коричневый
    ['#8C7C70', '#C4B6AA'], // Светлый тауп
    ['#574B42', '#8C7C70'], // Темный коричневый
    ['#7A6B5E', '#B8A89B'], // Теплый серо-коричневый
    ['#60534A', '#9E8F82'], // Землистый
    ['#8E7B6D', '#D4C8BE'], // Светлый бежевый
];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const audio = $('#audio');

/* ---------- Иконки ---------- */
const svg = (inner, extra = '') =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;
const ICONS = {
    play: svg('<polygon points="7 4 20 12 7 20 7 4" fill="currentColor"/>'),
    pause: svg('<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>'),
    prev: svg('<path d="M19 20 9 12l10-8z" fill="currentColor"/><line x1="5" y1="19" x2="5" y2="5"/>'),
    next: svg('<path d="m5 4 10 8-10 8z" fill="currentColor"/><line x1="19" y1="5" x2="19" y2="19"/>'),
    back15: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/><text x="12" y="15.5" font-size="8" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">15</text>'),
    fwd15: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><polyline points="21 3 21 8 16 8"/><text x="12" y="15.5" font-size="8" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">15</text>'),
    check: svg('<polyline points="20 6 9 17 4 12"/>'),
    moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
    'chevron-left': svg('<polyline points="15 18 9 12 15 6"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.6" y2="16.6"/>'),
    clock: svg('<circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 15 15"/>'),
    download: svg('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/>'),
    trash: svg('<polyline points="3 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V3h6v3"/>'),
};
$$('[data-icon]').forEach(el => { el.innerHTML = ICONS[el.dataset.icon] || ''; });

/* ---------- Утилиты ---------- */
const esc = v => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Функция для удаления звездочек из названий
const cleanText = str => String(str || '').replace(/\*\*/g, '');

const pad = n => String(n).padStart(2, '0');
const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();

function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
// формат таймкода в заметках — минуты без часов (как в старых заметках)
const fmtNote = sec => `${Math.floor(sec / 60)}:${pad(Math.floor(sec % 60))}`;
function parseNoteTime(str) {
    const p = str.split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let toastTimer;
function toast(msg, ms = 3500) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- Состояние ---------- */
const state = {
    books: [],
    view: 'home',
    route: { b: null, l: null },
    current: null,              // {b, l} — загруженный в плеер урок
    autoplayOnLoad: false,
    ready: false,               // метаданные загружены, позиция восстановлена
    pendingSeek: null,
    speed: parseFloat(store.get('speed', '1')) || 1,
    autonext: store.get('autonext', '1') === '1',
    sleep: { mode: 0, timer: null },
    query: '',
    lessonQuery: '',
};

const curLesson = () => state.current ? state.books[state.current.b].lessons[state.current.l] : null;
const curBook = () => state.current ? state.books[state.current.b] : null;

/* ---------- Загрузка данных ---------- */
function resolveAudio(l) {
    let url = l.audio_url || l.audioUrl || l.url || l.audio || '';
    if (url && !/^https?:\/\//i.test(url)) url = `${API_URL}/${url.replace(/^\//, '')}`;
    return url;
}

function normalize(json) {
    return Object.entries(json.books || {}).map(([title, data], b) => ({
        index: b,
        // Очищаем название книги от звездочек
        title: cleanText(title),
        // Очищаем автора от звездочек
        author: cleanText(data.author),
        lessons: (data.lessons || []).slice().sort((x, y) => x.part - y.part).map((l, i) => ({
            id: l.id, part: l.part, 
            // Очищаем название урока от звездочек
            title: cleanText(l.title), 
            index: i, audio: resolveAudio(l),
        })),
    }));
}

async function loadData() {
    $('#boot').hidden = false;
    $('#boot-spinner').hidden = false;
    $('#boot-retry').hidden = true;
    $('#boot-text').textContent = 'Загружаем уроки…';
    ['home', 'book', 'lesson'].forEach(v => { $(`#view-${v}`).hidden = true; });

    const ctrl = new AbortController();
    // бесплатный хостинг «засыпает» — первый ответ может идти около минуты
    const slow = setTimeout(() => { $('#boot-text').textContent = 'Сервер просыпается, это может занять до минуты…'; }, 4000);
    const kill = setTimeout(() => ctrl.abort(), 70000);
    try {
        const res = await fetch(`${API_URL}/api/lessons.json`, { signal: ctrl.signal, mode: 'cors' });
        if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
        state.books = normalize(await res.json());
    } catch (err) {
        $('#boot-spinner').hidden = true;
        $('#boot-text').textContent = (err.name === 'AbortError' ? 'Сервер не ответил вовремя' : `Ошибка загрузки: ${err.message}`) + '. Попробуйте ещё раз или включите VPN.';
        $('#boot-retry').hidden = false;
        return;
    } finally {
        clearTimeout(slow); clearTimeout(kill);
    }
    $('#boot').hidden = true;
    route();
}
$('#boot-retry').onclick = loadData;

/* ---------- Прогресс (localStorage) ---------- */
function lessonStatus(id) {
    const done = store.get('done_' + id) === '1';
    const pos = parseFloat(store.get('pos_' + id)) || 0;
    const dur = parseFloat(store.get('dur_' + id)) || 0;
    return { done, pos, dur, pct: dur ? Math.min(100, pos / dur * 100) : 0 };
}
const markDone = id => store.set('done_' + id, '1');
function bookProgress(book) {
    const done = book.lessons.filter(l => store.get('done_' + l.id) === '1').length;
    return { done, total: book.lessons.length, pct: book.lessons.length ? done / book.lessons.length * 100 : 0 };
}
function readLast() {
    try { return JSON.parse(store.get('last') || 'null'); } catch { return null; }
}
const coverStyle = i => `--c1:${COVERS[i % COVERS.length][0]};--c2:${COVERS[i % COVERS.length][1]}`;
const coverIcon = '<img src="images/over_ear_headphones_falt_style.svg" alt="Аудио" class="cover-icon">';
const lessonUrl = (b, l) => `#book/${b}/lesson/${l}`;

/* ---------- Роутер ---------- */
function route() {
    if (!state.books.length && !$('#boot').hidden) return;
    const parts = location.hash.replace('#', '').split('/').filter(Boolean);
    let view = 'home', b = null, l = null;
    if (parts[0] === 'book' && /^\d+$/.test(parts[1] || '')) {
        b = +parts[1];
        if (!state.books[b]) { location.hash = ''; return; }
        if (parts[2] === 'lesson' && /^\d+$/.test(parts[3] || '')) {
            l = +parts[3];
            if (!state.books[b].lessons[l]) { location.replace(`#book/${b}`); return; }
            view = 'lesson';
        } else view = 'book';
    }
    window.scrollTo(0, 0);
    if (view !== 'book' || state.route.b !== b) state.lessonQuery = '';
    state.view = view;
    state.route = { b, l };

    if (view === 'lesson') {
        const same = state.current && state.current.b === b && state.current.l === l;
        if (!same) loadLesson(b, l);
        if (state.autoplayOnLoad) play();
    }
    state.autoplayOnLoad = false;
    renderView();
}

function renderView() {
    $('#boot').hidden = true;
    document.body.dataset.view = state.view;
    ['home', 'book', 'lesson'].forEach(v => { $(`#view-${v}`).hidden = v !== state.view; });
    $('#foot').hidden = state.view === 'lesson';
    if (state.view === 'home') renderHome();
    else if (state.view === 'book') renderBook();
    else renderLesson();
    updateMini();
    document.title = state.view === 'lesson' && curLesson()
        ? `${curLesson().title} — Медиатека`
        : 'Медиатека — Khanbaliya';
}
window.addEventListener('hashchange', route);

// Нажатие на карточку урока / «Продолжить» сразу запускает воспроизведение
document.addEventListener('click', e => {
    if (e.target.closest('[data-play]')) state.autoplayOnLoad = true;
});

/* ---------- Главная ---------- */
function bookCard(book) {
    const p = bookProgress(book);
    return `<a class="book-card" href="#book/${book.index}">
        <div class="cover" style="${coverStyle(book.index)}">${coverIcon}</div>
        <div class="book-info">
            <h3>${esc(book.title)}</h3>
            <div class="author">${esc(book.author)}</div>
            <div class="book-meta">${p.total} ${plural(p.total, 'часть', 'части', 'частей')}${p.done ? ` · прослушано ${p.done}` : ''}</div>
            ${p.done ? `<div class="progress"><i style="width:${p.pct}%"></i></div>` : ''}
        </div>
    </a>`;
}
const plural = (n, a, b, c) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c);
};

function renderContinue() {
    const box = $('#continue');
    const last = readLast();
    const book = last && state.books[last.b];
    const lesson = book && book.lessons[last.l];
    if (!lesson || lesson.id !== last.id) { box.innerHTML = ''; return; }
    const st = lessonStatus(lesson.id);
    box.innerHTML = `<a class="continue" href="${lessonUrl(last.b, last.l)}" data-play>
        <div class="cover cover--sm" style="${coverStyle(last.b)}">${coverIcon}</div>
        <div class="continue-text">
            <div class="eyebrow">Продолжить слушать</div>
            <div class="continue-title">${esc(lesson.title)}</div>
            <div class="muted">${esc(book.title)}${st.pos > 5 && !st.done ? ` · с ${fmt(st.pos)}` : ''}</div>
        </div>
        <span class="playdot">${ICONS.play}</span>
    </a>`;
}

function renderHome() {
    renderContinue();
    const q = norm(state.query);
    const books = state.books.filter(b => !q || norm(b.title).includes(q) || norm(b.author).includes(q));
    const hits = q ? state.books.flatMap(b => b.lessons.filter(l => norm(l.title).includes(q)).map(l => ({ b, l }))).slice(0, 30) : [];
    $('#books').innerHTML = books.map(bookCard).join('');
    $('#hits').innerHTML = hits.length
        ? `<h2 class="sec-title">Найдено в частях</h2><div class="list">${hits.map(({ b, l }) => lessonRow(b, l, isActive(b.index, l.index), true)).join('')}</div>`
        : (q && !books.length ? '<p class="empty">Ничего не найдено</p>' : (!q && !books.length ? '<p class="empty">Пока нет книг.</p>' : ''));
}
$('#search').addEventListener('input', e => {
    state.query = e.target.value;
    renderHome();
});

/* ---------- Книга ---------- */
const isActive = (b, l) => !!state.current && state.current.b === b && state.current.l === l;

function lessonRow(book, lesson, active, showBook = false) {
    const st = lessonStatus(lesson.id);
    const badge = active ? '<span class="eq"><i></i><i></i><i></i></span>' : (st.done ? ICONS.check : esc(lesson.part));
    const meta = [showBook ? esc(book.title) : '', st.done ? 'Прослушано' : (st.pos > 5 ? `${fmt(st.pos)}${st.dur ? ' из ' + fmt(st.dur) : ''}` : '')].filter(Boolean).join(' · ');
    return `<a class="lesson${active ? ' active' : ''}${st.done ? ' done' : ''}" href="${lessonUrl(book.index, lesson.index)}" data-play>
        <span class="num">${badge}</span>
        <span class="ltext"><span class="ltitle">${esc(lesson.title)}</span>${meta ? `<span class="lmeta">${meta}</span>` : ''}</span>
        ${!st.done && st.pct > 1 ? `<span class="lbar"><i style="width:${st.pct}%"></i></span>` : ''}
    </a>`;
}

function nextToListen(book) {
    const last = readLast();
    if (last && last.b === book.index && book.lessons[last.l] && book.lessons[last.l].id === last.id) {
        const st = lessonStatus(last.id);
        if (!st.done) return { lesson: book.lessons[last.l], started: true };
        if (book.lessons[last.l + 1]) return { lesson: book.lessons[last.l + 1], started: false };
    }
    const first = book.lessons.find(l => store.get('done_' + l.id) !== '1');
    if (first) return { lesson: first, started: lessonStatus(first.id).pos > 5 || first.index > 0 };
    return { lesson: book.lessons[0], started: false, again: true };
}

function renderBook() {
    const book = state.books[state.route.b];
    const p = bookProgress(book);
    const next = book.lessons.length ? nextToListen(book) : null;
    const label = !next ? '' : next.again ? 'Слушать сначала' : (next.started ? `Продолжить · часть ${esc(next.lesson.part)}` : 'Начать слушать');
    $('#book-head').innerHTML = `
        <div class="cover" style="${coverStyle(book.index)}">${coverIcon}</div>
        <div>
            <h1>${esc(book.title)}</h1>
            <div class="author">${esc(book.author)}</div>
            <div class="stat">${p.total} ${plural(p.total, 'часть', 'части', 'частей')} · прослушано ${p.done}</div>
            <div class="progress"><i style="width:${p.pct}%"></i></div>
            ${next ? `<a class="btn" href="${lessonUrl(book.index, next.lesson.index)}" data-play>${ICONS.play.replace('<svg', '<svg width="18" height="18"')} ${label}</a>` : ''}
        </div>`;
    const showSearch = book.lessons.length > 12;
    $('#book-search-wrap').hidden = !showSearch;
    if (!showSearch) state.lessonQuery = '';
    const q = norm(state.lessonQuery);
    const lessons = book.lessons.filter(l => !q || norm(l.title).includes(q) || String(l.part) === q);
    $('#book-lessons').innerHTML = lessons.length
        ? lessons.map(l => lessonRow(book, l, isActive(book.index, l.index))).join('')
        : `<p class="empty">${q ? 'Ничего не найдено' : 'В этой книге пока нет уроков.'}</p>`;
}
$('#book-search').addEventListener('input', e => { state.lessonQuery = e.target.value; renderBook(); });

/* ---------- Урок: отрисовка ---------- */
function renderLesson() {
    const book = state.books[state.route.b];
    const lesson = book.lessons[state.route.l];
    $('#lesson-back').href = `#book/${book.index}`;
    $('#lesson-back-text').textContent = book.title;
    const cover = $('#lp-cover');
    cover.style.cssText = coverStyle(book.index);
    $('#lp-letter').innerHTML = coverIcon;
    $('#lp-eyebrow').textContent = `Часть ${lesson.part} из ${book.lessons.length}`;
    $('#lp-title').textContent = lesson.title;
    $('#lp-book').textContent = book.title;
    $('#btn-next').disabled = state.route.l >= book.lessons.length - 1;
    $('#btn-play').disabled = $('#btn-back').disabled = $('#btn-fwd').disabled = !lesson.audio;
    $('#side-lessons').innerHTML = book.lessons.map(l => lessonRow(book, l, isActive(book.index, l.index))).join('');
    $('#btn-speed').textContent = `${state.speed}×`;
    $('#btn-auto').setAttribute('aria-pressed', String(state.autonext));
    updateSleepLabel();
    loadNote();
    updatePlayState();
    updateTime();
}

/* ---------- Плеер ---------- */
function loadLesson(b, l) {
    savePos();
    flushNote();
    const lesson = state.books[b].lessons[l];
    state.current = { b, l };
    state.ready = false;
    audio.pause();
    const st = lessonStatus(lesson.id);
    // если урок дослушан — начинаем сначала, иначе продолжаем с сохранённого места
    state.pendingSeek = !st.done && st.pos > 2 ? st.pos : null;
    if (lesson.audio) {
        audio.src = lesson.audio;
        audio.load();
        audio.defaultPlaybackRate = audio.playbackRate = state.speed; // load() сбрасывает скорость
    } else {
        audio.removeAttribute('src');
        audio.load();
        state.ready = true;
        toast('Аудио для этого урока ещё не загружено');
    }
    updateMediaSession();
    updateMini();
}

function play() {
    if (!curLesson() || !curLesson().audio) return;
    const p = audio.play();
    if (p && p.catch) p.catch(err => {
        if (err.name === 'NotAllowedError') toast('Нажмите ▶, чтобы начать воспроизведение');
        else if (err.name !== 'AbortError') toast('Не удалось воспроизвести аудио');
    });
}
const togglePlay = () => (audio.paused ? play() : audio.pause());

function advance(delta) {
    const c = state.current;
    if (!c) return;
    const n = c.l + delta;
    const lessons = state.books[c.b].lessons;
    if (n < 0 || n >= lessons.length) return;
    if (state.view === 'lesson') {
        state.autoplayOnLoad = true;
        location.hash = lessonUrl(c.b, n).slice(1);
    } else {
        loadLesson(c.b, n);
        play();
        renderView();
    }
}
function previous() {
    if (audio.currentTime > 5) audio.currentTime = 0;
    else advance(-1);
}
const seekBy = d => { if (audio.duration) audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + d)); };

function savePos() {
    const lesson = curLesson();
    if (!lesson || !state.ready || !audio.duration) return;
    store.set('pos_' + lesson.id, audio.currentTime.toFixed(1));
    if (audio.currentTime / audio.duration > 0.97) markDone(lesson.id);
}

let lastSave = 0, dragging = false;
function updateTime() {
    const d = audio.duration || 0, t = audio.currentTime || 0;
    const seek = $('#seek');
    seek.max = d || 0;
    if (!dragging) {
        seek.value = t;
        $('#t-cur').textContent = fmt(t);
    }
    $('#t-dur').textContent = fmt(d);
    seek.style.setProperty('--pct', d ? `${t / d * 100}%` : '0%');
    seek.disabled = !d;
    $('#mini-bar').style.width = d ? `${t / d * 100}%` : '0';
}
function updatePlayState() {
    const playing = !audio.paused && !audio.ended;
    document.body.classList.toggle('is-playing', playing);
    const label = playing ? 'Пауза' : 'Играть';
    $('#btn-play').setAttribute('aria-label', label);
    $('#mini-play').setAttribute('aria-label', label);
}

audio.addEventListener('loadedmetadata', () => {
    const lesson = curLesson();
    if (lesson) store.set('dur_' + lesson.id, audio.duration.toFixed(1));
    if (state.pendingSeek != null && state.pendingSeek < audio.duration - 3) audio.currentTime = state.pendingSeek;
    state.pendingSeek = null;
    state.ready = true;
    updateTime();
});
audio.addEventListener('loadstart', () => { $('#seek').value = 0; $('#t-cur').textContent = '0:00'; updateTime(); });
audio.addEventListener('durationchange', updateTime);
audio.addEventListener('timeupdate', () => {
    updateTime();
    const now = Date.now();
    if (now - lastSave > 3000) { lastSave = now; savePos(); }
});
audio.addEventListener('play', () => {
    const c = state.current, lesson = curLesson();
    if (lesson) store.set('last', JSON.stringify({ b: c.b, l: c.l, id: lesson.id }));
    updatePlayState();
});
audio.addEventListener('pause', () => { savePos(); updatePlayState(); refreshLists(); });
audio.addEventListener('ended', () => {
    const lesson = curLesson();
    if (lesson) { markDone(lesson.id); store.set('pos_' + lesson.id, '0'); }
    updatePlayState();
    if (state.sleep.mode === 'end') { setSleep(0); toast('Таймер сна: воспроизведение остановлено'); refreshLists(); return; }
    if (state.autonext && state.current && state.current.l < curBook().lessons.length - 1) advance(1);
    else refreshLists();
});
audio.addEventListener('error', () => {
    if (audio.getAttribute('src')) toast('Не удалось загрузить аудио. Попробуйте VPN или повторите позже.', 6000);
});

// Обновить списки (значки «прослушано», проценты) без полной перерисовки страницы
function refreshLists() {
    if (state.view === 'book') renderBook();
    else if (state.view === 'lesson') $('#side-lessons').innerHTML = state.books[state.route.b].lessons
        .map(l => lessonRow(state.books[state.route.b], l, isActive(state.route.b, l.index))).join('');
}

/* ---------- Управление плеером ---------- */
$('#btn-play').onclick = togglePlay;
$('#mini-play').onclick = e => { e.stopPropagation(); togglePlay(); };
$('#btn-back').onclick = () => seekBy(-SKIP);
$('#btn-fwd').onclick = () => seekBy(SKIP);
$('#btn-next').onclick = () => advance(1);
$('#btn-prev').onclick = previous;

const seekEl = $('#seek');
seekEl.addEventListener('input', () => {
    dragging = true;
    $('#t-cur').textContent = fmt(seekEl.value);
    seekEl.style.setProperty('--pct', audio.duration ? `${seekEl.value / audio.duration * 100}%` : '0%');
});
seekEl.addEventListener('change', () => { audio.currentTime = +seekEl.value; dragging = false; });

$('#btn-speed').onclick = () => {
    const i = SPEEDS.indexOf(state.speed);
    state.speed = SPEEDS[(i + 1) % SPEEDS.length];
    audio.defaultPlaybackRate = audio.playbackRate = state.speed;
    store.set('speed', String(state.speed));
    $('#btn-speed').textContent = `${state.speed}×`;
};
$('#btn-auto').onclick = () => {
    state.autonext = !state.autonext;
    store.set('autonext', state.autonext ? '1' : '0');
    $('#btn-auto').setAttribute('aria-pressed', String(state.autonext));
};

function setSleep(mode) {
    clearTimeout(state.sleep.timer);
    state.sleep = { mode, timer: null };
    if (typeof mode === 'number' && mode > 0) {
        state.sleep.timer = setTimeout(() => {
            audio.pause();
            setSleep(0);
            toast('Таймер сна: воспроизведение остановлено');
        }, mode * 60000);
    }
    updateSleepLabel();
}
function updateSleepLabel() {
    const m = state.sleep.mode;
    $('#sleep-label').textContent = m === 0 ? 'Таймер сна' : (m === 'end' ? 'До конца части' : `${m} мин`);
    $('#btn-sleep').setAttribute('aria-pressed', String(m !== 0));
}
$('#btn-sleep').onclick = () => setSleep(SLEEP_STEPS[(SLEEP_STEPS.indexOf(state.sleep.mode) + 1) % SLEEP_STEPS.length]);

/* ---------- Мини-плеер ---------- */
function updateMini() {
    const show = !!state.current && state.view !== 'lesson';
    $('#mini').hidden = !show;
    document.body.classList.toggle('has-mini', show);
    if (!show) return;
    const book = curBook(), lesson = curLesson();
    $('#mini-cover').style.cssText = coverStyle(book.index);
    $('#mini-letter').innerHTML = coverIcon;
    $('#mini-title').textContent = lesson.title;
    $('#mini-book').textContent = book.title;
}
const openMini = () => { if (state.current) location.hash = lessonUrl(state.current.b, state.current.l).slice(1); };
$('#mini-open').addEventListener('click', openMini);
$('#mini-open').addEventListener('keydown', e => { if ((e.key === 'Enter') && e.target === e.currentTarget) openMini(); });

/* ---------- Системные кнопки (экран блокировки, наушники) ---------- */
function updateMediaSession() {
    if (!('mediaSession' in navigator) || !curLesson()) return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: `Часть ${curLesson().part}: ${curLesson().title}`,
            artist: curBook().author, album: curBook().title,
        });
    } catch { /* не поддерживается */ }
}
if ('mediaSession' in navigator) {
    const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* ignore */ } };
    set('play', play);
    set('pause', () => audio.pause());
    set('seekbackward', () => seekBy(-SKIP));
    set('seekforward', () => seekBy(SKIP));
    set('previoustrack', previous);
    set('nexttrack', () => advance(1));
    set('seekto', d => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
}

/* ---------- Горячие клавиши ---------- */
document.addEventListener('keydown', e => {
    if (!state.current || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag)) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowLeft') seekBy(-SKIP);
    else if (e.code === 'ArrowRight') seekBy(SKIP);
});
window.addEventListener('pagehide', () => { savePos(); flushNote(); });

/* ---------- Заметки ---------- */
const noteEl = $('#note-text');
let noteId = null, noteTimer = null;

function noteStatus(t) { $('#note-status').textContent = t; }
function renderPreview() {
    const text = noteEl.value;
    $('#note-preview-wrap').hidden = !text.trim();
    let html = esc(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/\[(\d+:\d{2}(?::\d{2})?)\]/g, (m, t) => `<button type="button" class="tc" data-t="${parseNoteTime(t)}">${m}</button>`);
    $('#note-preview').innerHTML = html;
}
function saveNote() {
    clearTimeout(noteTimer); noteTimer = null;
    if (noteId == null) return;
    const v = noteEl.value;
    if (v.trim()) store.set('note_' + noteId, v); else store.del('note_' + noteId);
    noteStatus('Сохранено');
    renderPreview();
}
function flushNote() { if (noteTimer) saveNote(); }
function loadNote() {
    const lesson = state.books[state.route.b].lessons[state.route.l];
    if (noteId === lesson.id && document.activeElement === noteEl) return;
    flushNote();
    noteId = lesson.id;
    noteEl.value = store.get('note_' + noteId, '');
    noteStatus('');
    renderPreview();
    const sel = $('#font-select');
    sel.value = store.get('notefont', '') ;
    if (!sel.value) sel.selectedIndex = 0;
    noteEl.style.fontFamily = $('#note-preview').style.fontFamily = sel.value;
}
noteEl.addEventListener('input', () => {
    noteStatus('Сохранение…');
    clearTimeout(noteTimer);
    noteTimer = setTimeout(saveNote, 500);
});
function wrapText(open, close) {
    const s = noteEl.selectionStart, e = noteEl.selectionEnd;
    noteEl.value = noteEl.value.slice(0, s) + open + noteEl.value.slice(s, e) + close + noteEl.value.slice(e);
    noteEl.focus();
    noteEl.setSelectionRange(s + open.length, e + open.length);
    noteEl.dispatchEvent(new Event('input'));
}
$('#btn-bold').onclick = () => wrapText('**', '**');
$('#btn-italic').onclick = () => wrapText('*', '*');
$('#btn-time').onclick = () => {
    if (!audio.getAttribute('src')) return toast('Для этой части нет аудио');
    const ins = `[${fmtNote(audio.currentTime)}] `;
    const s = noteEl.selectionStart, e = noteEl.selectionEnd;
    noteEl.value = noteEl.value.slice(0, s) + ins + noteEl.value.slice(e);
    noteEl.focus();
    noteEl.selectionStart = noteEl.selectionEnd = s + ins.length;
    noteEl.dispatchEvent(new Event('input'));
};
$('#font-select').onchange = e => {
    store.set('notefont', e.target.value);
    noteEl.style.fontFamily = $('#note-preview').style.fontFamily = e.target.value;
};
$('#btn-export').onclick = () => {
    const text = noteEl.value;
    if (!text.trim()) return toast('Нет текста для экспорта');
    const book = state.books[state.route.b], lesson = book.lessons[state.route.l];
    const blob = new Blob([`Книга: ${book.title}\nЧасть ${lesson.part}: ${lesson.title}\n\n${text}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Заметка_${lesson.title.replace(/[^a-zа-яё0-9]/gi, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
};
$('#btn-clear').onclick = () => {
    if (!confirm('Удалить заметку?')) return;
    noteEl.value = '';
    saveNote();
    noteStatus('Удалено');
};
$('#note-preview').addEventListener('click', e => {
    const tc = e.target.closest('.tc');
    if (!tc || !audio.getAttribute('src')) return;
    audio.currentTime = +tc.dataset.t;
    play();
});

/* ---------- Вкладки справа ---------- */
$$('.tabs [role=tab]').forEach(tab => tab.addEventListener('click', () => {
    $$('.tabs [role=tab]').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    $$('.side .panel').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
}));

loadData();