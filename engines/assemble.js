/* =========================================================================
   Engine: assemble — build a word onto the writing line

   Two exercises run on this:
     mode "order"    scrambled letters, put them in sequence, then vowel them
     mode "missing"  one letter blanked out, choose which belongs there

   ── The shaping problem, and why the code looks like this ──────────────
   An Arabic letter changes shape by position: ب is بـ initially, ـبـ in the
   middle, ـب at the end. The browser works this out only WITHIN one text
   run, so the obvious build — one <span> per letter, so each is tappable —
   renders every letter isolated and the word looks broken.

   Putting the whole word in one run fixes the shapes but loses per-letter
   hit targets, which both phases need.

   So each letter is placed in its own span and its shape is forced with
   zero-width joiners. That is only correct if the joining is computed
   properly: six letters — ا د ذ ر ز و and friends — never join to what
   follows them, so the letter AFTER one of them is initial, not medial.
   Forcing medial there would be a subtler bug than the one being fixed.
   See shapeAt().

   Contract: mount(root, pack, ctx) -> { destroy, refresh }
   ========================================================================= */

/* Letters that never connect to the letter following them. Everything else
   connects on both sides. */
const NON_CONNECTORS = new Set([...'ادذرزوؤأإآةىء']);

/* Letters that differ only by their dots — the whole point of "The Right
   Letter". Used to generate distractors when a pack does not name them. */
const CONFUSABLE = [
  [...'بتثني'], [...'جحخ'], [...'دذ'], [...'رز'], [...'سش'],
  [...'صض'], [...'طظ'], [...'عغ'], [...'فق'], [...'هة'],
];

const HARAKAT = /[ً-ْٰ]/;
const SHADDA = 'ّ';

/* Vowel marks, shown on a dotted circle because a mark cannot stand alone. */
const VOWELS = [
  { m: 'َ', tr: 'a'  }, { m: 'ِ', tr: 'i'  }, { m: 'ُ', tr: 'u'  },
  { m: 'ْ', tr: '—'  }, { m: 'ً', tr: 'an' }, { m: 'ٍ', tr: 'in' },
  { m: 'ٌ', tr: 'un' },
];

const randInt = (n) => Math.floor(Math.random() * n);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The positional form of letters[i], expressed with zero-width joiners.
 *
 * joinsBefore — does the PREVIOUS letter reach forward to this one?
 * joinsAfter  — does THIS letter reach forward to the next one?
 * A letter is medial only when both are true.
 */
function shapeAt(letters, i, ar) {
  const ch = letters[i];
  const prev = i > 0 ? letters[i - 1] : null;
  const hasNext = i < letters.length - 1;

  const joinsBefore = prev !== null && !NON_CONNECTORS.has(prev);
  const joinsAfter = hasNext && !NON_CONNECTORS.has(ch);

  if (joinsBefore && joinsAfter) return ar.medial(ch);
  if (joinsBefore) return ar.final(ch);
  if (joinsAfter) return ar.initial(ch);
  return ch;
}

/** Split a vowelled word into base letters and the marks sitting on each. */
function analyse(vocalised, ar) {
  return ar.letters(vocalised).map((cluster) => {
    const marks = [...cluster].filter(c => HARAKAT.test(c) || c === SHADDA);
    return {
      base: ar.stripTashkeel(cluster).replace(SHADDA, ''),
      shadda: marks.includes(SHADDA),
      vowel: marks.find(c => c !== SHADDA && HARAKAT.test(c)) || '',
    };
  }).filter(l => l.base.trim() !== '');
}

export function mount(root, pack, ctx) {
  const { el, t, tx, ar, arText, sound, announce, level, signal } = ctx;

  const perRound = pack.perRound || 8;
  let pool = pack.items.filter(i => (i.d ?? 1) === level);
  if (pool.length < 3) pool = pack.items;
  // ctx.draw, not a plain shuffle: it remembers recent rounds so replaying
  // does not serve the same words again. See makeDraw() in app.js.
  // Named, so the same id can be reported back with the outcome. The mode and
  // gap are part of it: the same word with a different letter missing is a
  // different question, and retiring one must not retire the other.
  const idOf = (it) => `${it.word.ar}|${it.mode || 'order'}|${it.gap ?? ''}`;
  const items = ctx.draw(pool, perRound, idOf);
  const total = items.length;

  let idx = 0, correct = 0, streak = 0;
  let cur = null;
  const missed = [];
  const results = [];   // { id, ok } per item, for the cross-session picker
  const queried = [];       // real Arabic words that were not the one asked for
  const startedAt = performance.now();

  const counter = el('span', {});
  const tally   = el('span', { class: 'tally' });
  const bar     = el('i');
  const hintEl  = el('div', { class: 'as-hint' });
  const lineEl  = el('div', { class: 'as-line', lang: 'ar', dir: 'rtl' });
  const bankEl  = el('div', { class: 'as-bank', lang: 'ar', dir: 'rtl' });
  const footEl  = el('div', {});

  root.replaceChildren(
    el('a', { class: 'back', href: '#/' }, t('back')),
    el('div', { class: 'sheet' },
      el('div', { class: 'sheet-head' }, counter, tally),
      el('div', { class: 'gauge' }, bar),
      hintEl, lineEl, bankEl, footEl,
    ),
    el('a', { class: 'back back-bottom', href: '#/' }, t('back')),
  );

  /* --- set up one item -------------------------------------------------- */
  function load() {
    const item = items[idx];
    const letters = analyse(item.word.ar, ar);
    const bases = letters.map(l => l.base);

    if ((item.mode || 'order') === 'missing') {
      const gap = Number.isInteger(item.gap) ? item.gap : randInt(bases.length);
      cur = {
        item, letters, bases, mode: 'missing', gap,
        phase: 'letters',
        slots: bases.map((b, i) => (i === gap ? null : b)),
        locked: bases.map((_, i) => i !== gap),
        bank: shuffle(choicesFor(bases[gap], item.choices)).map(ch => ({ ch, used: false })),
        verdict: null,
      };
    } else {
      cur = {
        item, letters, bases, mode: 'order', gap: -1,
        phase: 'letters',
        slots: bases.map(() => null),
        locked: bases.map(() => false),
        bank: shuffle([...bases, ...(item.extra || [])]).map(ch => ({ ch, used: false })),
        verdict: null,
      };
    }
    cur.marks = bases.map(() => ({ shadda: false, vowel: '' }));
    cur.found = new Set();     // bonus words already spelled on this item
    cur.bonusNote = null;      // the bonus just spelled, shown until the next try
    paint();
  }

  /**
   * The right letter plus its dot-lookalikes — and nothing else.
   *
   * This used to pad up to four options with random letters from the whole
   * alphabet, which was wrong twice over. It diluted the exercise, since the
   * point is telling ع from غ and a stray ب is obviously not the answer. And
   * it made the set of strings a learner can produce effectively unbounded,
   * so real words spelled by accident (عين -> بين, "between") could not be
   * enumerated and kept being marked incorrect.
   *
   * Restricted to the confusable group, that set is finite and known, which is
   * what lets bonus words be recognised. Groups of two give a two-way choice;
   * that is the genuine discrimination, not a weakness.
   */
  function choicesFor(right, given) {
    if (given?.length) return given.slice();
    const group = CONFUSABLE.find(g => g.includes(right));
    if (!group) return [right];
    return [right, ...shuffle(group.filter(c => c !== right)).slice(0, 4)];
  }

  /* --- render ----------------------------------------------------------- */
  function paint() {
    const { item, bases, slots, bank, phase, verdict, marks } = cur;

    counter.textContent = t('q_of', { a: idx + 1, b: total });
    tally.textContent = `${correct} ${t('score')}${streak > 1 ? ` · ×${streak}` : ''}`;
    bar.style.inlineSize = `${((idx + (verdict ? 1 : 0)) / total) * 100}%`;

    // The meaning is the clue in "order"; in "missing" the word is on screen
    // already, so showing the gloss would give the answer away.
    // In "order" the meaning is the ONLY clue to what to build, so it is set
    // large and in full ink — it was previously the same muted 0.9rem as every
    // other hint and easy to miss entirely. In "missing" the word is already
    // on screen, so showing the meaning would give the answer away.
    hintEl.className = `as-hint${cur.mode === 'order' ? ' is-clue' : ''}`;
    hintEl.replaceChildren(...(cur.mode === 'order'
      ? [el('span', { class: 'clue-label' }, t('as_clue')),
         el('strong', { class: 'clue-word' },
           tx({ en: item.word.en ?? '', ar: item.word.tr ?? '' }))]
      : [el('span', {}, t('as_which'))]));

    /* The writing line. Shapes are forced per slot — see shapeAt(). */
    const filled = slots.map((s, i) => s ?? bases[i]);
    lineEl.replaceChildren(...slots.map((slot, i) => {
      let cls = 'as-slot';
      if (slot === null) cls += ' is-empty';
      else if (cur.locked[i]) cls += ' is-fixed';
      if (verdict === 'wrong' && slot !== bases[i]) cls += ' is-wrong';
      if (verdict === 'right') cls += ' is-right';
      // Placed by the learner, not yet submitted, and still removable.
      if (phase === 'letters' && !verdict && slot !== null && !cur.locked[i]) cls += ' is-pending';
      if (phase === 'marks') {
        cls += ' is-markable';
        if (cur.sel === i) cls += ' is-sel';
        if (verdict === 'wrong' && !sameMark(marks[i], cur.letters[i])) cls += ' is-wrong';
      }

      const glyph = slot === null
        ? ''
        : shapeAt(filled, i, ar) + (phase === 'marks'
            ? (marks[i].shadda ? SHADDA : '') + marks[i].vowel
            : '');

      return el('button', {
        class: cls, type: 'button',
        disabled: (phase === 'letters' && (cur.locked[i] || slot === null)) || !!verdict,
        onclick: () => (phase === 'marks' ? selectLetter(i) : unplace(i)),
      }, glyph);
    }));

    /* The bank: letters in isolated form, or the vowel marks in phase two. */
    if (phase === 'letters') {
      bankEl.replaceChildren(...bank.map((tile, n) => el('button', {
        class: `as-tile${tile.used ? ' is-used' : ''}`, type: 'button',
        disabled: tile.used || !!verdict,
        onclick: () => place(n),
      }, tile.ch)));
    } else {
      const opts = markOptions();
      bankEl.replaceChildren(...[
        opts.shadda ? el('button', {
          class: `as-mark${marks[cur.sel ?? 0]?.shadda ? ' is-on' : ''}`, type: 'button',
          disabled: !!verdict, onclick: () => applyMark('shadda'),
        }, '◌' + SHADDA) : null,
        ...opts.vowels.map(v => el('button', {
          class: `as-mark${marks[cur.sel ?? 0]?.vowel === v.m ? ' is-on' : ''}`,
          type: 'button', disabled: !!verdict, onclick: () => applyMark(v.m),
        }, '◌' + v.m)),
      ].filter(Boolean));
    }

    // .filter(Boolean) is load-bearing: replaceChildren() stringifies a null
    // into the literal text "null" on the page. el() skips nulls, but this is
    // a direct call and does not.
    footEl.replaceChildren(...[
      // Every letter down, nothing submitted yet: offer the confirm.
      phase === 'letters' && !verdict && slots.every(s => s !== null)
        ? el('div', { class: 'btn-row' },
            el('button', { class: 'btn', type: 'button', onclick: checkLetters }, t('as_confirm')),
            el('span', { class: 'as-undo-hint' }, t('as_undo')))
        : null,
      phase === 'marks' && !verdict
        ? el('div', { class: 'btn-row' },
            el('button', { class: 'btn', type: 'button', onclick: checkMarks }, t('as_check')))
        : null,
      // The bonus note stands while the turn is still open, so it sits above
      // the still-playable board rather than replacing it.
      !verdict && cur.bonusNote
        ? el('div', { class: 'margin-note is-bonus' },
            el('b', {}, t('as_bonus')),
            arText(cur.bonusNote),
            el('span', { class: 'c-label' }, t('as_bonus_keep')),
          )
        : null,
      verdict ? el('div', { class: `margin-note is-${verdict}` },
        el('b', {}, verdict === 'right' ? t('correct') : t('incorrect')),
        arText(item.word),
      ) : null,
      verdict ? el('div', { class: 'btn-row' },
        el('button', { class: 'btn', type: 'button', onclick: advance },
          idx === total - 1 ? t('finish') : t('next'))) : null,
    ].filter(Boolean));
    if (verdict) footEl.querySelector('.btn')?.focus();
  }

  const sameMark = (got, want) => got.shadda === want.shadda && got.vowel === (want.vowel || '');

  /**
   * Which marks the bank offers.
   *
   * At level 1 it is narrowed to the marks the target word actually uses. A
   * beginner then chooses between two or three real possibilities instead of
   * hunting through all seven vowels plus shadda, and the narrowing itself
   * teaches something: seeing only fatha and sukun says this word carries only
   * fatha and sukun. Above level 1 the full set is always shown.
   */
  function markOptions() {
    if (level > 1) return { vowels: VOWELS, shadda: true };
    const used = new Set(cur.letters.map(l => l.vowel).filter(Boolean));
    const inWord = VOWELS.filter(v => used.has(v.m));
    const rest = VOWELS.filter(v => !used.has(v.m));
    // Two minimum, or there is no choice left to make.
    const vowels = inWord.length >= 2
      ? inWord
      : [...inWord, ...rest.slice(0, 2 - inWord.length)]
          .sort((a, b) => VOWELS.indexOf(a) - VOWELS.indexOf(b));
    return { vowels, shadda: cur.letters.some(l => l.shadda) };
  }

  /** Flatten a word object into one reviewable line for the report. */
  const label = (w) => !w ? ''
    : typeof w === 'string' ? w
    : [w.ar, w.tr, w.en].filter(Boolean).join(' · ');

  /* --- phase one: letters ----------------------------------------------- */
  function place(n) {
    const tile = cur.bank[n];
    if (!tile || tile.used || cur.verdict) return;
    const slot = cur.slots.findIndex((s, i) => s === null && !cur.locked[i]);
    if (slot === -1) return;
    cur.slots[slot] = tile.ch;
    tile.used = true;
    tile.at = slot;
    // Deliberately does NOT check on the last letter. A mis-tap used to commit
    // the answer instantly with no way back; the learner now confirms, and can
    // tap a placed letter to take it off the line first.
    paint();
  }

  function unplace(i) {
    if (cur.verdict || cur.locked[i] || cur.slots[i] === null) return;
    const tile = cur.bank.find(b => b.used && b.at === i);
    if (tile) { tile.used = false; tile.at = undefined; }
    cur.slots[i] = null;
    paint();
  }

  function checkLetters() {
    const made = cur.slots.join('');

    if (made !== cur.bases.join('')) {
      // Swapping س for ش in سرير spells شرير, which is a real word meaning
      // "wicked". Marking that with the correction pen punishes a learner for
      // knowing more Arabic, not less. Packs name these in `also`, so the
      // answer can be acknowledged as a word while still not being the one
      // asked for.
      // The pack's own `also` first — it carries a gloss written for this
      // item — then the shared lexicon, which covers everything the generated
      // items never declared.
      const alt = cur.item.also?.[made] ?? ctx.lexicon?.[made];
      // A real word that is not the one asked for does NOT end the turn. It is
      // a bonus: credit it, say what they spelled, hand the letters back, and
      // let them keep going for the word they were actually after.
      if (alt) return bonus(alt);
      return settle('wrong');
    }

    // Letters right. Vowel them if the item asks, otherwise the item is done.
    if (cur.item.tashkeel && cur.mode === 'order') {
      cur.phase = 'marks';
      cur.sel = 0;
      sound.ok();
      announce(t('as_now_vowel'));
      paint();
      return;
    }
    settle('right');
  }

  /* --- phase two: vowel marks ------------------------------------------- */
  function selectLetter(i) { cur.sel = i; paint(); }

  function applyMark(which) {
    const i = cur.sel ?? 0;
    const m = cur.marks[i];
    if (which === 'shadda') m.shadda = !m.shadda;
    else m.vowel = m.vowel === which ? '' : which;
    paint();
  }

  function checkMarks() {
    settle(cur.marks.every((m, i) => sameMark(m, cur.letters[i])) ? 'right' : 'wrong');
  }

  /**
   * A real Arabic word that was not the one asked for.
   *
   * Not scored, not penalised, and — the point of it — not terminal. The turn
   * stays open: the letters go back to the bank and the learner tries again
   * for the word they were asked for. Credit is given once per word, so
   * spelling the same bonus twice does not farm the counter.
   */
  function bonus(alt) {
    if (!cur.found.has(alt.ar)) {
      cur.found.add(alt.ar);
      queried.push({ made: label(alt), wanted: label(cur.item.word) });
      sound.half();
      announce(`${t('as_bonus')} — ${alt.ar}`);
    }
    cur.bonusNote = alt;

    // Hand every unlocked letter back so another attempt is possible.
    for (let i = 0; i < cur.slots.length; i++) {
      if (cur.locked[i] || cur.slots[i] === null) continue;
      const tile = cur.bank.find(b => b.used && b.at === i);
      if (tile) { tile.used = false; tile.at = undefined; }
      cur.slots[i] = null;
    }
    paint();
  }

  /* --- shared ------------------------------------------------------------ */
  /** kind: 'right' | 'wrong'. Bonus words go through bonus(), not here. */
  function settle(kind) {
    cur.verdict = kind;
    // Once per item: place() and checkLetters() both bail out once a verdict
    // exists, and bonus() deliberately does not come through here.
    results.push({ id: idOf(cur.item), ok: kind === 'right' });

    if (kind === 'right') {
      correct++; streak++;
      sound.ok();
      announce(t('correct'));
    } else {
      streak = 0;
      sound.no();
      announce(t('incorrect'));
      missed.push({
        question: cur.mode === 'missing' ? t('as_which') : tx(cur.item.word.en ?? ''),
        correct: label(cur.item.word),
        chosen: null,
      });
    }
    paint();
  }

  function advance() {
    idx++;
    if (idx >= total) {
      ctx.finish({ correct, total, missed, queried, results, elapsedMs: performance.now() - startedAt });
      return;
    }
    load();
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (cur?.verdict && (e.key === 'Enter' || e.key === ' ')) {
      const btn = footEl.querySelector('.btn');
      if (btn && document.activeElement !== btn) { e.preventDefault(); btn.click(); }
    } else if (!cur?.verdict && cur?.phase === 'letters' && /^[1-9]$/.test(e.key)) {
      const btn = bankEl.children[Number(e.key) - 1];
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
    } else if (e.key === 'Backspace' && cur?.phase === 'letters' && !cur.verdict) {
      const last = [...cur.slots].map((s, i) => ({ s, i }))
        .filter(x => x.s !== null && !cur.locked[x.i]).pop();
      if (last) { e.preventDefault(); unplace(last.i); }
    }
  }, { signal });

  load();

  return { destroy() {}, refresh: paint };
}
