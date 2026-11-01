import { useEffect } from "react";

/* The dot fill after the mission's text: the ::after of .mission-text (see
   Landing.css) is a lattice of dots clipped to the empty tail of every line
   and to every empty row, so the paragraph reads as a filled block. The
   tail starts wherever the text happens to end, so its grid phase is
   arbitrary - measured here from the browser's own line boxes and corrected
   with CSS variables, so the dot columns coincide with the lattice below.
   Shared by both landings. */
export function useMissionDots(moreOpen) {
  useEffect(() => {
    const compute = () => {
      const col = document.querySelector(".mission-text");
      if (!col) return;
      /* lattice pitch == the text's line-height, read from the type itself -
         dot rows share the text's rhythm by construction */
      const P = Math.round(parseFloat(getComputedStyle(col).lineHeight)) || 22;
      const colRect = col.getBoundingClientRect();
      /* the pseudo's width/height resolve in LAYOUT px, but client rects are
         in VISUAL px - scaled by any ancestor transform (the entrance
         animations run exactly when this computes, and ResizeObserver never
         re-fires for transform changes, so scaled readings would freeze in
         short). offsetWidth/Height are transform-immune layout truth; the
         ratio converts every rect-derived coordinate back to layout space. */
      const LW = col.offsetWidth;
      const LH = col.offsetHeight;
      if (!LW || !LH) return;
      const sx = colRect.width / LW || 1;
      const sy = colRect.height / LH || 1;
      /* horizontal pitch: stretched a hair (at most ~0.6px off the 22px
         vertical pitch, imperceptible) so a whole number of dot columns
         spans the text column edge to edge - first centre P/2 in from the
         left, last centre P/2 in from the right, at EVERY width. A fixed
         22px pitch left up to a stranded ~20px bare margin whenever the
         column width's remainder fell mid-tile (which it permanently does
         once the hero hits its max content width). */
      const W = Math.max(P * 2, LW);
      const cols = Math.max(2, Math.round((W - P) / P) + 1);
      const PX = (W - P) / (cols - 1);
      /* height still CEILs to whole rows - the slight overhang reads well */
      const H = Math.max(P, Math.ceil(LH / P) * P);
      const rows = H / P;
      /* each row's text-end, measured from the browser's own line boxes
         (Range.getClientRects covers text and the inline toggle alike) - x
         and y always describe the same boxes, so dots-behind-text cannot
         happen on any line, wrapped toggles included */
      const copy = document.querySelector(".mission-copy");
      const ends = new Array(rows).fill(-1);
      if (copy) {
        const range = document.createRange();
        range.selectNodeContents(copy);
        const boxes = Array.from(range.getClientRects());
        const btn = document.querySelector(".mission-toggle");
        if (btn) boxes.push(btn.getBoundingClientRect());
        for (let i = 0; i < boxes.length; i++) {
          const r = boxes[i];
          if (r.width <= 0 || r.height <= 0) continue;
          const row = Math.floor((r.top + r.height / 2 - colRect.top) / sy / P);
          if (row < 0 || row >= rows) continue;
          const endX = (r.right - colRect.left) / sx;
          if (endX > ends[row]) ends[row] = endX;
        }
      }
      /* a row's first dot needs half a pitch of clearance after the glyphs
         (centre at P/2 + k*PX, so first k with centre >= end + P/2); rows
         with no text fill from the left edge, rows past the last column get
         none */
      const xs = ends.map((e) => {
        if (e < 0) return 0;
        const k = Math.ceil(e / PX);
        if (k > cols - 1) return W;
        return P / 2 + k * PX - PX / 2;
      });
      const pts = [];
      for (let i = 0; i < rows; i++) {
        pts.push(`${xs[i]}px ${i * P}px`, `${xs[i]}px ${(i + 1) * P}px`);
      }
      pts.push(`${W}px ${H}px`, `${W}px 0px`);
      col.style.setProperty("--dg-w", `${W}px`);
      col.style.setProperty("--dg-px", `${PX}px`);
      /* shift the tiles so each tile's gradient centre lands on P/2 + k*PX */
      col.style.setProperty("--dg-ox", `${(P - PX) / 2}px`);
      col.style.setProperty("--dg-h", `${H}px`);
      col.style.setProperty("--dg-clip", `polygon(${pts.join(", ")})`);
    };
    compute();
    /* event-driven, not timer-guessed: late font swaps and any reflow of the
       column change where the text ends, and a stale phase misaligns the
       lattice by up to half a tile. The double-rAF re-measures once the first
       real paint has settled - initial mount measures a not-quite-final line. */
    requestAnimationFrame(() => requestAnimationFrame(compute));
    window.addEventListener("load", compute, { once: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(compute);
    /* The one case events cannot see: the line's END moves without any
       element's SIZE changing (late canvas mount in the slot, a scrollbar
       appearing). Idempotent, so a few staggered retries are free. */
    const retries = [250, 800, 2000].map((ms) => setTimeout(compute, ms));
    let ro = null;
    const col = document.querySelector(".mission-text");
    if (window.ResizeObserver && col) {
      ro = new ResizeObserver(compute);
      ro.observe(col);
    }
    window.addEventListener("resize", compute);
    return () => {
      if (ro) ro.disconnect();
      retries.forEach(clearTimeout);
      window.removeEventListener("resize", compute);
    };
  }, [moreOpen]);
}
