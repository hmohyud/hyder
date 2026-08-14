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
export default function BgVariantB({ magnetTarget, magnetCardId, vortexTarget }) {
  const canvasRef = useRef(null);
  const magnetTargetRef = useRef(null);
  const magnetCardIdRef = useRef(null);
  const vortexTargetRef = useRef(null);

  // Keep magnetTarget in a ref so the rAF loop can read it without re-running useEffect
  useEffect(() => {
    magnetTargetRef.current = magnetTarget;
    magnetCardIdRef.current = magnetCardId;
    vortexTargetRef.current = vortexTarget;
  }, [magnetTarget, magnetCardId, vortexTarget]);

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

    /* The 60 ambient white dots that used to be `.particle` spans built in
       Landing.js. As DOM elements they animated `transform`, but Chrome would
       not composite them, so every frame cost 60 style resolutions on the main
       thread - measured at roughly 200ms per 4 seconds, forever, at every
       viewport width. Drawn here they ride a loop that is already running and
       cost 60 more fills. They deliberately ignore the cursor, the magnets and
       the vortex, exactly as the CSS version did.
       fx/fy are fractions of the viewport, mirroring the old `left: %` /
       `top: %`, so a resize repositions them without rebuilding anything. */
    const FLOAT_PATH = [[0, 0], [28, -24], [-26, 20], [18, 26], [0, 0]];
    const floaters = [];
    for (let i = 0; i < 60; i++) {
      floaters.push({
        fx: Math.random(),
        fy: Math.random(),
        size: 1 + Math.random() * 2,
        dur: 18 + Math.random() * 10,
        delay: Math.random() * 5,
        alpha: 0.25 + Math.random() * 0.5,
      });
    }
    // smoothstep stands in for CSS ease-in-out; the two differ by ~2%, which on
    // a 1-3px dot moving 28px over five seconds is not resolvable.
    const easeInOut = (t) => t * t * (3 - 2 * t);
    const drawFloaters = (sec) => {
      for (const f of floaters) {
        const phase = ((sec + f.delay) / f.dur) % 1;
        const seg = Math.min(3, Math.floor(phase * 4));
        const k = easeInOut(phase * 4 - seg);
        const a = FLOAT_PATH[seg];
        const b = FLOAT_PATH[seg + 1];
        ctx.beginPath();
        ctx.arc(
          f.fx * W + a[0] + (b[0] - a[0]) * k,
          f.fy * H + a[1] + (b[1] - a[1]) * k,
          f.size / 2,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = `rgba(255,255,255,${f.alpha})`;
        ctx.fill();
      }
    };

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

      // Vortex: while the portrait is hovered, embers near it fall inward and
      // swirl, the way an accretion disk collapses.
      let vortex = null;
      const vt = vortexTargetRef.current;
      if (vt && vt.getBoundingClientRect) {
        const r = vt.getBoundingClientRect();
        vortex = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
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

        // Portrait orbit. Uses exactly the card magnets' force profile and
        // falloff, so embers drift in at the same pace you already know, with
        // a tangential component that turns the approach into an orbit and a
        // clear radius the head always keeps to itself.
        if (vortex) {
          const vdx = drawX - vortex.x;
          const vdy = p.y - vortex.y;
          const vdist = Math.sqrt(vdx * vdx + vdy * vdy) || 0.001;
          const CAPTURE = 420;
          const RING = 90;
          if (vdist < CAPTURE) {
            const ux = vdx / vdist; // points away from the portrait
            const uy = vdy / vdist;
            const f = (1 - vdist / CAPTURE) * MAGNET_FORCE;
            if (vdist > RING) {
              p.baseX -= ux * f; // inward, same strength as a card magnet
              p.y -= uy * f;
            } else {
              p.baseX += ux * f * 0.6; // ease back out, keeping the circle clear
              p.y += uy * f * 0.6;
            }
            p.baseX += -uy * f * 0.8; // tangential: circle rather than collide
            p.y += ux * f * 0.8;
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

      drawFloaters(performance.now() / 1000);

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
