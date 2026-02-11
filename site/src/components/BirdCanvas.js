import { useEffect, useRef } from "react";
// Use Three.js r134 specifically for Vanta compatibility
// (main 'three' package is r182, which removed APIs Vanta needs)
import * as THREE from "three-for-vanta";
import WAVES from "vanta/dist/vanta.waves.min";

/**
 * Attaches Vanta WAVES effect to the landing page container.
 */
export default function BirdCanvas({ landingRef }) {
  const vantaRef = useRef(null);

  /* ─── disable on touch devices ─── */
  const isTouch =
    typeof window !== "undefined" &&
    !window.matchMedia("(hover: hover)").matches;

  /* ─── init Vanta WAVES effect ─── */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isTouch) return;
    if (!landingRef?.current) return;

    try {
      vantaRef.current = WAVES({
        el: landingRef.current,
        THREE,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        minHeight: 200.0,
        minWidth: 200.0,
        scale: 1.0,
        scaleMobile: 1.0,
        color: 0x0,
        shininess: 10.0,
        waveHeight: 40.0,
        waveSpeed: 0.25,
        zoom: 0.65,
      });
    } catch (err) {
      console.error("[BirdCanvas] Vanta WAVES init failed:", err);
    }

    return () => {
      if (vantaRef.current) {
        vantaRef.current.destroy();
        vantaRef.current = null;
      }
    };
  }, []);

  return null;
}
