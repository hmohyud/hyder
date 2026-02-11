import { useEffect, useRef } from "react";

/*
  CardGlowOverlay — Vanta HALO-style feedback glow around hovered cards.

  Key insight from Vanta's shader:
    The FBO stores backgroundColor + glow (not raw glow).
    This prevents UNSIGNED_BYTE quantization from killing small values.
    When reading, subtract bg to isolate glow. When writing, add bg back.

  The blit pass then subtracts bg and outputs glow with luminance-based alpha
  for transparent compositing over the page.
*/

const QUAD_VS = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Feedback pass — operates in "bg + glow" color space (like Vanta)
const FEEDBACK_FS = `
precision mediump float;
uniform vec2 u_res;
uniform sampler2D u_prev;
uniform vec4 u_card;
uniform float u_dpr;
uniform float u_active;
uniform vec3 u_color;
uniform float u_time;
uniform float u_radius;
uniform float u_angle;

// Background color stored in FBO to prevent quantization death
const vec3 BG = vec3(0.039, 0.047, 0.067);

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec2 rot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c*p.x - s*p.y, s*p.x + c*p.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 px = gl_FragCoord.xy / u_dpr;

  // Read previous frame, subtract bg to get raw glow
  vec3 prev = texture2D(u_prev, uv).rgb;

  // Slight zoom-out — pulls color outward each frame
  vec2 uvBig = (uv - 0.5) * 0.997 + 0.5;

  // Color-channel-based UV distortion — drives organic spread
  vec3 prevGlow = prev - BG;
  float cropDist = 0.015 + 0.008 * sin(u_time * 1.4);
  float bias = 0.15 + 0.12 * sin(u_time * 0.9);
  vec2 offset1 = uv + vec2(
    (prevGlow.g - bias) * cropDist,
    (prevGlow.r - bias * 0.8) * cropDist
  );

  // Wind direction — changes moderately fast (~2-4 second cycle)
  float windAngle = u_time * 1.1 + sin(u_time * 0.7) * 2.0;
  float spinDist = 0.0025 + 0.0015 * sin(u_time * 1.3);
  vec2 offset2 = uvBig + vec2(
    cos(windAngle) * spinDist,
    sin(windAngle) * spinDist
  );

  // Blend two distorted samples, subtract bg to get glow
  vec3 mixed = texture2D(u_prev, offset1).rgb * 0.4
             + texture2D(u_prev, offset2).rgb * 0.6
             - BG;

  // Fade: fast decay but enough room for visible spill
  mixed = max(mixed - 0.004, 0.0) * 0.98;

  // Seed: tight ring exactly at card border (d ≈ 0)
  vec2 center = u_card.xy + u_card.zw * 0.5;
  vec2 hs = u_card.zw * 0.5;
  vec2 rp = rot2(px - center, -u_angle);
  float d = sdRoundBox(rp, hs, u_radius);

  // Tight gaussian centered on the border (d=0), ~2px wide
  float ring = exp(-d * d * 0.35);
  // Only seed outside the card (d > 0 side)
  ring *= smoothstep(-0.5, 1.0, d);
  vec3 seedColor = u_color * ring * 0.35 * u_active;

  // Mask inside card: kill glow accumulation inside
  float outside = smoothstep(-1.0, 2.0, d);
  mixed *= outside;

  // Write bg + glow to FBO (Vanta pattern)
  gl_FragColor = vec4(BG + clamp(mixed + seedColor, 0.0, 1.0), 1.0);
}
`;

// Blit pass — extract glow from FBO, output with alpha for transparent canvas
const BLIT_FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_res;

const vec3 BG = vec3(0.039, 0.047, 0.067);

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 raw = texture2D(u_tex, uv).rgb;
  vec3 glow = max(raw - BG, 0.0);

  // Boost the glow so it's visible
  glow *= 3.0;

  float lum = max(glow.r, max(glow.g, glow.b));
  gl_FragColor = vec4(glow, lum);
}
`;

const COLORS = [
  [1.0, 0.42, 0.616],
  [0.639, 0.42, 1.0],
  [0.42, 0.812, 1.0],
  [0.42, 1.0, 0.616],
];
export default function CardGlowOverlay({ hoveredCard, cardRefs }) {
  const cvs = useRef(null);
  const gl_ = useRef(null);
  const raf_ = useRef(null);
  const active_ = useRef(0);
  const angle_ = useRef(0);
  const hov_ = useRef(null);
  const col_ = useRef(COLORS[2]);
  const rect_ = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const t0 = useRef(Date.now());
  const refs_ = useRef(cardRefs);
  refs_.current = cardRefs;

  useEffect(() => {
    hov_.current = hoveredCard;
    if (hoveredCard != null && cardRefs?.[hoveredCard - 1])
      col_.current = COLORS[hoveredCard - 1] || COLORS[2];
  }, [hoveredCard, cardRefs]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = cvs.current;
    if (!c) return;

    const gl = c.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    if (!gl) return;
    gl_.current = gl;

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("[CardGlow]", gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };

    const linkProg = (vs, fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error("[CardGlow] link:", gl.getProgramInfoLog(p));
        return null;
      }
      return p;
    };

    const quadVS = compile(gl.VERTEX_SHADER, QUAD_VS);
    const feedFS = compile(gl.FRAGMENT_SHADER, FEEDBACK_FS);
    const blitFS = compile(gl.FRAGMENT_SHADER, BLIT_FS);
    if (!quadVS || !feedFS || !blitFS) return;

    const feedProg = linkProg(quadVS, feedFS);
    const blitProg = linkProg(quadVS, blitFS);
    if (!feedProg || !blitProg) return;

    // Quad buffer
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);

    const feedAttr = gl.getAttribLocation(feedProg, "a_pos");
    const blitAttr = gl.getAttribLocation(blitProg, "a_pos");

    const feedU = {};
    ["u_res", "u_prev", "u_card", "u_dpr", "u_active", "u_color", "u_time", "u_radius", "u_angle"]
      .forEach(n => { feedU[n] = gl.getUniformLocation(feedProg, n); });
    const blitU = {};
    ["u_tex", "u_res"]
      .forEach(n => { blitU[n] = gl.getUniformLocation(blitProg, n); });

    // Ping-pong FBOs
    let W, H;
    let fbo = [null, null];
    let tex = [null, null];
    let ping = 0;

    const BG_BYTES = [10, 12, 17, 255]; // #0a0c11 as RGBA bytes

    const createFBO = (idx) => {
      if (tex[idx]) gl.deleteTexture(tex[idx]);
      if (fbo[idx]) gl.deleteFramebuffer(fbo[idx]);

      tex[idx] = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex[idx]);

      // Initialize with background color (not black!)
      const pixels = new Uint8Array(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        pixels[i * 4] = BG_BYTES[0];
        pixels[i * 4 + 1] = BG_BYTES[1];
        pixels[i * 4 + 2] = BG_BYTES[2];
        pixels[i * 4 + 3] = 255;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      fbo[idx] = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[idx]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex[idx], 0);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.floor(window.innerWidth * dpr);
      H = Math.floor(window.innerHeight * dpr);
      c.width = W;
      c.height = H;
      c.style.width = window.innerWidth + "px";
      c.style.height = window.innerHeight + "px";
      createFBO(0);
      createFBO(1);
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = () => {
      if (!gl_.current) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const time = (Date.now() - t0.current) / 1000;
      const h = hov_.current;
      const r = refs_.current;

      // Get card visual rect: center from bbox, true dimensions from
      // offsetWidth * totalScale (so rotation doesn't inflate the SDF),
      // and exact rotation from transform matrix.
      if (h != null && r?.[h - 1]?.current) {
        const el = r[h - 1].current;
        const b = el.getBoundingClientRect();
        const cr = rect_.current;

        // Extract rotation + scale from this element's own transform
        const st = window.getComputedStyle(el);
        const mat = (st.transform || "").match(/^matrix\((.+)\)$/);
        let sx = 1, angle = 0;
        if (mat) {
          const v = mat[1].split(",").map(Number);
          angle = Math.atan2(v[1], v[0]);
          sx = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
        }
        angle_.current = angle;

        // Total scale = bbox.width / (offsetWidth * cos(angle) + offsetHeight * |sin(angle)|)
        // But simpler: bbox center is always correct, and we can derive
        // visual w/h from offsetWidth * (bbox.width / (oW*cos + oH*|sin|))
        // For small angles just use: trueVisualW = offsetWidth * (bbox.width / bbox.width_if_no_rot)
        // Simplest correct approach: offsetWidth * totalScale where
        // totalScale = bbox.width / offsetWidth / cos(angle) for small angles
        // But really the cleanest: use bbox directly, no rotation in shader
        // Since you WANT rotation: pass center from bbox, width/height
        // as bbox dims corrected for rotation inflation
        const cosA = Math.cos(Math.abs(angle));
        const sinA = Math.sin(Math.abs(angle));
        const ow = el.offsetWidth;
        const oh = el.offsetHeight;
        // bbox.width = ow*totalScale*cos + oh*totalScale*sin (rotation expands it)
        // bbox.height = ow*totalScale*sin + oh*totalScale*cos
        // Solve for totalScale: ts = bbox.width / (ow*cos + oh*sin)
        const ts = b.width / (ow * cosA + oh * sinA);
        const trueW = ow * ts;
        const trueH = oh * ts;

        // Center from bbox (always correct)
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;

        // Pass as left/top/w/h for the shader
        cr.x += (cx - trueW / 2 - cr.x) * 0.5;
        cr.y += (cy - trueH / 2 - cr.y) * 0.5;
        cr.w += (trueW - cr.w) * 0.5;
        cr.h += (trueH - cr.h) * 0.5;
      } else {
        angle_.current += (0 - angle_.current) * 0.15;
      }
      const ta = h != null ? 1 : 0;
      active_.current += (ta - active_.current) * 0.08;
      if (active_.current < 0.001) active_.current = 0;

      const cr = rect_.current;
      const src = ping;
      const dst = 1 - ping;

      // Pass 1: Feedback → dst FBO
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[dst]);
      gl.viewport(0, 0, W, H);
      gl.useProgram(feedProg);

      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(feedAttr);
      gl.vertexAttribPointer(feedAttr, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex[src]);
      gl.uniform1i(feedU.u_prev, 0);
      gl.uniform2f(feedU.u_res, W, H);
      gl.uniform1f(feedU.u_dpr, dpr);
      gl.uniform4f(feedU.u_card, cr.x, window.innerHeight - cr.y - cr.h, cr.w, cr.h);
      gl.uniform1f(feedU.u_active, active_.current);
      gl.uniform3fv(feedU.u_color, col_.current);
      gl.uniform1f(feedU.u_time, time);
      gl.uniform1f(feedU.u_radius, 16);
      gl.uniform1f(feedU.u_angle, angle_.current);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Pass 2: Blit → screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(blitProg);

      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(blitAttr);
      gl.vertexAttribPointer(blitAttr, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex[dst]);
      gl.uniform1i(blitU.u_tex, 0);
      gl.uniform2f(blitU.u_res, W, H);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      ping = dst;
      raf_.current = requestAnimationFrame(loop);
    };

    raf_.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf_.current);
      window.removeEventListener("resize", resize);
      gl_.current = null;
    };
  }, []);

  if (typeof window !== "undefined" && !window.matchMedia("(hover:hover)").matches) return null;
  return <canvas ref={cvs} className="card-glow-overlay" aria-hidden="true" />;
}
