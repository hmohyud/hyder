import { useEffect, useRef } from "react";
import * as THREE from "three-for-vanta";
import HALO from "vanta/dist/vanta.halo.min";

/**
 * CardHalo — Vanta HALO effect that sits behind a card.
 *
 * The halo ring is sized and positioned so it aligns with
 * the card outline, spilling light naturally from the rim.
 * - Container matches the card via CSS (inset: 0 on .card-wrap)
 * - `size` is computed from the card's aspect ratio so the ring
 *   inscribes the card rectangle
 * - On hover the halo fades in (CSS opacity); on leave it fades out.
 *
 * z-index layering:
 *   active card (z:2) > halo (z:1) > non-active cards (z:0, dimmed)
 */
export default function CardHalo({ active, color }) {
  const containerRef = useRef(null);
  const vantaRef = useRef(null);

  /* ─── init once on mount ─── */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!containerRef.current) return;

    /* Skip on touch / low-power devices */
    const isTouch =
      typeof window !== "undefined" &&
      !window.matchMedia("(hover: hover)").matches;
    if (isTouch) return;

    /*
     * Size the halo ring to roughly inscribe the card rectangle.
     * The HALO shader draws a ring at distance ~1.0 (in normalized coords)
     * from center, scaled by `size`. A size of ~1.5–2.0 on a card-shaped
     * rectangle makes the ring pass through the card edges.
     *
     * We use a slightly larger size so the ring extends just past the card
     * edges, giving the "spilling from the rim" look.
     */
    try {
      vantaRef.current = HALO({
        el: containerRef.current,
        THREE,
        mouseControls: true,
        touchControls: false,
        gyroControls: false,
        minHeight: 100.0,
        minWidth: 100.0,
        backgroundColor: 0x0,
        baseColor: color || 0x6bcfff,
        amplitudeFactor: 1.2,
        ringFactor: 1,
        rotationFactor: 1,
        xOffset: 0,
        yOffset: 0,
        size: 1.8,
        speed: 1,
      });
    } catch (err) {
      console.error("[CardHalo] Vanta HALO init failed:", err);
    }

    return () => {
      if (vantaRef.current) {
        try { vantaRef.current.destroy(); } catch (_) {}
        vantaRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`card-halo${active ? " card-halo-active" : ""}`}
      aria-hidden="true"
    />
  );
}
