import { useEffect, useRef } from "react";

export default function LiquidBackground() {
  const canvasRef = useRef(null);
  const appRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    import("threejs-components/build/backgrounds/liquid1.min.js").then(
      (mod) => {
        if (cancelled || !canvasRef.current) return;

        const LiquidBg = mod.default;
        const app = LiquidBg(canvas);

        app.loadImage(process.env.PUBLIC_URL + "/liquid-bg.png");
        app.liquidPlane.material.metalness = 0.85;
        app.liquidPlane.material.roughness = 0.15;
        app.liquidPlane.uniforms.displacementScale.value = 8;
        app.setRain(false);

        // Tint the material so the ripples catch light with a cool blue tone
        app.liquidPlane.material.color.set(0x88aacc);

        appRef.current = app;
      }
    );

    return () => {
      cancelled = true;
      if (appRef.current && typeof appRef.current.dispose === "function") {
        appRef.current.dispose();
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
      }}
    />
  );
}
