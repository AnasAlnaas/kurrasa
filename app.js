/* =========================================================================
   Kurrasa — shared runtime
   Router, storage, settings, Arabic utilities, sound, report screen.
   Engines load lazily; nothing here knows what an exercise looks like.
   Visual decisions live in DIRECTION.md — read it before restyling.
   ========================================================================= */

import { icon, hasIcon } from './icons.js';

const STORE_KEY = 'kurrasa.v1';
const stage = document.getElementById('stage');
const live  = document.getElementById('live');

/* ---------- tiny DOM helper --------------------------------------------- */

export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/* ---------- Arabic utilities -------------------------------------------- */

const HARAKAT = /[ً-ْٰ]/g;
const TATWEEL = /ـ/g;
export const ZWJ = '‍';
const EASTERN = '٠١٢٣٤٥٦٧٨٩';

/** Eastern Arabic numerals — exercise numbers only, see DIRECTION.md. */
export const easternNum = (n) => String(n).replace(/\d/g, d => EASTERN[+d]);

export const ar = {
  stripTashkeel: (s) => String(s).replace(HARAKAT, ''),

  /** Fold spelling variance so a learner's answer still matches. */
  normalize(s, { taaMarbuta = false } = {}) {
    let out = String(s).normalize('NFC').replace(HARAKAT, '').replace(TATWEEL, '');
    out = out.replace(/[آأإٱ]/g, 'ا')
             .replace(/ى/g, 'ي')
             .replace(/ؤ/g, 'و')
             .replace(/ئ/g, 'ي');
    if (taaMarbuta) out = out.replace(/ة/g, 'ه');
    return out.replace(/\s+/g, ' ').trim();
  },

  /** Split into grapheme clusters so harakat stay attached to their letter. */
  letters(word) {
    const seg = new Intl.Segmenter('ar', { granularity: 'grapheme' });
    return [...seg.segment(String(word))].map(s => s.segment);
  },

  /* Force a connected glyph form on an isolated tile. Without the joiners the
     browser shapes the letter in isolation and letter-form games render wrong. */
  medial:  (ch) => ZWJ + ch + ZWJ,
  initial: (ch) => ch + ZWJ,
  final:   (ch) => ZWJ + ch,
};

/* ---------- storage & settings ------------------------------------------ */

const defaults = { translit: true, tashkeel: true, sound: true, ui: 'en', theme: 'auto' };

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return {
      settings: { ...defaults, ...(raw.settings || {}) },
      progress: raw.progress || {},
      // item id -> [wasRight, dayAnswered], per exercise:level. Replaces the
      // old `raw.seen` list, which recorded only that an item had been served.
      // Anyone carrying that older key simply starts with an empty history —
      // scores in `progress` are untouched, and the first round rebuilds it.
      items: raw.items || {},
    };
  } catch {
    return { settings: { ...defaults }, progress: {}, items: {} };
  }
}

const db = load();
export const settings = db.settings;

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch { /* private mode */ }
}

function best(id, level) { return db.progress[`${id}:${level}`]?.best ?? null; }

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- what the learner has already answered ------------------------
   The picker used to remember only WHICH items it handed out, keeping about
   half the pool and rolling over. That stopped a round repeating itself, but it
   knew nothing about how the learner did: a word answered correctly and a word
   fluffed came back on exactly the same schedule.

   It now records the OUTCOME per item, per exercise and level, and keeps it in
   localStorage like everything else. An item answered correctly rests; an item
   got wrong comes back soon.

   Correct is not retired forever, which was the first instinct and is worse
   teaching. A learner who answered كِتَاب correctly in March has very likely
   forgotten it by June, and permanent retirement guarantees they never meet it
   again. After RETIRE_DAYS it rejoins the pool. This is also what stops the
   shallow packs dead-ending: Sira has twelve questions at level 1 and serves
   ten a round, so "never again" would finish the exercise in four minutes.  */

const DAY_MS = 86400000;
const RETIRE_DAYS = 30;
/* Share of a round held back for items the learner got wrong. Without a
   reserve, a wrong answer only resurfaces once every fresh item is used up —
   thirteen rounds away in Build the Word — which is not review in any useful
   sense. Applied only from four items up: on a one-item draw like Word Search
   a 30% reserve rounds to the whole round, and the learner would be pinned to
   the board they just failed instead of being given a new one. */
const REVIEW_SHARE = 0.3;

const today = () => Math.floor(Date.now() / DAY_MS);

/** Record how each drawn item went. `results` is [{ id, ok }]. */
function recordItems(exerciseId, level, results) {
  if (!results?.length) return;
  const key = `${exerciseId}:${level}`;
  const log = (db.items[key] ||= {});
  const now = today();
  for (const { id, ok } of results) {
    if (id == null || id === '') continue;
    log[id] = [ok ? 1 : 0, now];      // compact on purpose; this is stored per item
  }
  save();
}

/**
 * Build the item-picker for one exercise and level.
 *
 * Shuffling alone is not enough. A round drawn as an independent random sample
 * repeats by arithmetic, not by accident: ten items out of ninety-five collide
 * about once per round, and where the pool is no bigger than the round — eight
 * synonym pairs, eight per board — every single board is identical.
 *
 * Four buckets, in priority order:
 *   fresh    never answered
 *   wrong    answered incorrectly — eligible immediately, oldest first
 *   due      answered correctly, but longer than RETIRE_DAYS ago
 *   resting  answered correctly and still inside the window
 *
 * A reserved slice of the round is filled from `wrong` first, the rest from
 * `fresh`, then the round falls through the remaining buckets in order. The
 * fall-through is what guarantees a round is never short: `resting` is the last
 * resort, so even a learner who has answered every item correctly this week
 * gets a full board rather than an empty screen.
 */
function makeDraw(exerciseId, level) {
  const key = `${exerciseId}:${level}`;
  return function draw(pool, n, idOf = (_x, i) => String(i)) {
    if (!pool?.length) return [];
    const take = Math.min(n, pool.length);
    const log = db.items[key] || {};
    const now = today();

    const fresh = [], wrong = [], due = [], resting = [];
    pool.forEach((item, i) => {
      const rec = log[idOf(item, i)];
      if (!rec) { fresh.push(i); return; }
      const [ok, when] = rec;
      if (!ok) wrong.push([i, when]);
      else if (now - when >= RETIRE_DAYS) due.push([i, when]);
      else resting.push([i, when]);
    });
    // Longest ago first, so review works back through what has been waiting.
    const byAge = (a) => a.sort((x, y) => x[1] - y[1]).map(x => x[0]);
    const wrongIdx = byAge(wrong), dueIdx = byAge(due), restingIdx = byAge(resting);

    const chosen = [];
    const seen = new Set();
    const fill = (list, limit = take) => {
      for (const i of list) {
        if (chosen.length >= limit || chosen.length >= take) return;
        if (seen.has(i)) continue;
        seen.add(i); chosen.push(i);
      }
    };

    const quota = take >= 4 ? Math.min(wrongIdx.length, Math.floor(take * REVIEW_SHARE)) : 0;
    fill(wrongIdx, quota);
    fill(shuffled(fresh));
    fill(wrongIdx);
    fill(dueIdx);
    fill(restingIdx);

    // Shuffle the round itself, or the review items would sit at the front of
    // every single board and the order would give away which ones they are.
    return shuffled(chosen).map(i => pool[i]);
  };
}

function recordResult(id, level, correct, total) {
  const key = `${id}:${level}`;
  const prev = db.progress[key] || { best: 0, plays: 0 };
  const isBest = correct > prev.best;
  db.progress[key] = {
    best: Math.max(prev.best, correct), outOf: total,
    plays: prev.plays + 1, last: Date.now(),
  };
  save();
  return isBest;
}

/* ---------- copy --------------------------------------------------------
   Written separately in each language, not translated across. English
   sentence rhythm does not survive the trip into Arabic.                   */

const STRINGS = {
  en: {
    // "Sound" sat next to "Sound-out" and read as the same setting. The audio
    // control is "Audio"; "Sound-out" keeps its name, which describes what it
    // does — sounding a word out in Latin letters.
    c_translit: 'Sound-out', c_tashkeel: 'Guides', c_sound: 'Audio',
    theme_auto: 'Auto', theme_light: 'Light', theme_dark: 'Dark',
    colophon: 'Nothing is sent anywhere. Your progress is stored on this device only.',
    feedback_lead: 'Found a mistake, or something missing?',
    feedback_link: 'Write to me',
    hub_title: 'Exercises',
    hub_lead: 'Short drills for people learning Arabic — ten questions a round. The numbering runs from letters through to meaning, but you can start anywhere.',
    contents: 'Contents',
    sec_ready: 'Ready to work', sec_soon: 'Coming soon',
    soon: 'Not written yet', unattempted: 'Not attempted', best: 'Best',
    back: '← Contents', start: 'Begin',
    lvl1: 'Starting out', lvl2: 'Getting on', lvl3: 'Confident',
    lvl1_ar: 'مُبْتَدِئ', lvl2_ar: 'مُتَوَسِّط', lvl3_ar: 'مُتَقَدِّم',
    q_of: '{a} of {b}', score: 'right', next: 'Next', finish: 'Finish',
    correct: 'Correct', incorrect: 'Incorrect', note: 'Note',
    as_clue: 'Build the Arabic for',
    report_title: 'Sheet finished', accuracy: 'Accuracy', time: 'Time',
    newbest: 'Your best yet', again: 'Another round',
    corrections: 'Corrections', answer: 'Answer', youchose: 'You chose',
    loading: 'Opening…', failure: 'This exercise would not open. Check your connection and try again.',
    soon_msg: 'This one is not written yet.',
    ws_find: 'Find these', ws_done: 'All found', ws_reveal: 'Give me one',
    as_which: 'Which letter belongs in the gap?',
    byline: 'These sheets are by Anas, who teaches Arabic. Lessons at',
    mt_join: 'Joined {a} of {b}',
    mt_opposite: 'Join each word to its opposite',
    mt_same: 'Join each word to one that means the same',
    mt_plural: 'Join each singular to its plural',
    as_confirm: 'Submit', as_undo: 'Tap a letter to take it back',
    as_check: 'Check the vowels', as_now_vowel: 'Letters correct — now add the vowel marks',
    as_tapmark: 'Tap a letter, then a mark',
    as_also: 'A word, but not this one',
    as_also_wanted: 'Asked for',
    as_bonus: 'Bonus word',
    as_bonus_keep: 'Now find the word you were asked for',
    also_tally: 'Also words', also_section: 'Words you made along the way',
  },
  ar: {
    c_translit: 'النَّقْحَرَة', c_tashkeel: 'الشَّكْل', c_sound: 'الصَّوْت',
    theme_auto: 'تِلْقَائِيّ', theme_light: 'فَاتِح', theme_dark: 'دَاكِن',
    colophon: 'لَا يُرْسَل شَيْء إِلَى أَيّ مَكَان. تَقَدُّمُك مَحْفُوظ عَلَى جِهَازِك وَحْدَه.',
    feedback_lead: 'وَجَدْتَ خَطَأً أَوْ نَقْصًا؟',
    feedback_link: 'اُكْتُبْ إِلَيَّ',
    hub_title: 'التَّمَارِين',
    hub_lead: 'تَمَارِين قَصِيرَة لِمَنْ يَتَعَلَّم العَرَبِيَّة، عَشَرَة أَسْئِلَة فِي الجَوْلَة. رُتِّبَتْ مِنْ الحَرْف إِلَى المَعْنَى، وَلَك أَنْ تَبْدَأ مِنْ حَيْثُ شِئْت.',
    contents: 'الفِهْرِس',
    sec_ready: 'جَاهِز لِلْعَمَل', sec_soon: 'قَرِيبًا',
    soon: 'لَمْ يُكْتَب بَعْد', unattempted: 'لَمْ تُجَرِّبْه', best: 'أَفْضَل',
    back: '→ الفِهْرِس', start: 'اِبْدَأ',
    lvl1: 'مُبْتَدِئ', lvl2: 'مُتَوَسِّط', lvl3: 'مُتَقَدِّم',
    lvl1_ar: 'مُبْتَدِئ', lvl2_ar: 'مُتَوَسِّط', lvl3_ar: 'مُتَقَدِّم',
    q_of: '{a} مِنْ {b}', score: 'صَحِيح', next: 'التَّالِي', finish: 'الخِتَام',
    correct: 'صَحِيح', incorrect: 'غَيْر صَحِيح', note: 'فَائِدَة',
    as_clue: 'كَوِّن بِالعَرَبِيَّة',
    report_title: 'اِنْتَهَتْ الوَرَقَة', accuracy: 'الدِّقَّة', time: 'الوَقْت',
    newbest: 'أَفْضَل مَا بَلَغْت', again: 'جَوْلَة أُخْرَى',
    corrections: 'التَّصْوِيبَات', answer: 'الصَّوَاب', youchose: 'اِخْتَرْت',
    loading: 'جَارٍ الفَتْح…', failure: 'لَمْ يُفْتَح التَّمْرِين. تَحَقَّق مِنْ الاتِّصَال ثُمَّ أَعِد المُحَاوَلَة.',
    soon_msg: 'هَذَا التَّمْرِين لَمْ يُكْتَب بَعْد.',
    ws_find: 'اِبْحَث عَنْ', ws_done: 'وَجَدْت الجَمِيع', ws_reveal: 'دُلَّنِي عَلَى وَاحِدَة',
    as_which: 'أَيّ حَرْف يَسُدّ الفَرَاغ؟',
    byline: 'أَعَدَّ هَذِهِ الأَوْرَاق أَنَس، وَهُوَ يُدَرِّس العَرَبِيَّة. الدُّرُوس فِي',
    mt_join: 'وَصَلْتَ {a} مِنْ {b}',
    mt_opposite: 'صِلْ كُلّ كَلِمَة بِضِدِّهَا',
    mt_same: 'صِلْ كُلّ كَلِمَة بِمُرَادِفِهَا',
    mt_plural: 'صِلْ كُلّ مُفْرَد بِجَمْعِه',
    as_confirm: 'سَلِّم', as_undo: 'اِلْمِس حَرْفًا لِتُرْجِعَه',
    as_check: 'رَاجِع الشَّكْل', as_now_vowel: 'الحُرُوف صَحِيحَة، وَبَقِيَ الشَّكْل',
    as_tapmark: 'اِلْمِس حَرْفًا ثُمَّ حَرَكَة',
    as_also: 'كَلِمَة عَرَبِيَّة، لَكِنَّهَا غَيْر المَطْلُوبَة',
    as_also_wanted: 'وَالمَطْلُوب',
    as_bonus: 'كَلِمَة إِضَافِيَّة',
    as_bonus_keep: 'وَالآن جِد الكَلِمَة المَطْلُوبَة',
    also_tally: 'كَلِمَات أُخْرَى', also_section: 'كَلِمَات كَوَّنْتَهَا فِي الطَّرِيق',
  },
};

export function t(key, vars) {
  let s = STRINGS[settings.ui]?.[key] ?? STRINGS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

export function tx(obj) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[settings.ui] ?? obj.en ?? obj.ar ?? '';
}

/**
 * Render an {ar, tr, en} item. The transliteration and gloss layers are
 * always emitted and hidden with CSS, so those toggles never re-render.
 */
export function arText(item, { size = '', baseline = false } = {}) {
  if (item == null) return el('span');
  if (typeof item === 'string' || !item.ar) return el('span', {}, tx(item));

  const arabic = settings.tashkeel ? item.ar : ar.stripTashkeel(item.ar);
  return el('span', { class: 'body' },
    el('span', { class: `ar ${size} ${baseline ? 'baseline' : ''}`.trim(), lang: 'ar', dir: 'rtl' }, arabic),
    item.tr ? el('span', { class: 'tr' }, item.tr) : null,
    item.en ? el('span', { class: 'gloss' }, item.en) : null,
  );
}

/**
 * Render a string mixing English with inline Arabic.
 *
 * Arabic inside an English sentence must be wrapped in <bdi>, or the
 * direction-neutral characters beside it — quotes, parentheses, commas —
 * are absorbed into the right-to-left run and jump to the wrong side.
 * Content marks those spans as {{عَرَبِيّ}}. Text is appended as text
 * nodes, never as innerHTML.
 */
const INLINE_AR = /\{\{(.+?)\}\}/g;

export function richText(str) {
  const frag = document.createDocumentFragment();
  const s = String(str ?? '');
  let last = 0;
  for (const m of s.matchAll(INLINE_AR)) {
    if (m.index > last) frag.append(s.slice(last, m.index));
    frag.append(el('bdi', { class: 'ar-inline', lang: 'ar', dir: 'rtl' },
      settings.tashkeel ? m[1] : ar.stripTashkeel(m[1])));
    last = m.index + m[0].length;
  }
  if (last < s.length) frag.append(s.slice(last));
  return frag;
}

/* ---------- sound: synthesised, zero bytes shipped ---------------------- */

let actx = null;
function tone(freq, dur, type = 'sine', vol = 0.05) {
  if (!settings.sound) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, actx.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur + 0.02);
  } catch { /* audio unavailable */ }
}

export const sound = {
  ok:  () => { tone(620, 0.11); setTimeout(() => tone(830, 0.14), 80); },
  no:  () => tone(170, 0.2, 'triangle', 0.045),
  // Neither of the above: a real word, but not the one asked for.
  half: () => tone(520, 0.17),
  win: () => [0, 100, 200, 330].forEach((d, i) =>
        setTimeout(() => tone([523, 659, 784, 1047][i], 0.22), d)),
};

export function announce(msg) { live.textContent = msg; }

/* ---------- settings ---------------------------------------------------- */

function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  if (settings.ui === 'ar') { root.lang = 'ar'; root.dir = 'rtl'; }
  else { root.lang = 'en'; root.dir = 'ltr'; }

  root.dataset.translit = settings.translit ? 'on' : 'off';
  root.dataset.gloss = settings.ui === 'en' ? 'on' : 'off';

  for (const btn of document.querySelectorAll('[data-toggle]')) {
    const key = btn.dataset.toggle;
    if (key === 'theme' || key === 'ui') continue;
    btn.setAttribute('aria-pressed', String(!!settings[key]));
  }
  document.querySelector('[data-theme-label]').textContent = t(`theme_${settings.theme}`);

  /* The phone's chrome bar. index.html carries two theme-color tags keyed to
     the OS preference, which is right before any script runs — but the site
     has its own toggle, so "light" chosen here on a dark phone would leave a
     dark bar above a cream page. Resolve the actual theme and pin one value. */
  const dark = settings.theme === 'dark' || (settings.theme === 'auto'
    && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    m.media = '';
    m.content = dark ? '#141210' : '#F6F1E4';
  }

  // Control icons are redrawn per state: the theme control shows which mode is
  // actually in force, and the audio control shows whether sound is on. Both
  // keep their text label — the icon is a second cue, not a replacement.
  document.querySelector('[data-ctl-icon="theme"]')
    .replaceChildren(icon(`theme-${settings.theme}`, { size: 15, className: 'ctl-mark' }));
  document.querySelector('[data-ctl-icon="audio"]')
    .replaceChildren(icon(settings.sound ? 'audio-on' : 'audio-off',
                          { size: 15, className: 'ctl-mark' }));

  const lang = document.querySelector('[data-lang-label]');
  lang.textContent = settings.ui === 'en' ? 'عربي' : 'EN';
  lang.lang = settings.ui === 'en' ? 'ar' : 'en';
  lang.dir = settings.ui === 'en' ? 'rtl' : 'ltr';

  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  document.title = settings.ui === 'ar' ? 'كُرَّاسَة — تَمَارِين العَرَبِيَّة'
                                        : 'Kurrasa — Arabic exercises';
}

document.querySelector('.controls').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toggle]');
  if (!btn) return;
  const key = btn.dataset.toggle;
  if (key === 'theme') {
    settings.theme = { auto: 'light', light: 'dark', dark: 'auto' }[settings.theme];
  } else if (key === 'ui') {
    settings.ui = settings.ui === 'en' ? 'ar' : 'en';
  } else {
    settings[key] = !settings[key];
  }
  save();
  applySettings();

  // Only tashkeel and language change rendered text. The others are CSS or
  // inert, so they must not re-render — that would restart a round in progress.
  if (key === 'tashkeel' || key === 'ui') refreshView();
});

function refreshView() {
  if (mounted && typeof mounted.refresh === 'function') mounted.refresh();
  else route();
}

/* ---------- catalogue --------------------------------------------------- */

let catalogue = null;
const packCache = new Map();

async function getCatalogue() {
  if (!catalogue) {
    const res = await fetch('./data/index.json');
    if (!res.ok) throw new Error(`catalogue ${res.status}`);
    catalogue = await res.json();
  }
  return catalogue;
}

/**
 * Bare form -> word, for recognising a real Arabic word spelled by accident.
 * Loaded only by the exercises that can produce one, and failing soft: if it
 * cannot be fetched the game still plays, it just stops awarding bonuses.
 */
let lexicon = null;
async function getLexicon() {
  if (!lexicon) {
    try {
      const res = await fetch('./data/lexicon.json');
      lexicon = res.ok ? (await res.json()).words || {} : {};
    } catch { lexicon = {}; }
  }
  return lexicon;
}

async function getPack(name) {
  if (!packCache.has(name)) {
    const res = await fetch(`./data/${name}.json`);
    if (!res.ok) throw new Error(`pack ${name} ${res.status}`);
    packCache.set(name, await res.json());
  }
  return packCache.get(name);
}

/* ---------- screens ----------------------------------------------------- */

let teardown = null;
let mounted = null;

function clearStage() {
  if (teardown) { try { teardown(); } catch { /* ignore */ } teardown = null; }
  mounted = null;
  stage.replaceChildren();
}

function showLoading() { stage.replaceChildren(el('p', { class: 'loading' }, t('loading'))); }
function showFailure(err) {
  console.error(err);
  stage.replaceChildren(el('p', { class: 'failure' }, t('failure')));
}

/**
 * The hub is a workbook contents page: ruled lists, not a card grid.
 * Split into what you can work on now and what is still to be written.
 *
 * Numbering follows CATALOGUE position, not position on screen. The number is
 * the exercise's place in the progression from letters through to meaning, and
 * renderIntro derives the same number from the same index — so an exercise
 * keeps one identity whichever list it currently sits in.
 */
async function renderHub() {
  const cat = await getCatalogue();

  const row = (g, i) => {
    // Margin: the exercise number with its pen mark beneath it.
    const gutter = el('span', { class: 'gutter' },
      el('span', { class: 'num' }, easternNum(i + 1)),
      hasIcon(g.id) ? icon(g.id, { size: 28 }) : null,
    );
    const body = el('span', { class: 'row-body' },
      el('span', { class: 'row-en' }, tx(g.title)),
      settings.ui === 'en'
        ? el('span', { class: 'row-ar', lang: 'ar', dir: 'rtl' },
            settings.tashkeel ? g.title.ar : ar.stripTashkeel(g.title.ar))
        : null,
      el('span', { class: 'row-note' }, tx(g.blurb)),
    );

    const ready = g.status === 'ready';
    const top = ready ? bestAcross(g) : null;
    const meta = el('span', { class: 'row-meta' },
      ready
        ? (top != null ? [el('b', {}, String(top)), t('best')] : t('unattempted'))
        : t('soon'),
    );

    return ready
      ? el('a', { class: 'index-row', href: `#/x/${g.id}` }, gutter, body, meta)
      : el('div', { class: 'index-row is-soon', 'aria-disabled': 'true' }, gutter, body, meta);
  };

  const ready = [], soon = [];
  cat.exercises.forEach((g, i) => (g.status === 'ready' ? ready : soon).push(row(g, i)));

  stage.replaceChildren(...[
    el('div', { class: 'page-head' },
      el('h1', {}, t('hub_title')),
      el('p', {}, t('hub_lead')),
    ),
    ready.length ? el('div', { class: 'section-rule' }, t('sec_ready')) : null,
    ready.length ? el('div', { class: 'index-list' }, ready) : null,
    soon.length ? el('div', { class: 'section-rule' }, t('sec_soon')) : null,
    soon.length ? el('div', { class: 'index-list is-soon-list' }, soon) : null,
  ].filter(Boolean));
}

function bestAcross(g) {
  let top = null;
  for (let l = 1; l <= (g.levels || 1); l++) {
    const b = best(g.id, l);
    if (b != null) top = Math.max(top ?? 0, b);
  }
  return top;
}

async function renderIntro(id) {
  const cat = await getCatalogue();
  const i = cat.exercises.findIndex(x => x.id === id);
  const g = cat.exercises[i];
  if (!g) return renderHub();

  if (g.status !== 'ready') {
    stage.replaceChildren(
      el('a', { class: 'back', href: '#/' }, t('back')),
      el('p', { class: 'loading' }, t('soon_msg')),
    );
    return;
  }

  const pack = await getPack(g.data);
  const levels = [];
  for (let l = 1; l <= (g.levels || 1); l++) {
    const count = (pack.items || pack.rounds || []).filter(x => (x.d ?? 1) === l).length;
    if (!count) continue;
    const b = best(g.id, l);
    levels.push(el('button', {
      class: 'level', type: 'button',
      onclick: () => { location.hash = `#/x/${g.id}/${l}`; },
    },
      el('span', { class: 'lvl-ar', lang: 'ar', dir: 'rtl' }, t(`lvl${l}_ar`)),
      settings.ui === 'en' ? el('span', { class: 'lvl-en' }, t(`lvl${l}`)) : null,
      el('span', { class: 'lvl-score' }, b != null ? `${t('best')} ${b}` : t('unattempted')),
    ));
  }

  stage.replaceChildren(
    el('a', { class: 'back', href: '#/' }, t('back')),
    el('div', { class: 'intro' },
      el('div', { class: 'intro-mark' },
        el('span', { class: 'intro-num' }, easternNum(i + 1)),
        hasIcon(g.id) ? icon(g.id, { size: 54 }) : null,
      ),
      el('h1', {}, tx(g.title)),
      settings.ui === 'en'
        ? el('div', { class: 'intro-ar', lang: 'ar', dir: 'rtl' },
            settings.tashkeel ? g.title.ar : ar.stripTashkeel(g.title.ar))
        : null,
      el('p', {}, tx(g.blurb)),
      g.howto ? el('div', { class: 'howto' }, richText(tx(g.howto))) : null,
      el('div', { class: 'levels' }, levels),
    ),
  );
}

async function renderExercise(id, level) {
  const cat = await getCatalogue();
  const g = cat.exercises.find(x => x.id === id);
  if (!g || g.status !== 'ready') return renderIntro(id);

  const [mod, pack, lex] = await Promise.all([
    import(`./engines/${g.engine}.js`),
    getPack(g.data),
    // Only assemble can spell an unintended word, so only it pays for this.
    g.engine === 'assemble' ? getLexicon() : Promise.resolve(null),
  ]);

  const ctrl = new AbortController();
  const ctx = {
    settings, t, tx, el, ar, arText, richText, easternNum, sound, announce,
    meta: g, level,
    draw: makeDraw(g.id, level),
    lexicon: lex, signal: ctrl.signal,
    finish: (result) => showReport(g, level, result),
  };

  clearStage();
  const handle = mod.mount(stage, pack, ctx);
  mounted = (handle && typeof handle === 'object') ? handle : null;
  teardown = () => {
    ctrl.abort();
    if (typeof handle === 'function') handle();
    else handle?.destroy?.();
  };
}

/**
 * A handful of torn paper scraps, tossed once from the score when a round beats
 * its own best.
 *
 * Deliberately not on every correct answer. Ten questions a round means this
 * would fire eight times in four minutes and stop reading as a reward. The
 * trigger is the one `sound.win()` already uses — a personal best — so the
 * audio and the motion agree and no second threshold is invented. Because a
 * first play beats a stored zero, what this actually celebrates is improvement
 * rather than an absolute score, which is the thing worth rewarding.
 *
 * Nothing here carries meaning, so it is skipped outright under reduced motion
 * rather than merely shortened: an instant burst of paper is worse than none.
 */
function tossScraps(anchor) {
  if (!anchor || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const box = anchor.getBoundingClientRect();
  if (!box.width) return;

  const tones = ['--paper-2', '--rule', '--rule-strong', '--edge', '--red', '--green'];
  const rand = (a, b) => a + Math.random() * (b - a);
  const layer = el('div', { class: 'scraps', 'aria-hidden': 'true' });
  const count = 24;

  for (let i = 0; i < count; i++) {
    const scrap = el('span', { class: 'scrap' });
    const s = scrap.style;
    // Viewport coordinates, which is what position:fixed wants.
    s.left = `${box.left + box.width / 2}px`;
    s.top  = `${box.top + box.height / 2}px`;
    s.setProperty('--w', `${Math.round(rand(4, 11))}px`);
    s.setProperty('--h', `${Math.round(rand(5, 14))}px`);
    s.setProperty('--c', `var(${tones[i % tones.length]})`);
    s.setProperty('--dx', `${Math.round(rand(-190, 190))}px`);
    s.setProperty('--rise', `${Math.round(rand(-160, -60))}px`);
    s.setProperty('--fall', `${Math.round(window.innerHeight * rand(.55, .95))}px`);
    s.setProperty('--spin', `${Math.round(rand(-540, 540))}deg`);
    s.setProperty('--dur', `${rand(1.9, 2.8).toFixed(2)}s`);
    s.setProperty('--delay', `${rand(0, .22).toFixed(2)}s`);
    layer.append(scrap);
  }

  document.body.append(layer);

  // Cleared when the last scrap finishes rather than on a guessed timeout — but
  // with a backstop, because an animation that never fires never ends either,
  // and a stalled layer would sit over the page forever.
  let left = count;
  layer.addEventListener('animationend', () => { if (--left <= 0) layer.remove(); });
  setTimeout(() => layer.remove(), 5000);
}

function showReport(g, level, { correct, total, elapsedMs, missed = [], queried = [], results = [] }) {
  clearStage();
  const isBest = recordResult(g.id, level, correct, total);
  // Per-item outcomes, so the next round can skip what was answered correctly
  // and bring back what was not. Engines that do not report them simply keep
  // the old behaviour of drawing from everything.
  recordItems(g.id, level, results);

  const pct = total ? Math.round((correct / total) * 100) : 0;
  const secs = Math.round(elapsedMs / 1000);
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  stage.replaceChildren(el('div', { class: 'report' },
    el('a', { class: 'back', href: '#/' }, t('back')),
    el('h1', {}, t('report_title')),
    el('div', { class: `report-score`, lang: 'ar', dir: 'rtl' },
      `${easternNum(correct)} / ${easternNum(total)}`),
    el('p', { class: 'report-sub' }, `${tx(g.title)} · ${t(`lvl${level}`)}`),
    el('div', { class: 'tallies' },
      el('div', {}, el('b', {}, `${pct}%`), el('span', {}, t('accuracy'))),
      el('div', {}, el('b', {}, time), el('span', {}, t('time'))),
      el('div', {}, el('b', {}, String(best(g.id, level) ?? correct)), el('span', {}, t('best'))),
      // Only shown when it happened — an always-zero tally would read as a
      // thing you failed at rather than a thing you did.
      ...(queried.length
        ? [el('div', {}, el('b', {}, easternNum(queried.length)), el('span', {}, t('also_tally')))]
        : []),
    ),
    el('p', { class: `best-note ${isBest ? 'is-new' : ''}`.trim() },
      isBest ? t('newbest') : `${t('best')} ${best(g.id, level)} / ${total}`),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', type: 'button',
        onclick: () => renderExercise(g.id, level).catch(showFailure) }, t('again')),
      el('a', { class: 'btn btn-ghost', href: '#/' }, t('back')),
    ),
    queried.length ? el('div', { class: 'corrections' },
      el('div', { class: 'section-rule' }, t('also_section')),
      queried.map(q => el('div', { class: 'correction is-queried' },
        el('div', { class: 'c-made' }, q.made),
        el('div', { class: 'c-right' },
          el('span', { class: 'c-label' }, t('as_also_wanted')), q.wanted),
      )),
    ) : null,
    missed.length ? el('div', { class: 'corrections' },
      el('div', { class: 'section-rule' }, t('corrections')),
      missed.map(m => el('div', { class: 'correction' },
        el('div', { class: 'c-q' }, richText(m.question)),
        el('div', { class: 'c-right' },
          el('span', { class: 'c-label' }, t('answer')), m.correct),
        m.chosen ? el('div', { class: 'c-yours' },
          el('span', { class: 'c-label' }, t('youchose')), m.chosen) : null,
      )),
    ) : null,
  ));
  announce(`${t('report_title')} ${correct}/${total}`);

  // After the render, not before: the scraps are thrown from the score, so it
  // has to be on screen to be measured. Sound moved down here with them so the
  // two halves of the celebration land together.
  if (isBest) {
    sound.win();
    tossScraps(stage.querySelector('.report-score'));
  }
}

/* ---------- router ------------------------------------------------------ */

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  clearStage();
  showLoading();
  try {
    if (parts[0] === 'x' && parts[1]) {
      if (parts[2]) await renderExercise(parts[1], Number(parts[2]) || 1);
      else await renderIntro(parts[1]);
    } else {
      await renderHub();
    }
  } catch (err) {
    showFailure(err);
  }
  stage.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

/**
 * The footer's "write to me" link.
 *
 * The address is assembled here rather than written into index.html, so it is
 * not sitting in the served HTML for the harvesters that crawl static sites.
 * Anything running JavaScript can still read it — this raises the cost of
 * collecting it, it does not hide it.
 *
 * A mailto: also keeps the line directly above it honest. The colophon promises
 * that nothing is sent anywhere, and that stays literally true: the page posts
 * nothing, it hands the reader's own mail app a pre-addressed draft that the
 * reader chooses to send. A form would have made that sentence a lie.
 *
 * The subject carries the exercise they were on, so a report about a specific
 * drill arrives already labelled. It is visible in the draft before sending —
 * nothing is collected behind the reader's back.
 */
function wireFeedback() {
  const link = document.querySelector('[data-feedback]');
  if (!link) return;
  const to = ['dvanas13', ['gmail', 'com'].join('.')].join('@');
  const setHref = () => {
    const on = location.hash.match(/^#\/x\/([a-z-]+)/)?.[1];
    const subject = on ? `Kurrasa feedback — ${on}` : 'Kurrasa feedback';
    link.href = `mailto:${to}?subject=${encodeURIComponent(subject)}`;
  };
  setHref();
  window.addEventListener('hashchange', setHref);
}

window.addEventListener('hashchange', route);

applySettings();
wireFeedback();
route();
