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
/* The dots drawn with WebGL: everything a frame draws goes up in one draw
   call. Through the 2D canvas each of ~1660 dots
   was a command for the GPU process to unpack - measured on a 240 Hz
   display as 1.5 ms of a 4.2 ms frame, on that process's one busy thread.
   Positions are page px; the shaders map them to clip space. Colour is
   premultiplied on output, so the canvas composites over the page as the
   2D one did. */
const POINT_VS = `
attribute vec2 aPos; attribute float aSize; attribute vec4 aColor;
uniform vec2 uView; uniform float uDpr;
varying vec4 vColor; varying float vPx;
void main() {
  gl_Position = vec4(aPos.x / uView.x * 2.0 - 1.0, 1.0 - aPos.y / uView.y * 2.0, 0.0, 1.0);
  vPx = aSize * 2.0 * uDpr + 2.0;
  gl_PointSize = vPx;
  vColor = aColor;
}`;
const POINT_FS = `
precision mediump float;
varying vec4 vColor; varying float vPx;
void main() {
  float r = (vPx - 2.0) * 0.5;
  float d = length((gl_PointCoord - 0.5) * vPx);
  float cov = 1.0 - smoothstep(r - 0.7, r + 0.7, d);
  float tiny = min(1.0, 3.1416 * r * r);
  float a = vColor.a * cov * tiny;
  gl_FragColor = vec4(vColor.rgb * a, a);
}`;
function makeGlRenderer(canvas) {
  const gl = canvas.getContext("webgl", {
    alpha: true, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: true,
    /* the landing's window copies this canvas from another loop's frame,
       so the drawing buffer must survive compositing */
    preserveDrawingBuffer: true,
  });
  if (!gl || gl.isContextLost()) return null;
  const r = { gl, lost: false, points: new Float32Array(7 * 4096), nPoints: 0 };
  const build = () => {
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
      return sh;
    };
    const program = (vs, fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "program");
      return p;
    };
    const pp = program(POINT_VS, POINT_FS);
    r.pts = { p: pp, aPos: gl.getAttribLocation(pp, "aPos"), aSize: gl.getAttribLocation(pp, "aSize"), aColor: gl.getAttribLocation(pp, "aColor"), uView: gl.getUniformLocation(pp, "uView"), uDpr: gl.getUniformLocation(pp, "uDpr") };
    r.pointBuf = gl.createBuffer();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  };
  try { build(); } catch (e) { return null; }
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); r.lost = true; });
  canvas.addEventListener("webglcontextrestored", () => { try { build(); r.lost = false; } catch (e) { /* stays lost */ } });
  return r;
}

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
    /* the effect may run again on the same canvas (StrictMode, hot reload):
       a canvas that already holds a WebGL context hands the same one back,
       and makeGlRenderer builds on it again; a canvas that can do neither
       draws nothing rather than throwing */
    const glr = makeGlRenderer(canvas);
    const ctx = glr ? null : canvas.getContext("2d");
    if (!glr && !ctx) return undefined;

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
        stamp(
          f.fx * W + a[0] + (b[0] - a[0]) * k,
          f.fy * H + a[1] + (b[1] - a[1]) * k,
          f.size / 2,
          WHITE_ROW,
          f.alpha
        );
      }
      if (ctx) ctx.globalAlpha = 1;
    };

    /* The dots are stamped from one sprite atlas rather than filled as
       paths. ~1800 separately filled circles a frame was what held the
       landing under 60 fps: measured at 1868x1235, the dots loop alone took
       the frame from 17 ms to 26 ms while its own script time was under
       3 ms, so the cost was the rasteriser filling path after path - and a
       colour string parsed per dot was most of that script time. The atlas
       is one texture: a row per colour (the floaters' white last), a column
       per radius step, and each dot is one stamp with its alpha on
       globalAlpha. Sized to the device pixel ratio so a stamp lands at the
       radius the path had. */
    const SPRITE_COLORS = COLORS
      .filter((c, i) => COLORS.findIndex((d) => d[0] === c[0] && d[1] === c[1] && d[2] === c[2]) === i)
      .concat([[255, 255, 255]]);
    const WHITE_ROW = SPRITE_COLORS.length - 1;
    const SIZE_MIN = 0.4, SIZE_STEP = 0.2, SIZE_N = 8; // radii 0.4 .. 1.8
    let atlas = null, cell = 0, spriteScale = 1;
    const buildAtlas = () => {
      spriteScale = Math.ceil(dpr) * 2;
      cell = Math.ceil((SIZE_MIN + SIZE_STEP * (SIZE_N - 1) + 1) * 2 * spriteScale);
      atlas = document.createElement("canvas");
      atlas.width = cell * SIZE_N;
      atlas.height = cell * SPRITE_COLORS.length;
      const a = atlas.getContext("2d");
      SPRITE_COLORS.forEach((c, row) => {
        a.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        for (let col = 0; col < SIZE_N; col++) {
          a.beginPath();
          a.arc(col * cell + cell / 2, row * cell + cell / 2, (SIZE_MIN + SIZE_STEP * col) * spriteScale, 0, Math.PI * 2);
          a.fill();
        }
      });
    };
    const colorRow = (r, g, b) => {
      for (let i = 0; i < SPRITE_COLORS.length; i++) {
        const c = SPRITE_COLORS[i];
        if (c[0] === r && c[1] === g && c[2] === b) return i;
      }
      return WHITE_ROW;
    };
    /* one dot on the 2D canvas: centre, radius, colour row, alpha (the
       caller resets globalAlpha) */
    const stamp2D = (x, y, radius, row, alpha) => {
      if (alpha <= 0.003) return;
      const col = Math.max(0, Math.min(SIZE_N - 1, Math.round((radius - SIZE_MIN) / SIZE_STEP)));
      const d = cell / spriteScale;
      ctx.globalAlpha = alpha;
      ctx.drawImage(atlas, col * cell, row * cell, cell, cell, x - d / 2, y - d / 2, d, d);
    };
    /* the same dot through WebGL: queued, drawn at the end of the frame */
    const SPRITE_COLORS_F = SPRITE_COLORS.map((c) => [c[0] / 255, c[1] / 255, c[2] / 255]);
    const glPoint = (x, y, radius, row, alpha) => {
      if (alpha <= 0.003) return;
      let a = glr.points;
      if (glr.nPoints * 7 + 7 > a.length) { const b = new Float32Array(a.length * 2); b.set(a); glr.points = a = b; }
      const c = SPRITE_COLORS_F[row];
      const o = glr.nPoints * 7;
      a[o] = x; a[o + 1] = y; a[o + 2] = radius; a[o + 3] = c[0]; a[o + 4] = c[1]; a[o + 5] = c[2]; a[o + 6] = alpha;
      glr.nPoints++;
    };
    const glBegin = () => {
      const gl = glr.gl;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      glr.nPoints = 0;
    };
    const glEnd = () => {
      const gl = glr.gl;
      if (glr.nPoints) {
        const P = glr.pts;
        gl.useProgram(P.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, glr.pointBuf);
        gl.bufferData(gl.ARRAY_BUFFER, glr.points.subarray(0, glr.nPoints * 7), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(P.aPos);
        gl.vertexAttribPointer(P.aPos, 2, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(P.aSize);
        gl.vertexAttribPointer(P.aSize, 1, gl.FLOAT, false, 28, 8);
        gl.enableVertexAttribArray(P.aColor);
        gl.vertexAttribPointer(P.aColor, 4, gl.FLOAT, false, 28, 12);
        gl.uniform2f(P.uView, W, H);
        gl.uniform1f(P.uDpr, dpr);
        gl.drawArrays(gl.POINTS, 0, glr.nPoints);
        gl.disableVertexAttribArray(P.aPos);
        gl.disableVertexAttribArray(P.aSize);
        gl.disableVertexAttribArray(P.aColor);
      }
    };
    const stamp = glr ? glPoint : stamp2D;
    const initParticle = (startRandom) => {
      const c = COLORS[Math.floor(Math.random() * COLORS.length)];
      return {
        row: colorRow(c[0], c[1], c[2]),
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
      if (ctx) buildAtlas();
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
      if (glr) {
        if (glr.lost) { raf = requestAnimationFrame(draw); return; }
        glBegin();
      } else {
        ctx.clearRect(0, 0, W, H);
      }

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

        /* While the portrait is hovered, the embers ride its edge. The
           landing publishes the cloud's live outline (window.__focusOutline:
           centre and radius-by-angle in viewport px) while the portrait sits
           among the cards: about half the dots that come near are caught,
           settle just inside the outline and run along it, then slip off
           after a while; the rest drift straight through the window. With
           no outline (the portrait in the mission paragraph on tablet) the
           orbit below takes over. */
        const outline = vortex && window.__focusOutline;
        if (outline) {
          const vdx = drawX - outline.cx;
          const vdy = p.y - outline.cy;
          const vdist = Math.sqrt(vdx * vdx + vdy * vdy) || 0.001;
          const ux = vdx / vdist, uy = vdy / vdist;
          const R = outline.radiusAt(Math.atan2(vdy, vdx));
          const CAPTURE = 420;
          if (p.rail == null && vdist < CAPTURE) p.rail = Math.random() < 0.5;
          if (p.flung > 0) {
            p.flung--;
            p.baseX += ux * 1.6;
            p.y += uy * 1.6;
          } else if (p.rail && vdist < CAPTURE) {
            const target = R - 8; // just inside the edge
            const gap = target - vdist;
            const f = (1 - Math.min(1, Math.abs(gap) / CAPTURE)) * MAGNET_FORCE;
            p.baseX += ux * Math.sign(gap) * f * 0.9;
            p.y += uy * Math.sign(gap) * f * 0.9;
            const onRail = 1 - Math.min(1, Math.abs(gap) / 40);
            p.baseX += -uy * 1.3 * onRail;
            p.y += ux * 1.3 * onRail;
            p.ride = (p.ride || 0) + (onRail > 0.5 ? 1 : 0);
            if (p.ride > 200) { p.ride = 0; p.flung = 70; }
          }
        } else if (vortex) {
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
            if (adist > 5) {
              /* every ember of the card's colour comes, wherever it is on
                 the page: a steady pull everywhere, stronger within reach */
              const near = Math.max(0, 1 - adist / MAGNET_RADIUS);
              const f = (0.4 + 0.6 * near) * MAGNET_FORCE;
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

        stamp(drawX, p.y, p.size, p.row, a);
      }
      if (ctx) ctx.globalAlpha = 1;

      drawFloaters(performance.now() / 1000);
      if (glr) glEnd();

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
      className="bg-particles"
      style={{ position: "fixed", inset: 0, zIndex: 0 }} />
  );
}
