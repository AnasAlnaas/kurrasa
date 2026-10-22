/* =========================================================================
   Icons — margin marks, drawn as if with the same pen as the rest of the book.

   Rules, so these stay on-direction (see DIRECTION.md):
   · Open strokes only. No fills, no containers, no rounded squares.
   · currentColor, so they inherit ink and correction red for free.
   · Coordinates are deliberately a little off-true — a hand does not draw
     a perfect arc, and the wobble is what stops these reading as clip-art.
   · Each mark depicts its own exercise. Nothing generic, nothing borrowed:
     the Sira mark is a winding path because سِيرَة means the way one goes,
     and the verb mark is a sprouting root because جَذْر is literally a root.

   A dot is a zero-length segment with a round cap — "M12 18 L12 18.01".
   ========================================================================= */

const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  /* A bāʾ-like bowl with its dot below — the first thing anyone learns to
     tell apart is which letter carries which dots. */
  letters: [
    'M4.4 8.6 C4.1 14.6 19.9 15.1 19.7 8.4',
    'M12 18.4 L12 18.41',
  ],

  /* Two letter-tiles set down, a third still being carried in. */
  build: [
    'M2.9 12.6 L9.2 13.1 L8.7 19.4 L2.6 18.8 Z',
    'M10.6 13.2 L16.8 12.6 L17.3 18.9 L11.1 19.5 Z',
    'M15.4 4.8 L21.6 6.3 L20.1 12.3 L14 10.7 Z',
  ],

  /* The board with a word traced across it — the exercise's own gesture.
     A pencil lasso was tried twice: over ruled lines it read as a hash with a
     slash, and over dots it read as an orbit. A straight trace through a
     bounded grid is unambiguous at margin size. */
  search: [
    'M3.6 3.5 H20.4 V20.5 H3.5 Z',
    'M9.3 3.6 V20.4  M14.9 3.5 V20.5',
    'M3.5 9.3 H20.5  M3.6 14.9 H20.4',
    'M6.3 6.2 L17.7 17.8',
  ],

  /* Two ways of pointing at one idea, about the axis they mirror across.
     The centre mark is what stops this reading as a generic resize handle. */
  opposites: [
    'M3.1 12.1 H20.9',
    'M6.6 8.3 L3.1 12.1 L6.7 15.8',
    'M17.4 8.4 L20.9 12 L17.3 15.7',
    'M12 7.4 V16.7',
  ],

  /* A trilateral root, sprouting into the forms grown from it. Roots drawn as
     tendrils rather than dots — at margin size a dot vanishes and the mark
     collapses into a bare Y. */
  verbs: [
    'M12 19.1 V9.4',
    'M11.9 12.5 C11.6 9.5 8.1 8.8 6.5 6.1',
    'M12.1 11.3 C12.4 8.2 15.9 7.4 17.4 4.8',
    'M12 19.1 C10.7 20 9.3 20.3 8.1 21.7',
    'M12 19.1 C13.3 20 14.7 20.3 15.9 21.7',
  ],

  /* A nib on the ruled line, mid-stroke. */
  typing: [
    'M14.3 3.8 L19.4 8.9 L11.2 17.2 L8.4 17.9 L9.1 15.1 Z',
    'M12.6 5.6 L17.6 10.6',
    'M2.9 21.1 C7 20.6 16 21.5 21.1 20.9',
  ],

  /* An isnād — the chain of people a story is carried by, which is what the
     Companions are to the Sira. Not a mosque silhouette, which is the cliché
     every Islamic app reaches for. Footprints were tried and read as rain. */
  sira: [
    'M2.6 12 a 3.7 3.7 0 1 0 7.4 0 a 3.7 3.7 0 1 0 -7.4 0',
    'M8.4 12.1 a 3.7 3.7 0 1 0 7.4 0 a 3.7 3.7 0 1 0 -7.4 0',
    'M14.1 11.9 a 3.7 3.7 0 1 0 7.4 0 a 3.7 3.7 0 1 0 -7.4 0',
  ],

  /* Sound carried outward — length and nasality are the whole subject. */
  tajweed: [
    'M8.6 8.2 C11.4 10.3 11.5 13.9 8.5 16.1',
    'M13 5.9 C17.3 9.4 17.4 14.7 12.9 18.3',
    'M17.4 4.1 C23 8.6 23.1 15.6 17.3 20.2',
  ],

  /* --- Header controls. Same pen, smaller hand. ------------------------- */

  /* Auto: the disc half in light, half hatched in shade. */
  'theme-auto': [
    'M12 3.5 C16.7 3.5 20.5 7.3 20.5 12 C20.5 16.7 16.7 20.5 12 20.5 C7.3 20.5 3.5 16.7 3.5 12 C3.5 7.3 7.3 3.5 12 3.5 Z',
    'M12 3.6 V20.4',
    'M13.7 6.6 L17.9 10.8  M13.7 10.4 L17.5 14.2  M13.7 14.2 L16.1 16.6',
  ],
  'theme-light': [
    'M12 7.4 C14.6 7.4 16.6 9.5 16.6 12 C16.6 14.6 14.5 16.6 12 16.6 C9.4 16.6 7.4 14.5 7.4 12 C7.4 9.4 9.5 7.4 12 7.4 Z',
    'M12 2.4 V4.3  M12 19.7 V21.6  M2.4 12 H4.3  M19.7 12 H21.6',
    'M5.3 5.2 L6.7 6.6  M17.4 17.3 L18.8 18.8  M18.8 5.2 L17.4 6.6  M6.7 17.3 L5.3 18.8',
  ],
  'theme-dark': [
    'M20.2 14.7 C19 15.3 17.6 15.6 16.2 15.6 C11.2 15.6 7.2 11.5 7.2 6.6 C7.2 5.7 7.3 4.8 7.6 4 C4.5 5.5 2.4 8.6 2.4 12.2 C2.4 17.3 6.5 21.4 11.6 21.4 C15.4 21.4 18.7 19.1 20.2 14.7 Z',
  ],

  'audio-on': [
    'M4.4 9.6 H7.6 L11.4 6.2 V17.8 L7.6 14.4 H4.4 Z',
    'M14.4 9.4 C15.9 10.7 15.9 13.3 14.4 14.6',
    'M17.1 7 C19.7 9.2 19.7 14.8 17.1 17',
  ],
  'audio-off': [
    'M4.4 9.6 H7.6 L11.4 6.2 V17.8 L7.6 14.4 H4.4 Z',
    'M14.8 9.8 L19.6 14.3',
    'M19.6 9.8 L14.8 14.3',
  ],

  /* Events pegged along a line, unevenly, the way they actually fell. */
  timeline: [
    'M2.8 12.2 C8 11.8 15 12.5 21.2 12',
    'M6.2 12.1 L6.2 12.11  M11.6 12.2 L11.6 12.21  M17.1 12.1 L17.1 12.11',
    'M6.2 9.4 V7.1  M11.6 15 V17.4  M17.1 9.3 V7',
  ],
};

/**
 * Build one margin mark. Decorative — the exercise name always sits beside it,
 * so it is hidden from assistive tech rather than labelled twice.
 */
export function icon(name, { size = 20, className = 'mark-ink' } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', size >= 40 ? '1.3' : '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);

  for (const d of PATHS[name] || []) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

export const hasIcon = (name) => Object.hasOwn(PATHS, name);
