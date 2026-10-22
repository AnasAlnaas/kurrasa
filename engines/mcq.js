/* =========================================================================
   Engine: mcq — multiple choice
   Powers Sira & Sahaba, grammar, Tajweed, geography… anything question-shaped.

   Contract: mount(root, pack, ctx) -> { destroy, refresh }
   All render state lives in `current`, so refresh() can repaint the same
   question including its answered state when a display setting changes.
   Scoring happens in answer(), never in paint(), so repainting cannot
   double-count.
   ========================================================================= */

/* Choices are marked أ ب ج د, as an Arabic workbook marks them. */
const ABJAD = ['أ', 'ب', 'ج', 'د', 'ه', 'و', 'ز', 'ح'];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function mount(root, pack, ctx) {
  const { el, t, tx, arText, richText, sound, announce, level, signal } = ctx;

  const perRound = pack.perRound || 10;
  let pool = pack.items.filter(i => (i.d ?? 1) === level);
  if (pool.length < 4) pool = pack.items;

  // ctx.draw, not a plain shuffle: it remembers recent rounds so replaying
  // does not serve the same questions again. See makeDraw() in app.js.
  // Named, not inline: the same id has to go back to ctx.finish() with the
  // answer, or the picker cannot tell which question was the one got wrong.
  const idOf = (it) => it.q?.en ?? it.q?.ar ?? JSON.stringify(it);
  const items = ctx.draw(pool, perRound, idOf);
  const total = items.length;

  let idx = 0, correct = 0, streak = 0;
  let current = null;                 // { item, order, chosen }
  const missed = [];
  const results = [];   // { id, ok } per question, for the cross-session picker
  const startedAt = performance.now();

  const counter = el('span', {});
  const tally   = el('span', { class: 'tally' });
  const bar     = el('i');
  const promptEl = el('h1', { class: 'prompt' });
  const choicesEl = el('div', { class: 'choices' });
  const footEl  = el('div', {});

  root.replaceChildren(
    el('a', { class: 'back', href: '#/' }, t('back')),
    el('div', { class: 'sheet' },
      el('div', { class: 'sheet-head' }, counter, tally),
      el('div', { class: 'gauge' }, bar),
      promptEl, choicesEl, footEl,
    ),
    el('a', { class: 'back back-bottom', href: '#/' }, t('back')),
  );

  function paint() {
    const { item, order, chosen } = current;
    const done = chosen !== null;

    counter.textContent = t('q_of', { a: idx + 1, b: total });
    tally.textContent   = `${correct} ${t('score')}${streak > 1 ? ` · ×${streak}` : ''}`;
    bar.style.inlineSize = `${((idx + (done ? 1 : 0)) / total) * 100}%`;

    promptEl.replaceChildren(richText(tx(item.q)));

    choicesEl.replaceChildren(...order.map((opt, n) => {
      let cls = 'choice';
      if (done) {
        if (opt.isRight) cls += ' is-right';
        else if (n === chosen) cls += ' is-wrong';
      }
      return el('button', {
        class: cls, type: 'button', disabled: done,
        dataset: { right: String(opt.isRight) },
        onclick: () => answer(n),
      },
        el('span', { class: 'mark', lang: 'ar', dir: 'rtl' }, ABJAD[n] ?? String(n + 1)),
        arText(opt.choice),
      );
    }));

    if (!done) { footEl.replaceChildren(); return; }

    const wasRight = order[chosen].isRight;
    // .filter(Boolean) is load-bearing: replaceChildren() stringifies a null
    // into the literal text "null" on the page. An item with no explanation
    // would otherwise print it.
    footEl.replaceChildren(...[
      item.e ? el('div', { class: `margin-note is-${wasRight ? 'right' : 'wrong'}` },
        el('b', {}, wasRight ? t('correct') : t('incorrect')),
        richText(tx(item.e)),
      ) : null,
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn', type: 'button', onclick: advance },
          idx === total - 1 ? t('finish') : t('next')),
      ),
    ].filter(Boolean));
  }

  function newQuestion() {
    const item = items[idx];
    current = {
      item,
      order: shuffle(item.a.map((choice, i) => ({ choice, isRight: i === item.c }))),
      chosen: null,
    };
    paint();
  }

  function answer(n) {
    if (!current || current.chosen !== null) return;
    current.chosen = n;

    const opt = current.order[n];
    results.push({ id: idOf(current.item), ok: opt.isRight });
    if (opt.isRight) {
      correct++; streak++;
      sound.ok();
      announce(t('correct'));
    } else {
      streak = 0;
      sound.no();
      announce(t('incorrect'));
      missed.push({
        question: tx(current.item.q),
        correct: label(current.order.find(o => o.isRight).choice),
        chosen: label(opt.choice),
      });
    }

    paint();
    footEl.querySelector('.btn')?.focus();
  }

  function label(choice) {
    if (choice == null) return '';
    if (typeof choice === 'string') return choice;
    return [choice.ar, choice.tr, choice.en].filter(Boolean).join(' · ');
  }

  function advance() {
    idx++;
    if (idx >= total) {
      ctx.finish({ correct, total, missed, results, elapsedMs: performance.now() - startedAt });
      return;
    }
    newQuestion();
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const done = current && current.chosen !== null;
    if (!done && /^[1-9]$/.test(e.key)) {
      const btn = choicesEl.children[Number(e.key) - 1];
      if (btn) { e.preventDefault(); btn.click(); }
    } else if (done && (e.key === 'Enter' || e.key === ' ')) {
      const btn = footEl.querySelector('.btn');
      if (btn && document.activeElement !== btn) { e.preventDefault(); btn.click(); }
    }
  }, { signal });

  newQuestion();

  return { destroy() {}, refresh: paint };
}
