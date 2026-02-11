import { useEffect, useRef } from "react";

/**
 * Variant B — "Rising Embers"
 * Particles gently float upward with sine-wave drift.
 *
 * Features:
 * - Mouse updraft on hover
 * - Card magnetism: when a card is hovered, nearby particles drift toward it
 * - Click-hold gravity well: hold mouse on background to attract particles,
 *   release to toss them outward based on accumulated velocity
 *
 * Props:
 *   magnetTarget — ref to the DOM element particles should magnetize toward (or null)
 */
export default function BgVariantB({ magnetTarget, magnetCardId }) {
  const canvasRef = useRef(null);
  const magnetTargetRef = useRef(null);
  const magnetCardIdRef = useRef(null);

  // Keep magnetTarget in a ref so the rAF loop can read it without re-running useEffect
  useEffect(() => {
    magnetTargetRef.current = magnetTarget;
    magnetCardIdRef.current = magnetCardId;
  }, [magnetTarget, magnetCardId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let W, H, dpr;
    let mouse = { x: -9999, y: -9999 };
    const DENSITY = 0.0008;
    const MOUSE_RADIUS = 180;
    const MAGNET_RADIUS = 700;
    const MAGNET_FORCE = 2.2;

    // Card accent colors keyed by card ID
    const CARD_COLORS = {
      1: [255, 114, 161],  // pink  — Skills
      2: [180, 139, 255],  // purple — Projects
      3: [127, 211, 255],  // blue  — About
      4: [120, 255, 168],  // green — Resume
    };

    // Gravity well state
    let wellActive = false;
    let wellX = 0, wellY = 0;
    let wellStartTime = 0;
    // Track mouse velocity for toss
    let prevMouse = { x: 0, y: 0, t: 0 };
    let mouseVel = { x: 0, y: 0 };

    const COLORS = [
      [255, 114, 161],
      [180, 139, 255],
      [127, 211, 255],
      [120, 255, 168],
      [200, 210, 235],
      [200, 210, 235],
    ];

    let particles = [];

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
        // Extra velocity for gravity well toss
        tvx: 0,
        tvy: 0,
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

    const onMove = (e) => {
      const now = performance.now();
      const dt = now - prevMouse.t;
      if (dt > 0) {
        mouseVel.x = (e.clientX - prevMouse.x) / Math.max(dt, 1) * 16;
        mouseVel.y = (e.clientY - prevMouse.y) / Math.max(dt, 1) * 16;
      }
      prevMouse.x = e.clientX;
      prevMouse.y = e.clientY;
      prevMouse.t = now;

      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (wellActive) {
        wellX = e.clientX;
        wellY = e.clientY;
      }
    };
    window.addEventListener("mousemove", onMove);

    // Click-hold gravity well
    const onDown = (e) => {
      // Only activate on the canvas / background area (not cards)
      if (e.target === canvas || (e.target.closest('.landing') && !e.target.closest('.card') && !e.target.closest('.hero'))) {
        wellActive = true;
        wellX = e.clientX;
        wellY = e.clientY;
        wellStartTime = performance.now();
        mouseVel.x = 0;
        mouseVel.y = 0;
      }
    };
    const onUp = () => {
      if (!wellActive) return;
      wellActive = false;

      // Toss: apply velocity burst to particles near the well
      const TOSS_RADIUS = 250;
      const tossStrength = Math.min(
        12,
        Math.sqrt(mouseVel.x * mouseVel.x + mouseVel.y * mouseVel.y) * 1.5
      );

      for (const p of particles) {
        const sx = Math.sin(p.y * p.sineFreq + p.sineOff) * p.sineAmp;
        const drawX = p.baseX + sx;
        const dx = drawX - wellX;
        const dy = p.y - wellY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < TOSS_RADIUS && dist > 0) {
          const f = (1 - dist / TOSS_RADIUS);
          if (tossStrength > 1) {
            // Directional toss based on mouse velocity
            p.tvx += mouseVel.x * f * 0.8;
            p.tvy += mouseVel.y * f * 0.8;
          } else {
            // No velocity — just scatter outward
            p.tvx += (dx / dist) * 4 * f;
            p.tvy += (dy / dist) * 4 * f;
          }
        }
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // Read magnet target rect
      let magnetRect = null;
      const target = magnetTargetRef.current;
      if (target && target.getBoundingClientRect) {
        magnetRect = target.getBoundingClientRect();
      }

      // Gravity well strength ramps up the longer you hold
      let wellStrength = 0;
      if (wellActive) {
        const held = (performance.now() - wellStartTime) / 1000; // seconds
        wellStrength = Math.min(3, held * 2); // ramps up over 1.5s
      }

      for (const p of particles) {
        // Gentle drift
        p.baseX += p.drift;
        p.y += p.vy;

        // Apply toss velocity (decays over time)
        p.baseX += p.tvx;
        p.y += p.tvy;
        p.tvx *= 0.95;
        p.tvy *= 0.95;
        if (Math.abs(p.tvx) < 0.01) p.tvx = 0;
        if (Math.abs(p.tvy) < 0.01) p.tvy = 0;

        // Sine oscillation
        const sx = Math.sin(p.y * p.sineFreq + p.sineOff) * p.sineAmp;
        const drawX = p.baseX + sx;

        // Mouse updraft (only when NOT holding gravity well)
        if (!wellActive) {
          const mdx = drawX - mouse.x;
          const mdy = p.y - mouse.y;
          const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
          if (mdist < MOUSE_RADIUS && mdist > 0) {
            const f = (1 - mdist / MOUSE_RADIUS);
            p.y += -f * 1.0;
            p.baseX += (mdx / mdist) * f * 0.3;
          }
        }

        // Gravity well attraction
        if (wellActive && wellStrength > 0) {
          const gdx = wellX - drawX;
          const gdy = wellY - p.y;
          const gdist = Math.sqrt(gdx * gdx + gdy * gdy);
          const WELL_RADIUS = 300;
          if (gdist < WELL_RADIUS && gdist > 3) {
            const f = (1 - gdist / WELL_RADIUS) * wellStrength;
            p.baseX += (gdx / gdist) * f * 1.2;
            p.y += (gdy / gdist) * f * 1.2;
          }
        }

        // Card magnet attraction — only matching-color particles
        if (magnetRect && magnetCardIdRef.current) {
          const cc = CARD_COLORS[magnetCardIdRef.current];
          if (cc && p.r === cc[0] && p.g === cc[1] && p.b === cc[2]) {
            const cx = magnetRect.left + magnetRect.width / 2;
            const cy = magnetRect.top + magnetRect.height / 2;
            const adx = cx - drawX;
            const ady = cy - p.y;
            const adist = Math.sqrt(adx * adx + ady * ady);
            if (adist < MAGNET_RADIUS && adist > 5) {
              const f = (1 - adist / MAGNET_RADIUS) * MAGNET_FORCE;
              p.baseX += (adx / adist) * f;
              p.y += (ady / adist) * f;
            }
          }
        }

        // Respawn at bottom
        if (p.y < -20) {
          p.y = H + 20;
          p.baseX = Math.random() * W;
          p.tvx = 0;
          p.tvy = 0;
        }
        // Respawn at top if tossed below screen
        if (p.y > H + 60) {
          p.y = -20;
          p.baseX = Math.random() * W;
          p.tvx = 0;
          p.tvy = 0;
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
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas ref={canvasRef}
      style={{ position: "fixed", inset: 0, zIndex: 0 }} />
  );
}
