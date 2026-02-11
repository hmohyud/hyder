import { useEffect, useRef } from "react";

const CARD_COLORS = {
  1: { colors: ["#ff72a1", "#ffb8d0", "#ff6b9d"], lights: ["#ff72a1", "#ffb8d0", "#ff6b9d", "#ff9dbe"] },
  2: { colors: ["#b48bff", "#92a2ff", "#a36bff"], lights: ["#b48bff", "#92a2ff", "#a36bff", "#c4aaff"] },
  3: { colors: ["#7fd3ff", "#9fe1ff", "#6bcfff"], lights: ["#7fd3ff", "#9fe1ff", "#6bcfff", "#b8ecff"] },
  4: { colors: ["#78ffa8", "#c7ffd8", "#6bff9d"], lights: ["#78ffa8", "#c7ffd8", "#6bff9d", "#a8ffc4"] },
};

const DEFAULT_COLORS = ["#ff6b9d", "#a36bff", "#6bcfff", "#6bff9d"];
const DEFAULT_LIGHTS = ["#ff6b9d", "#a36bff", "#6bcfff", "#6bff9d"];

export default function TubesCursorOverlay({ hoveredCard }) {
  // Disabled — remove this line to re-enable the cursor effect
  return null;

  const canvasRef = useRef(null);
  const appRef = useRef(null);
  const isTouch = !window.matchMedia("(hover: hover)").matches;

  useEffect(() => {
    if (isTouch) return;

    let cancelled = false;

    import("threejs-components/build/cursors/tubes1.min.js").then((mod) => {
      if (cancelled || !canvasRef.current) return;
      const TubesCursor = mod.default;
      appRef.current = TubesCursor(canvasRef.current, {
        tubes: {
          count: 12,
          minRadius: 0.003,
          maxRadius: 0.025,
          lerp: 0.45,
          noise: 0.006,
          colors: DEFAULT_COLORS,
          lights: {
            intensity: 0,
            colors: DEFAULT_LIGHTS,
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (appRef.current && typeof appRef.current.dispose === "function") {
        appRef.current.dispose();
      }
    };
  }, []);

  // React to card hover changes
  useEffect(() => {
    const app = appRef.current;
    if (!app || !app.tubes) return;

    if (hoveredCard && CARD_COLORS[hoveredCard]) {
      const c = CARD_COLORS[hoveredCard];
      app.tubes.setColors(c.colors);
      app.tubes.setLightsColors(c.lights);
    } else {
      app.tubes.setColors(DEFAULT_COLORS);
      app.tubes.setLightsColors(DEFAULT_LIGHTS);
    }
  }, [hoveredCard]);

  if (isTouch) return null;

  const isHovering = !!hoveredCard;

  return (
    <canvas
      ref={canvasRef}
      className={`tubes-cursor-canvas${isHovering ? " tubes-active" : ""}`}
      aria-hidden="true"
    />
  );
}
