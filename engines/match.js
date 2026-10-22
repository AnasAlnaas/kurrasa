/* =========================================================================
   Engine: match — join each word to its partner

   Powers "Same and Opposite": synonyms (مُرَادِف), antonyms (ضِدّ), and
   singular/plural (مُفْرَد وَجَمْع). A board draws pairs of ONE relation so the
   instruction can name what is being looked for.

   ── Why lines ──────────────────────────────────────────────────────────
   In a printed workbook this exercise is always "draw a line between the two
   columns", so that is the mechanic: tap a word, tap its partner, and an ink
   line is drawn between them. The lines are an SVG overlay measured from the
   real element positions, redrawn on resize and whenever the text changes.

   ── The gloss problem ──────────────────────────────────────────────────
   The English meaning cannot be on screen while the board is unsolved. Show
   "big" beside كَبِير and "small" beside صَغِير and the learner matches the
   English without reading a word of Arabic. Glosses appear only once a pair
   is joined, which turns them into the reward rather than the answer key.

   Contract: mount(root, pack, ctx) -> { destroy, refresh }
   ========================================================================= */

const NS = 'http://www.w3.org/2000/svg';

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function mount(root, pack, ctx) {
  const { el, t, tx, ar, settings, sound, announce, level, signal } = ctx;

  const perRound = pack.perRound || 8;

  /* Choose a relation that actually has enough pairs at this level, so a
     thin level never silently produces a two-pair board. */
  const byRel = {};
  for (const it of pack.items) {
    if ((it.d ?? 1) !== level) continue;
    (byRel[it.rel] ||= []).push(it);
  }
  let rels = Object.keys(byRel).filter(r => byRel[r].length >= 4);
  if (!rels.length) {                       // fall back across all levels
    for (const it of pack.items) (byRel[it.rel] ||= []).push(it);
    rels = Object.keys(byRel).filter(r => byRel[r].length >= 4);
  }
  const rel = rels[Math.floor(Math.random() * rels.length)];
  // ctx.draw, not a plain shuffle: with only ~12 pairs per relation a random
  // sample of 8 repeats most of the board every time. See makeDraw() in app.js.
  // `id` below is the pair's index within THIS board, used for the joining
  // lines. idOf is the stable identity of the pair itself, which is what the
  // cross-session picker remembers — the two are not interchangeable.
  const idOf = (p) => `${p.a.ar}|${p.b.ar}`;
  const pairs = ctx.draw(byRel[rel], perRound, idOf)
    .map((p, i) => ({ ...p, id: i }));
  const total = pairs.length;

  const colA = shuffle(pairs);
  const colB = shuffle(pairs);

  let sel = null;               // { side, id }
  const done = new Set();       // pair ids joined
  const erred = new Set();      // pair ids involved in a wrong attempt
  // pair id -> its <path>. drawLines() runs on every join, every resize and
  // again when fonts land; it used to throw all the paths away and build them
  // again each time. Keeping them means a line's geometry is updated in place
  // rather than replaced, which is what lets it animate: an element destroyed
  // and recreated a frame later restarts its animation forever and so never
  // finishes one.
  const lines = new Map();
  let flash = null;             // { a, b } ids briefly marked wrong
  const timers = new Set();
  const startedAt = performance.now();

  const counter = el('span', {});
  const tally   = el('span', { class: 'tally' });
  const hintEl  = el('div', { class: 'as-hint' });
  const svg     = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'mt-lines');
  svg.setAttribute('aria-hidden', 'true');
  const colAEl = el('div', { class: 'mt-col' });
  const colBEl = el('div', { class: 'mt-col' });
  const wrap   = el('div', { class: 'mt-wrap', lang: 'ar', dir: 'rtl' });
  wrap.append(svg, colAEl, colBEl);
  const footEl = el('div', {});

  root.replaceChildren(
    el('a', { class: 'back', href: '#/' }, t('back')),
    el('div', { class: 'sheet' },
      el('div', { class: 'sheet-head' }, counter, tally),
      hintEl, wrap, footEl,
    ),
    el('a', { class: 'back back-bottom', href: '#/' }, t('back')),
  );

  /* --- one word tile ---------------------------------------------------- */
  function tile(word, side, id) {
    const matched = done.has(id);
    // flash is { a, b }: the pair id of the A-side tile and of the B-side tile
    // that were just wrongly joined. Keyed by side, so only those two light up
    // — not both tiles of both pairs.
    const isFlash = !!flash && flash[side] === id;
    let cls = 'mt-item';
    if (matched) cls += ' is-done';
    else if (sel && sel.side === side && sel.id === id) cls += ' is-sel';
    if (isFlash) cls += ' is-wrong';

    return el('button', {
      class: cls, type: 'button', disabled: matched,
      dataset: { side, id: String(id) },
      'aria-pressed': String(!!(sel && sel.side === side && sel.id === id)),
      onclick: () => pick(side, id),
    },
      el('span', { class: 'mt-body' },
        el('span', { class: 'ar', lang: 'ar', dir: 'rtl' },
          settings.tashkeel ? word.ar : ar.stripTashkeel(word.ar)),
        word.tr ? el('span', { class: 'tr' }, word.tr) : null,
        // Only once joined — see the gloss note at the top of this file.
        matched && word.en ? el('span', { class: 'en-gloss' }, word.en) : null,
      ),
    );
  }

  /* --- render ----------------------------------------------------------- */
  function paint() {
    counter.textContent = t('mt_join', { a: done.size, b: total });
    tally.textContent = `${countCorrect()} ${t('score')}`;
    hintEl.replaceChildren(el('span', {}, t(`mt_${rel}`)));

    colAEl.replaceChildren(...colA.map(p => tile(p.a, 'a', p.id)));
    colBEl.replaceChildren(...colB.map(p => tile(p.b, 'b', p.id)));

    footEl.replaceChildren(...[
      done.size === total
        ? el('div', { class: 'btn-row' },
            el('button', { class: 'btn', type: 'button', onclick: end }, t('finish')))
        : null,
    ].filter(Boolean));

    drawLines();
  }

  const countCorrect = () => [...done].filter(id => !erred.has(id)).length;

  /* --- the joining lines ------------------------------------------------ */
  function drawLines() {
    const box = wrap.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // viewBox only — NEVER width/height attributes. The SVG is sized by CSS
    // (inset: 0); writing its dimensions here feeds the ResizeObserver below
    // and the two bounce off each other until the tab locks up.
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);

    for (const id of done) {
      const a = colAEl.querySelector(`[data-id="${id}"]`);
      const b = colBEl.querySelector(`[data-id="${id}"]`);
      if (!a || !b) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      // Join the facing edges. Which edge faces which is decided by measured
      // position, not by assuming a direction — the columns swap sides under
      // dir="rtl" and this has to hold either way.
      const aIsRight = (ra.left + ra.width / 2) > (rb.left + rb.width / 2);
      const x1 = (aIsRight ? ra.left : ra.right) - box.left;
      const x2 = (aIsRight ? rb.right : rb.left) - box.left;
      const y1 = ra.top + ra.height / 2 - box.top;
      const y2 = rb.top + rb.height / 2 - box.top;
      // A slight bow, so it reads as drawn rather than plotted.
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2 + (y2 > y1 ? -7 : 7);

      // Created once, on the join that produced it — so `is-new` fires its
      // draw-in exactly once and a later resize only moves the line.
      let path = lines.get(id);
      if (!path) {
        path = document.createElementNS(NS, 'path');
        const recovered = erred.has(id);
        path.setAttribute('class', recovered ? 'mt-line is-recovered is-new' : 'mt-line is-new');
        // pathLength normalises the dash to the path, so one keyframe draws a
        // short join and a long one at the same speed. Not set on a recovered
        // line: that one keeps its pencil dashes in real units and fades.
        if (!recovered) path.setAttribute('pathLength', '1');
        lines.set(id, path);
        svg.append(path);
      }
      path.setAttribute('d', `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`);
    }
  }

  /* --- interaction ------------------------------------------------------ */
  function pick(side, id) {
    if (done.has(id)) return;

    if (!sel) { sel = { side, id }; paint(); return; }
    if (sel.side === side) {                 // re-picking within a column
      sel = sel.id === id ? null : { side, id };
      paint();
      return;
    }

    const a = sel.side === 'a' ? sel.id : id;
    const b = sel.side === 'a' ? id : sel.id;

    if (a === b) {
      done.add(a);
      sel = null;
      sound.ok();
      announce(t('correct'));
      paint();
      if (done.size === total) {
        const timer = setTimeout(end, 650);   // let the last line be seen
        timers.add(timer);
      }
      return;
    }

    // Wrong: both pairs lose their first-try status.
    erred.add(a); erred.add(b);
    flash = { a, b };
    sel = null;
    sound.no();
    announce(t('incorrect'));
    paint();
    const timer = setTimeout(() => { flash = null; paint(); }, 550);
    timers.add(timer);
  }

  function end() {
    const missed = pairs
      .filter(p => erred.has(p.id))
      .map(p => ({
        question: t(`mt_${rel}`),
        correct: `${p.a.ar} · ${p.a.tr} — ${p.b.ar} · ${p.b.tr}${p.b.en ? ` (${p.b.en})` : ''}`,
        chosen: null,
      }));
    ctx.finish({
      correct: countCorrect(), total, missed,
      elapsedMs: performance.now() - startedAt,
      // Joined at the first attempt counts; joined only after a wrong try does
      // not, and neither does a pair left unjoined when the round was ended.
      results: pairs.map(p => ({ id: idOf(p), ok: done.has(p.id) && !erred.has(p.id) })),
    });
  }

  /* Lines are measured in pixels, so they must be redrawn whenever the board
     changes size — a phone rotating, or the transliteration line appearing. */
  let lastW = 0, lastH = 0, raf = 0;
  const ro = new ResizeObserver((entries) => {
    const r = entries[0]?.contentRect;
    if (!r) return;
    // Only redraw when the box genuinely changed size, and defer to the next
    // frame. Both guards exist to stop a redraw from provoking another one.
    if (Math.abs(r.width - lastW) < 1 && Math.abs(r.height - lastH) < 1) return;
    lastW = r.width; lastH = r.height;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawLines);
  });
  ro.observe(wrap);
  window.addEventListener('resize', drawLines, { signal });

  paint();
  // Positions are only final after layout settles and the fonts swap in.
  const settle = setTimeout(drawLines, 120);
  timers.add(settle);
  if (document.fonts?.ready) document.fonts.ready.then(drawLines).catch(() => {});

  return {
    destroy() {
      ro.disconnect();
      cancelAnimationFrame(raf);
      for (const tm of timers) clearTimeout(tm);
      timers.clear();
    },
    refresh: paint,
  };
}
