/* =========================================================================
   Engine: wordsearch — trace hidden words in a letter grid

   Two decisions that make this work for Arabic, both deliberate:

   1. Words are only ever PLACED in reading directions — right-to-left and
      downward. Reversed placement would ask the learner to read Arabic
      backwards, which teaches the wrong reflex. The player may still TRACE
      in either direction, because that is only a pointer gesture.

   2. Grid cells hold bare, unvocalised letters in their ISOLATED shapes,
      while the word list shows the same words joined and fully vowelled.
      Mapping between the two is the harder half of learning to read Arabic,
      so it is the point of the exercise rather than a bug — and it is said
      out loud in the exercise's how-to text.

   Contract: mount(root, pack, ctx) -> { destroy, refresh }
   ========================================================================= */

/* Weighted by rough frequency in Arabic text, so filler does not look
   obviously synthetic next to the real words. */
const FILLER =
  'االااااللللللممموووييينننررههههببتتتععدددسسففققححككججشششصصططزخضثذظغ';

/* dr, dc. Column 0 is the RIGHT-hand column (the grid is dir="rtl"), so
   dc:+1 travels leftward across the page — the natural reading direction. */
const DIRS_STRAIGHT = [
  { dr: 0, dc: 1 },   // right-to-left
  { dr: 1, dc: 0 },   // downward
];
const DIRS_DIAGONAL = [
  { dr: 1, dc: 1 },   // down and leftward
  { dr: 1, dc: -1 },  // down and rightward
];

const randInt = (n) => Math.floor(Math.random() * n);

function buildGrid(size, words, allowDiagonal) {
  const dirs = allowDiagonal ? [...DIRS_STRAIGHT, ...DIRS_DIAGONAL] : DIRS_STRAIGHT;
  const grid = Array.from({ length: size }, () => Array(size).fill(null));
  const placed = [];

  // Longest first — long words are the hardest to fit once the grid fills.
  const queue = [...words].sort((a, b) => b.letters.length - a.letters.length);

  for (const word of queue) {
    const len = word.letters.length;
    if (len > size) continue;                       // cannot fit at all
    let done = false;

    for (let attempt = 0; attempt < 300 && !done; attempt++) {
      const dir = dirs[randInt(dirs.length)];
      const maxR = dir.dr > 0 ? size - len : size - 1;
      const minR = 0;
      const maxC = dir.dc > 0 ? size - len : size - 1;
      const minC = dir.dc < 0 ? len - 1 : 0;
      if (maxR < minR || maxC < minC) continue;

      const r0 = minR + randInt(maxR - minR + 1);
      const c0 = minC + randInt(maxC - minC + 1);

      let fits = true;
      for (let i = 0; i < len; i++) {
        const r = r0 + dir.dr * i, c = c0 + dir.dc * i;
        const cell = grid[r][c];
        if (cell !== null && cell !== word.letters[i]) { fits = false; break; }
      }
      if (!fits) continue;

      const cells = [];
      for (let i = 0; i < len; i++) {
        const r = r0 + dir.dr * i, c = c0 + dir.dc * i;
        grid[r][c] = word.letters[i];
        cells.push(`${r},${c}`);
      }
      placed.push({ ...word, cells });
      done = true;
    }
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === null) grid[r][c] = FILLER[randInt(FILLER.length)];
    }
  }
  return { grid, placed };
}

/** Cells along a straight line between two points, or null if not straight. */
function pathBetween(a, b) {
  const dr = Math.sign(b.r - a.r), dc = Math.sign(b.c - a.c);
  const lenR = Math.abs(b.r - a.r), lenC = Math.abs(b.c - a.c);
  if (lenR !== 0 && lenC !== 0 && lenR !== lenC) return null;   // not straight
  const steps = Math.max(lenR, lenC);
  const out = [];
  for (let i = 0; i <= steps; i++) out.push({ r: a.r + dr * i, c: a.c + dc * i });
  return out;
}

export function mount(root, pack, ctx) {
  const { el, t, tx, ar, sound, announce, level, signal } = ctx;

  const pool = pack.rounds.filter(r => (r.d ?? 1) === level);
  // ctx.draw remembers which boards were served, so replaying a level cycles
  // through its themes instead of landing on the same grid again.
  // The drawn unit here is a whole board, not a word, so that is what gets
  // remembered: a board counts as answered only when every word on it was
  // found. Leave one word unfound and the board comes back as review.
  const idOf = (r) => r.theme?.en ?? r.words?.map(w => w.ar).join(',');
  const round = ctx.draw(pool.length ? pool : pack.rounds, 1, idOf)[0];
  const size = round.size || 9;

  // Grid letters are bare: harakat stripped and hamza forms folded, so the
  // learner searches for shapes rather than for vowelling.
  const words = round.words.map(w => ({
    ...w,
    letters: ar.letters(ar.normalize(w.ar)),
  })).filter(w => w.letters.length >= 2);

  const { grid, placed } = buildGrid(size, words, round.allowDiagonal !== false);

  // word.ar -> the cells the player actually traced. Keyed by traced cells
  // rather than by the canonical placement because filler letters can spell a
  // listed word somewhere else by chance; refusing that trace would look broken.
  const found = new Map();
  const revealed = new Set();       // word.ar of words given away
  const startedAt = performance.now();
  let anchor = null, hover = null, dragging = false;

  /* --- DOM ------------------------------------------------------------- */
  const cellEls = new Map();
  const gridEl = el('div', {
    class: 'ws-grid',
    style: `grid-template-columns: repeat(${size}, 1fr)`,
    role: 'grid', lang: 'ar', dir: 'rtl',
  });
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = el('div', {
        class: 'ws-cell', role: 'gridcell',
        dataset: { r: String(r), c: String(c) },
      }, grid[r][c]);
      cellEls.set(`${r},${c}`, cell);
      gridEl.append(cell);
    }
  }

  const listEl = el('div', { class: 'ws-list' });
  const counter = el('span', {});
  const tally = el('span', { class: 'tally' });
  const revealBtn = el('button', { class: 'btn btn-ghost', type: 'button', onclick: reveal },
    t('ws_reveal'));

  root.replaceChildren(
    el('a', { class: 'back', href: '#/' }, t('back')),
    el('div', { class: 'sheet-head' }, counter, tally),
    el('div', { class: 'ws-wrap' },
      gridEl,
      el('div', {},
        el('div', { class: 'section-rule' }, tx(round.theme)),
        listEl,
        el('div', { class: 'btn-row' }, revealBtn),
      ),
    ),
    el('a', { class: 'back back-bottom', href: '#/' }, t('back')),
  );

  /* --- render ---------------------------------------------------------- */
  function paint() {
    counter.textContent = t('ws_find');
    tally.textContent = `${found.size} / ${placed.length}`;

    const picking = new Set(
      (anchor && hover ? (pathBetween(anchor, hover) || []) : []).map(p => `${p.r},${p.c}`),
    );
    const settled = new Set();
    for (const w of placed) {
      if (found.has(w.ar)) found.get(w.ar).forEach(k => settled.add(k));
      else if (revealed.has(w.ar)) w.cells.forEach(k => settled.add(k));
    }

    for (const [key, node] of cellEls) {
      node.classList.toggle('is-picking', picking.has(key) && !settled.has(key));
      node.classList.toggle('is-found', settled.has(key));
    }

    listEl.replaceChildren(...placed.map(w => {
      const done = found.has(w.ar) || revealed.has(w.ar);
      return el('div', { class: `ws-word ${done ? 'is-done' : ''}`.trim() },
        el('span', { class: 'w-ar', lang: 'ar', dir: 'rtl' },
          ctx.settings.tashkeel ? w.ar : ar.stripTashkeel(w.ar)),
        w.tr ? el('span', { class: 'tr' }, w.tr) : null,
        w.en ? el('span', { class: 'w-en' }, w.en) : null,
      );
    }));

    revealBtn.disabled = found.size + revealed.size >= placed.length;
  }

  /* --- tracing --------------------------------------------------------- */
  /**
   * Resolve a viewport point to a cell from the grid's own geometry.
   *
   * Deliberately not document.elementFromPoint: that returns null for any
   * point outside the visible viewport, so a grid taller than the screen
   * becomes untraceable below the fold — which is most phones on the larger
   * boards. Geometry also avoids a hit-test on every pointermove.
   *
   * Coordinates are clamped rather than rejected, so a finger that strays off
   * the edge mid-drag extends the selection to the edge instead of dropping it.
   */
  function cellAt(x, y) {
    const rect = gridEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const cw = rect.width / size, ch = rect.height / size;
    const clamp = (v) => Math.min(size - 1, Math.max(0, v));

    const r = clamp(Math.floor((y - rect.top) / ch));
    // The grid is dir="rtl", so DOM column 0 is the RIGHTMOST column.
    const fromLeft = clamp(Math.floor((x - rect.left) / cw));
    return { r, c: size - 1 - fromLeft };
  }

  function commit() {
    if (!anchor || !hover) return;
    const path = pathBetween(anchor, hover);
    anchor = hover = null;

    if (!path || path.length < 2) { paint(); return; }
    const keys = path.map(p => `${p.r},${p.c}`);
    const letters = path.map(p => grid[p.r][p.c]);
    const forward = letters.join('');
    const backward = [...letters].reverse().join('');

    // Matched on the letters traced, in either direction. Tracing backwards is
    // only a pointer gesture — it says nothing about how the word is read.
    const hit = placed.find(w => !found.has(w.ar) && !revealed.has(w.ar)
      && (w.letters.join('') === forward || w.letters.join('') === backward));

    if (hit) {
      found.set(hit.ar, keys);
      sound.ok();
      announce(`${hit.ar} — ${hit.en ?? ''}`);
      if (found.size + revealed.size >= placed.length) return finish();
    } else {
      sound.no();
    }
    paint();
  }

  function reveal() {
    const next = placed.find(w => !found.has(w.ar) && !revealed.has(w.ar));
    if (!next) return;
    revealed.add(next.ar);
    announce(`${next.ar} — ${next.en ?? ''}`);
    if (found.size + revealed.size >= placed.length) return finish();
    paint();
  }

  function finish() {
    paint();
    ctx.finish({
      correct: found.size,
      total: placed.length,
      elapsedMs: performance.now() - startedAt,
      results: [{ id: idOf(round), ok: found.size === placed.length }],
      missed: placed.filter(w => revealed.has(w.ar)).map(w => ({
        question: tx(round.theme),
        correct: [w.ar, w.tr, w.en].filter(Boolean).join(' · '),
        chosen: null,
      })),
    });
  }

  gridEl.addEventListener('pointerdown', (e) => {
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    // Capture keeps the drag alive if the finger leaves the grid, but throws
    // if the pointer is already gone. Losing capture is survivable; throwing
    // here would kill the gesture entirely.
    try { gridEl.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
    if (anchor && !dragging) { hover = cell; commit(); return; }  // tap-tap
    anchor = cell; hover = cell; dragging = true;
    paint();
  }, { signal });

  gridEl.addEventListener('pointermove', (e) => {
    if (!dragging || !anchor) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell || (hover && cell.r === hover.r && cell.c === hover.c)) return;
    hover = cell;
    paint();
  }, { signal });

  gridEl.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    try { gridEl.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    // A tap that never moved leaves the anchor set, so the player can tap
    // the other end instead of dragging.
    if (anchor && hover && anchor.r === hover.r && anchor.c === hover.c) { paint(); return; }
    commit();
  }, { signal });

  gridEl.addEventListener('pointercancel', () => {
    dragging = false; anchor = hover = null; paint();
  }, { signal });

  paint();

  return { destroy() {}, refresh: paint };
}
