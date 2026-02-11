import { useEffect, useRef } from "react";

/**
 * Variant B — "Rising Embers"
 * Particles gently float upward at varying speeds like embers/sparks,
 * drifting sideways with subtle sine-wave oscillation. Mouse creates
 * a warm updraft that accelerates nearby particles. No trails.
 */
export default function BgVariantB() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let W, H, dpr;
    let mouse = { x: -9999, y: -9999 };
    const DENSITY = 0.0008; // particles per square pixel
    const MOUSE_RADIUS = 180;

    const COLORS = [
      [255, 114, 161],
      [180, 139, 255],
      [127, 211, 255],
      [120, 255, 168],
      [200, 210, 235],
      [200, 210, 235],
    ];

    let particles = [];
    let time = 0;

    const initParticle = (startRandom) => {
      const c = COLORS[Math.floor(Math.random() * COLORS.length)];
      return {
        x: Math.random() * (W || 1920),
        y: startRandom ? Math.random() * (H || 1080) : (H || 1080) + Math.random() * 100,
        vx: 0,
        vy: -(0.08 + Math.random() * 0.3),
        size: 0.4 + Math.random() * 1.4,
        r: c[0], g: c[1], b: c[2],
        alpha: 0.08 + Math.random() * 0.25,
        drift: (Math.random() - 0.5) * 0.15,
        sineAmp: 10 + Math.random() * 30,
        sineFreq: 0.005 + Math.random() * 0.01,
        sineOff: Math.random() * Math.PI * 2,
        baseX: 0,
      };
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = [];
      const count = Math.round(W * H * DENSITY);
      for (let i = 0; i < count; i++) {
        const p = initParticle(true);
        p.baseX = p.x;
        particles.push(p);
      }
    };
    resize();
    window.addEventListener("resize", resize);

    const onMove = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    window.addEventListener("mousemove", onMove);

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      time += 0.016;

      for (const p of particles) {
        // Gentle drift
        p.baseX += p.drift;
        p.y += p.vy;

        // Sine oscillation
        const sx = Math.sin(p.y * p.sineFreq + p.sineOff) * p.sineAmp;
        const drawX = p.baseX + sx;

        // Mouse updraft — particles near cursor rise faster
        const mdx = drawX - mouse.x;
        const mdy = p.y - mouse.y;
        const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
        let extraVy = 0;
        let extraVx = 0;
        if (mdist < MOUSE_RADIUS && mdist > 0) {
          const f = (1 - mdist / MOUSE_RADIUS);
          extraVy = -f * 1.0; // updraft
          extraVx = (mdx / mdist) * f * 0.3; // slight scatter
        }
        p.y += extraVy;
        p.baseX += extraVx;

        // Respawn at bottom
        if (p.y < -20) {
          p.y = H + 20;
          p.baseX = Math.random() * W;
        }
        if (p.baseX < -40) p.baseX = W + 40;
        if (p.baseX > W + 40) p.baseX = -40;

        // Fade near top and bottom
        const fadeTop = Math.min(1, p.y / 100);
        const fadeBot = Math.min(1, (H - p.y) / 100);
        const a = p.alpha * fadeTop * fadeBot;

        ctx.beginPath();
        ctx.arc(drawX, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${a})`;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <canvas ref={canvasRef}
      style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }} />
  );
}
