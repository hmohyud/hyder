import React, { useEffect, useRef, useState, useCallback } from "react";
import Matter from "matter-js";
import "./About.css";

const { Engine, Bodies, Body, Composite, Constraint, Query, Events } = Matter;

/* ───── content data ───── */
const SECTIONS = [
  {
    id: "early",
    heading: "Early Context",
    color: "#00d1ff",
    paragraphs: [
      "I was born in Boston, moved to Salt Lake City as a baby, and spent my earliest years surrounded by mountains and dry air. At age six, my family relocated again\u2014and while most of my year was spent in the U.S., I grew up spending every summer in India, visiting extended family.",
      "That rhythm\u2014switching continents, routines, and mental frames every few months\u2014taught me early on that there\u2019s never just one way to think or live. It gave me a taste for the unfamiliar, the layered, and the nonlinear. Those instincts show up everywhere in my work.",
    ],
  },
  {
    id: "terminal",
    heading: "Outside the Terminal",
    color: "#00ff88",
    paragraphs: [
      "I played a lot of sports growing up\u2014soccer, squash, track and field, sailing, and baseball. I wasn\u2019t a standout on most teams, but I enjoyed being active and staying in shape. Squash was the one sport I really focused on, and I was one of the stronger players on the team.",
      "I was probably more studious than anything else. I liked school, I liked learning, and I spent a lot of time reading or tinkering with things. These days, that balance has just shifted toward programming, chess puzzles, and the occasional deep dive into a video game with friends.",
    ],
  },
  {
    id: "education",
    heading: "Education, Interrupted",
    color: "#ff8888",
    paragraphs: [
      "I studied Computer Science and Visual Arts at the University of Chicago. My academic path wasn\u2019t entirely linear\u2014like a lot of people, I took a break during COVID. But stepping away was clarifying. It gave me time to reflect on what I actually wanted to build, and what kind of developer I wanted to become.",
      "That break turned out to be formative. I didn\u2019t stop learning\u2014I just stopped waiting for permission to apply what I\u2019d already learned. I built tools, experimented with AI models, helped others debug, and spent time thinking about the craft of programming beyond assignments and deadlines.",
    ],
  },
  {
    id: "teaching",
    heading: "Teaching and Tech",
    color: "#b48bff",
    paragraphs: [
      "I\u2019ve taught programming to high school students, mentored veterans transitioning into tech, and tutored thousands of hours across math, science, and writing. These experiences shaped how I think about clarity, empathy, and the responsibility we carry when we build software for other people.",
      "I don\u2019t just want code to run\u2014I want it to make sense. To feel like it belongs. That\u2019s true whether I\u2019m designing a function, a UI, or a learning environment. Good tools invite understanding. Great tools invite play.",
    ],
  },
  {
    id: "why",
    heading: "Why I Build",
    color: "#ffaa00",
    paragraphs: [
      "What excites me most is software that stretches the boundaries of how we see or think. Tools that surprise you with their elegance\u2014or their weirdness. I\u2019m especially interested in work that blends expressive potential with technical challenge: where the medium is flexible and the results are unpredictable.",
      "I love the full arc\u2014from backend logic and infrastructure to polished UI and interaction design. My favorite work doesn\u2019t just execute\u2014it provokes. And if I can build something that teaches me along the way, even better.",
    ],
  },
  {
    id: "short",
    heading: "In Short",
    color: "#ffffff",
    paragraphs: [
      "I\u2019m not trying to do everything. I\u2019m trying to do a few strange, sharp, and well-constructed things really well. I care deeply about the details, about unexpected edges, and about software that earns your attention\u2014not just demands it.",
      "If you\u2019ve made it this far, thanks for reading. I hope something here resonated.",
    ],
  },
];

/* ───── physics constants ───── */
const SHATTER_SPEED = 32;
const WALL_SHATTER_SPEED = 25;
const WORD_SHATTER_SPEED = 38;
const WORD_WALL_SHATTER_SPEED = 32;
const WALL_THICKNESS = 60;
const PARA_OPTS = {
  restitution: 0.5,
  friction: 0.3,
  frictionAir: 0.015,
  density: 0.002,
  collisionFilter: { category: 0x0002, mask: 0x0001 | 0x0002 | 0x0004 | 0x0008 },
};
const WORD_OPTS = {
  restitution: 0.4,
  friction: 0.3,
  frictionAir: 0.02,
  density: 0.002,
  collisionFilter: { category: 0x0004, mask: 0x0001 | 0x0002 | 0x0004 | 0x0008 },
};
const LETTER_OPTS = {
  restitution: 0.35,
  friction: 0.4,
  frictionAir: 0.025,
  density: 0.002,
  collisionFilter: { category: 0x0008, mask: 0x0001 | 0x0002 | 0x0004 | 0x0008 },
};
const WALL_OPTS = {
  isStatic: true,
  restitution: 0.7,
  friction: 0.05,
  label: "wall",
  collisionFilter: { category: 0x0001, mask: 0xffff },
};

/* ───── helpers (pure, no hooks) ───── */
function createWalls(engine, w, h) {
  const walls = [
    Bodies.rectangle(w / 2, -WALL_THICKNESS / 2, w + 200, WALL_THICKNESS, WALL_OPTS),
    Bodies.rectangle(w / 2, h + WALL_THICKNESS / 2, w + 200, WALL_THICKNESS, WALL_OPTS),
    Bodies.rectangle(-WALL_THICKNESS / 2, h / 2, WALL_THICKNESS, h + 200, WALL_OPTS),
    Bodies.rectangle(w + WALL_THICKNESS / 2, h / 2, WALL_THICKNESS, h + 200, WALL_OPTS),
  ];
  Composite.add(engine.world, walls);
  return walls;
}

function measureParagraph(mDiv, text, maxW) {
  mDiv.style.width = maxW + "px";
  mDiv.innerHTML = `<p style="padding:0.6rem 0.9rem;margin:0">${text}</p>`;
  const pEl = mDiv.querySelector("p");
  const rect = pEl.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  mDiv.innerHTML = "";
  return { w, h };
}

function measureHeading(mDiv, text, isTitle) {
  mDiv.style.width = "auto";
  const el = document.createElement(isTitle ? "div" : "h2");
  el.style.cssText = isTitle
    ? "font-size:2.5rem;padding:0 0 0.5rem 0;margin:0;display:inline-block;white-space:nowrap"
    : "font-size:1.6rem;padding:0.3rem 0.6rem;margin:0;display:inline-block;white-space:nowrap";
  el.textContent = text;
  mDiv.appendChild(el);
  const rect = el.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  mDiv.removeChild(el);
  return { w, h };
}

function measureHeadingWords(mDiv, text, blockW, isTitle) {
  mDiv.style.width = blockW + "px";
  mDiv.innerHTML = "";
  const el = document.createElement(isTitle ? "div" : "h2");
  el.style.cssText = isTitle
    ? "font-size:2.5rem;padding:0 0 0.5rem 0;margin:0;white-space:nowrap"
    : "font-size:1.6rem;padding:0.3rem 0.6rem;margin:0;white-space:nowrap";
  const words = text.split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    if (i > 0) el.appendChild(document.createTextNode(" "));
    const span = document.createElement("span");
    span.textContent = w;
    span.style.display = "inline";
    el.appendChild(span);
  });
  mDiv.appendChild(el);
  const spans = el.querySelectorAll("span");
  const pr = mDiv.getBoundingClientRect();
  const results = [];
  spans.forEach((s, i) => {
    const rects = s.getClientRects();
    const first = rects[0] || s.getBoundingClientRect();
    let maxW = first.width;
    for (let j = 1; j < rects.length; j++) {
      if (rects[j].width > maxW) maxW = rects[j].width;
    }
    results.push({
      text: words[i],
      x: first.left - pr.left,
      y: first.top - pr.top,
      w: Math.max(maxW + 10, 22),
      h: first.height + 4,
    });
  });
  mDiv.innerHTML = "";
  return results;
}

function measureWords(mDiv, text, blockW) {
  mDiv.style.width = blockW + "px";
  mDiv.innerHTML = "";
  const p = document.createElement("p");
  p.style.cssText = "padding:0.6rem 0.9rem;margin:0";
  const words = text.split(/\s+/).filter(Boolean);
  words.forEach((w, i) => {
    if (i > 0) p.appendChild(document.createTextNode(" "));
    const span = document.createElement("span");
    span.textContent = w;
    span.style.display = "inline";
    p.appendChild(span);
  });
  mDiv.appendChild(p);
  const spans = p.querySelectorAll("span");
  const pr = mDiv.getBoundingClientRect();
  const results = [];
  spans.forEach((s, i) => {
    const rects = s.getClientRects();
    // Use first client rect for position; if word wraps across lines,
    // getBoundingClientRect() is way too wide — use the widest line rect instead
    const first = rects[0] || s.getBoundingClientRect();
    let maxW = first.width;
    for (let j = 1; j < rects.length; j++) {
      if (rects[j].width > maxW) maxW = rects[j].width;
    }
    results.push({
      text: words[i],
      x: first.left - pr.left,
      y: first.top - pr.top,
      w: Math.max(maxW + 10, 22),
      h: first.height + 4,
    });
  });
  mDiv.innerHTML = "";
  return results;
}

function measureLetters(mDiv, text) {
  mDiv.style.width = "auto";
  mDiv.innerHTML = "";
  const wrapper = document.createElement("span");
  wrapper.style.cssText = "padding:1px 3px;display:inline-block;white-space:nowrap";
  const letters = text.split("");
  letters.forEach((ch) => {
    const span = document.createElement("span");
    span.textContent = ch;
    span.style.display = "inline";
    wrapper.appendChild(span);
  });
  mDiv.appendChild(wrapper);
  const spans = wrapper.querySelectorAll("span");
  const wr = wrapper.getBoundingClientRect();
  const results = [];
  spans.forEach((s, i) => {
    const r = s.getBoundingClientRect();
    results.push({
      text: letters[i],
      x: r.left - wr.left,
      y: r.top - wr.top,
      w: Math.max(r.width + 6, 14),
      h: r.height + 4,
    });
  });
  mDiv.innerHTML = "";
  return results;
}

function buildBlocks(engine, mDiv, cw) {
  let curY = 20;
  const blocks = [];
  const contentW = Math.min(900, cw) - 64;
  const contentLeft = (cw - Math.min(900, cw)) / 2 + 32;

  // "About Me" title block
  const { w: titleW, h: titleH } = measureHeading(mDiv, "About Me", true);
  const titleBody = Bodies.rectangle(contentLeft + titleW / 2, curY + titleH / 2, titleW, titleH, {
    ...PARA_OPTS,
    isStatic: true,
  });
  const titleBlock = {
    id: "title",
    text: "About Me",
    body: titleBody,
    w: titleW,
    h: titleH,
    color: "#ffffff",
    type: "h",
    isTitle: true,
  };
  titleBody._blockRef = titleBlock;
  Composite.add(engine.world, titleBody);
  blocks.push(titleBlock);
  curY += titleH + 24;

  SECTIONS.forEach((sec) => {
    // Section heading as physics body
    const { w: hw, h: hh } = measureHeading(mDiv, sec.heading, false);
    const headBody = Bodies.rectangle(contentLeft + hw / 2, curY + hh / 2, hw, hh, {
      ...PARA_OPTS,
      isStatic: true,
    });
    const headBlock = {
      id: sec.id + "-heading",
      text: sec.heading,
      body: headBody,
      w: hw,
      h: hh,
      color: sec.color,
      type: "h",
      isTitle: false,
    };
    headBody._blockRef = headBlock;
    Composite.add(engine.world, headBody);
    blocks.push(headBlock);
    curY += hh + 12;

    sec.paragraphs.forEach((pText, pi) => {
      const { w: pw, h: ph } = measureParagraph(mDiv, pText, contentW);
      const cx = cw / 2;
      const cy = curY + ph / 2;

      const body = Bodies.rectangle(cx, cy, pw, ph, {
        ...PARA_OPTS,
        isStatic: true,
      });

      const block = {
        id: sec.id + "-p" + pi,
        text: pText,
        body,
        w: pw,
        h: ph,
        sectionId: sec.id,
        color: sec.color,
        type: "p",
      };
      body._blockRef = block;

      Composite.add(engine.world, body);
      blocks.push(block);

      curY += ph + 12;
    });
    curY += 24;
  });

  return { blocks, totalHeight: curY + 40 };
}

/* ───── wake a static body to dynamic with proper mass ───── */
function wakeBody(body, w, h) {
  Body.setStatic(body, false);
  const area = body.area;
  const density = PARA_OPTS.density || 0.001;
  Body.setMass(body, density * area);
  Body.setInertia(body, (body.mass / 6) * (w * w + h * h));
}

/* ───── component ───── */
export default function About() {
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const rafRef = useRef(null);
  const blocksRef = useRef([]);
  const wordsRef = useRef([]);
  const lettersRef = useRef([]);
  const dragRef = useRef(null);
  const measRef = useRef(null);
  const elMapRef = useRef({});
  const resetBtnRef = useRef(null);
  const chaosRef = useRef(0);
  const shatteringRef = useRef(new Set());

  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);

  /* ─── shatter a paragraph block into word bodies ─── */
  const shatterBlock = useCallback(
    (block, extraVx = 0, extraVy = 0) => {
      const engine = engineRef.current;
      const mDiv = measRef.current;
      if (!block || (block.type !== "p" && block.type !== "h") || !engine || !mDiv) return;
      if (shatteringRef.current.has(block.id)) return;
      shatteringRef.current.add(block.id);

      const { body, w: bw, color } = block;
      const vel = body.velocity;
      const pos = body.position;
      const angle = body.angle;

      // Keep waking sleeping bodies above this block for 2s so nothing floats
      const left = pos.x - bw / 2 - 80;
      const right = pos.x + bw / 2 + 80;
      const bottom = pos.y + block.h / 2;
      const wakeNearby = () => {
        const bodies = Composite.allBodies(engine.world);
        for (const b of bodies) {
          if (!b.isStatic && b.isSleeping && b.position.x > left && b.position.x < right && b.position.y < bottom) {
            Matter.Sleeping.set(b, false);
          }
        }
      };
      wakeNearby();
      const wakeInterval = setInterval(wakeNearby, 200);
      setTimeout(() => clearInterval(wakeInterval), 2000);

      Composite.remove(engine.world, body);
      blocksRef.current = blocksRef.current.filter((b) => b !== block);
      const shatterEl = elMapRef.current[block.id];
      if (shatterEl) shatterEl.style.display = "none";

      const wordMeasures = block.type === "h"
        ? measureHeadingWords(mDiv, block.text, bw, block.isTitle)
        : measureWords(mDiv, block.text, bw);

      wordMeasures.forEach((wm, i) => {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const localX = wm.x + wm.w / 2 - bw / 2;
        const localY = wm.y + wm.h / 2 - block.h / 2;
        const wx = pos.x + localX * cos - localY * sin;
        const wy = pos.y + localX * sin + localY * cos;

        const wordBody = Bodies.rectangle(wx, wy, wm.w, wm.h, {
          ...WORD_OPTS,
          angle,
        });

        Body.setVelocity(wordBody, {
          x: vel.x + extraVx + (Math.random() - 0.5) * 4,
          y: vel.y + extraVy + (Math.random() - 0.5) * 4,
        });
        Body.setAngularVelocity(wordBody, (Math.random() - 0.5) * 0.15);

        Composite.add(engine.world, wordBody);

        const wordBlock = {
          id: block.id + "-w" + i,
          text: wm.text,
          body: wordBody,
          w: wm.w,
          h: wm.h,
          color,
          type: "w",
          flash: true,
          fromHeading: block.type === "h",
          isTitle: block.isTitle || false,
        };
        wordBody._blockRef = wordBlock;
        wordsRef.current.push(wordBlock);
      });

      bump();
    },
    [bump]
  );

  /* ─── shatter a word block into letter bodies ─── */
  const shatterWord = useCallback(
    (word, extraVx = 0, extraVy = 0) => {
      const engine = engineRef.current;
      const mDiv = measRef.current;
      if (!word || word.type !== "w" || !engine || !mDiv) return;
      if (shatteringRef.current.has(word.id)) return;
      shatteringRef.current.add(word.id);

      const { body, color } = word;
      const vel = body.velocity;
      const pos = body.position;
      const angle = body.angle;

      // Keep waking sleeping bodies above this word for 2s so nothing floats
      const left = pos.x - word.w / 2 - 40;
      const right = pos.x + word.w / 2 + 40;
      const bottom = pos.y + word.h / 2;
      const wakeNearby = () => {
        const bodies = Composite.allBodies(engine.world);
        for (const b of bodies) {
          if (!b.isStatic && b.isSleeping && b.position.x > left && b.position.x < right && b.position.y < bottom) {
            Matter.Sleeping.set(b, false);
          }
        }
      };
      wakeNearby();
      const wakeInterval = setInterval(wakeNearby, 200);
      setTimeout(() => clearInterval(wakeInterval), 2000);

      Composite.remove(engine.world, body);
      wordsRef.current = wordsRef.current.filter((w) => w !== word);
      const wordEl = elMapRef.current[word.id];
      if (wordEl) wordEl.style.display = "none";

      const letterMeasures = measureLetters(mDiv, word.text);

      letterMeasures.forEach((lm, i) => {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const localX = lm.x + lm.w / 2 - word.w / 2;
        const localY = lm.y + lm.h / 2 - word.h / 2;
        const lx = pos.x + localX * cos - localY * sin;
        const ly = pos.y + localX * sin + localY * cos;

        const letterBody = Bodies.rectangle(lx, ly, lm.w, lm.h, {
          ...LETTER_OPTS,
          angle,
        });

        Body.setVelocity(letterBody, {
          x: vel.x + extraVx + (Math.random() - 0.5) * 3,
          y: vel.y + extraVy + (Math.random() - 0.5) * 3,
        });
        Body.setAngularVelocity(letterBody, (Math.random() - 0.5) * 0.2);

        Composite.add(engine.world, letterBody);

        const letterBlock = {
          id: word.id + "-l" + i,
          text: lm.text,
          body: letterBody,
          w: lm.w,
          h: lm.h,
          color,
          type: "l",
          flash: true,
          fromHeading: word.fromHeading || false,
          isTitle: word.isTitle || false,
        };
        letterBody._blockRef = letterBlock;
        lettersRef.current.push(letterBlock);
      });

      bump();
    },
    [bump]
  );

  /* ─── init engine + rAF — runs exactly once ─── */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const container = containerRef.current;
    const mDiv = measRef.current;
    if (!container || !mDiv) return;

    const cw = container.clientWidth;

    // create engine
    const engine = Engine.create({
      gravity: { x: 0, y: 1.2 },
      enableSleeping: true,
    });
    engineRef.current = engine;

    // build blocks first to know total content height
    const { blocks, totalHeight } = buildBlocks(engine, mDiv, cw);
    blocksRef.current = blocks;

    // set container height to fit all content, walls at content edges
    const ch = Math.max(totalHeight, container.clientHeight);
    container.style.height = ch + "px";
    createWalls(engine, cw, ch);

    // collision handler — shatters paragraphs and words on wall impact
    const collisionHandler = (event) => {
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        const wall =
          bodyA.label === "wall" ? bodyA : bodyB.label === "wall" ? bodyB : null;
        const other = wall === bodyA ? bodyB : bodyA;
        if (!wall || !other._blockRef) continue;
        if (other.isStatic) continue;

        const rv = Math.sqrt(
          (bodyA.velocity.x - bodyB.velocity.x) ** 2 +
            (bodyA.velocity.y - bodyB.velocity.y) ** 2
        );

        const blockType = other._blockRef.type;
        if ((blockType === "p" || blockType === "h") && rv > WALL_SHATTER_SPEED) {
          requestAnimationFrame(() => {
            if (other._blockRef && blocksRef.current.includes(other._blockRef)) {
              shatterBlock(other._blockRef);
            }
          });
        } else if (blockType === "w" && rv > WORD_WALL_SHATTER_SPEED) {
          requestAnimationFrame(() => {
            if (other._blockRef && wordsRef.current.includes(other._blockRef)) {
              shatterWord(other._blockRef);
            }
          });
        }
      }
    };
    Events.on(engine, "collisionStart", collisionHandler);

    // trigger render so React creates the DOM elements
    bump();

    // Start rAF loop after a microtask so React has committed the DOM
    // (bump() schedules a state update, React commits in same frame or next)
    const syncDOM = () => {
      const eMap = elMapRef.current;
      const all = [...blocksRef.current, ...wordsRef.current, ...lettersRef.current];
      for (const b of all) {
        const el = eMap[b.id];
        if (!el || !b.body) continue;
        if (b.body.isStatic && (b.type === "p" || b.type === "h")) {
          const { x, y } = b.body.position;
          el.style.transform = `translate(${x - b.w / 2}px, ${y - b.h / 2}px)`;
          continue;
        }
        const { x, y } = b.body.position;
        const angle = b.body.angle;
        el.style.transform = `translate(${x - b.w / 2}px, ${y - b.h / 2}px) rotate(${angle}rad)`;
      }

      // Animate reset button based on chaos level
      const btn = resetBtnRef.current;
      if (btn) {
        const fragCount = wordsRef.current.length + lettersRef.current.length;
        // Chaos: 0 until 200 fragments, ramps to 1 at 600
        const targetChaos = Math.min(Math.max((fragCount - 200) / 400, 0), 1);
        chaosRef.current += (targetChaos - chaosRef.current) * 0.015;
        const c = chaosRef.current;

        // Snap to target when very close to avoid sub-pixel jitter
        if (Math.abs(targetChaos - chaosRef.current) < 0.001) chaosRef.current = targetChaos;

        // Scale: 1 → 1.55
        const scale = 1 + c * 0.55;
        // Color: lerp from #aaccdd to #ff3333
        const r = Math.round(170 + c * (255 - 170));
        const g = Math.round(204 - c * (204 - 51));
        const b2 = Math.round(221 - c * (221 - 51));
        // Border: lerp from rgba(127,211,255,0.25) to rgba(255,80,80,0.7)
        const br = Math.round(127 + c * (255 - 127));
        const bg = Math.round(211 - c * (211 - 80));
        const bb = Math.round(255 - c * (255 - 80));
        const ba = (0.25 + c * 0.45).toFixed(2);
        // Flash: only kicks in above 600 fragments, slow pulse
        const now = performance.now();
        const flashT = Math.min(Math.max((fragCount - 600) / 300, 0), 1);
        const flash = (Math.sin(now * 0.002) * 0.5 + 0.5) * flashT;
        const flashR = Math.round(r + (255 - r) * flash);
        const flashG = Math.round(g * (1 - flash * 0.7));
        const flashB = Math.round(b2 * (1 - flash * 0.7));

        btn.style.transform = `scale(${(Math.round(scale * 20) / 20).toFixed(2)})`;
        btn.style.color = `rgb(${flashR},${flashG},${flashB})`;
        btn.style.borderColor = `rgba(${br},${bg},${bb},${ba})`;
        btn.style.boxShadow = flash > 0.01 ? `0 0 ${(flash * 20).toFixed(0)}px rgba(255,60,60,${(flash * 0.4).toFixed(2)})` : 'none';
      }
    };

    let lastTime = performance.now();
    const tick = (now) => {
      const delta = Math.min(now - lastTime, 16.667);
      lastTime = now;
      Engine.update(engine, delta);
      syncDOM();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      Events.off(engine, "collisionStart", collisionHandler);
      Engine.clear(engine);
    };
  }, []); // empty deps — init runs once

  /* ─── pointer handlers ─── */
  const getPos = (e) => {
    const r = containerRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const findBlock = (pos) => {
    const all = [...blocksRef.current, ...wordsRef.current, ...lettersRef.current];
    const bodies = all.map((b) => b.body);
    const hits = Query.point(bodies, pos);
    if (hits.length === 0) return null;
    return hits[0]._blockRef;
  };

  const handlePointerDown = (e) => {
    if (e.target.closest(".about-reset-btn")) return;
    const pos = getPos(e);
    const block = findBlock(pos);
    if (!block) return;

    const engine = engineRef.current;
    const body = block.body;

    if (body.isStatic) {
      // Wake bodies resting on this paragraph for 2s as it moves away
      const bpos = body.position;
      const halfW = block.w / 2;
      const left = bpos.x - halfW - 80;
      const right = bpos.x + halfW + 80;
      const bottom = bpos.y + block.h / 2;
      const wakeAbove = () => {
        const bodies = Composite.allBodies(engine.world);
        for (const b of bodies) {
          if (b !== body && !b.isStatic && b.isSleeping && b.position.x > left && b.position.x < right && b.position.y < bottom) {
            Matter.Sleeping.set(b, false);
          }
        }
      };
      wakeAbove();
      const wakeIv = setInterval(wakeAbove, 200);
      setTimeout(() => clearInterval(wakeIv), 2000);

      wakeBody(body, block.w, block.h);
      const el = elMapRef.current[block.id];
      if (el) el.classList.add("awake");
    } else if (body.isSleeping) {
      Matter.Sleeping.set(body, false);
    }

    const constraint = Constraint.create({
      pointA: { x: pos.x, y: pos.y },
      bodyB: body,
      pointB: {
        x: pos.x - body.position.x,
        y: pos.y - body.position.y,
      },
      stiffness: 0.2,
      damping: 0.1,
      length: 0,
    });
    Composite.add(engine.world, constraint);

    dragRef.current = { constraint, body, block };
    const dragEl = elMapRef.current[block.id];
    if (dragEl) dragEl.classList.add("grabbing");

    try { containerRef.current.setPointerCapture(e.pointerId); } catch (_) {}
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current) return;
    const pos = getPos(e);
    dragRef.current.constraint.pointA = pos;
  };

  const handlePointerUp = (e) => {
    if (!dragRef.current) return;
    const { constraint, body, block } = dragRef.current;
    const engine = engineRef.current;

    Composite.remove(engine.world, constraint);
    const relEl = elMapRef.current[block.id];
    if (relEl) relEl.classList.remove("grabbing");
    dragRef.current = null;

    const speed = Math.sqrt(body.velocity.x ** 2 + body.velocity.y ** 2);
    if (block.type === "p" || block.type === "h") {
      if (speed > SHATTER_SPEED) shatterBlock(block);
    } else if (block.type === "w") {
      if (speed > WORD_SHATTER_SPEED) shatterWord(block);
    }
  };

  const handleDoubleClick = (e) => {
    if (e.target.closest(".about-reset-btn")) return;
    const pos = getPos(e);
    const block = findBlock(pos);
    if (!block || block.type === "l") return;

    // Cancel active drag if we're about to shatter the dragged block
    if (dragRef.current && dragRef.current.block === block) {
      const engine = engineRef.current;
      Composite.remove(engine.world, dragRef.current.constraint);
      const dragEl = elMapRef.current[block.id];
      if (dragEl) dragEl.classList.remove("grabbing");
      dragRef.current = null;
    }

    if (block.body.isStatic) {
      wakeBody(block.body, block.w, block.h);
    }

    const dx = pos.x - block.body.position.x;
    const dy = pos.y - block.body.position.y;
    const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const burstX = (-dx / dist) * 5;
    const burstY = (-dy / dist) * 5;

    if (block.type === "p" || block.type === "h") shatterBlock(block, burstX, burstY);
    else if (block.type === "w") shatterWord(block, burstX, burstY);
  };

  /* ─── reset ─── */
  const handleReset = () => {
    const engine = engineRef.current;
    const mDiv = measRef.current;
    const container = containerRef.current;
    if (!engine || !mDiv || !container) return;

    // clear state
    elMapRef.current = {};
    shatteringRef.current.clear();
    chaosRef.current = 0;

    // remove all letter bodies
    for (const l of lettersRef.current) {
      if (l.body) Composite.remove(engine.world, l.body);
    }
    lettersRef.current = [];

    // remove all word bodies
    for (const w of wordsRef.current) {
      if (w.body) Composite.remove(engine.world, w.body);
    }
    wordsRef.current = [];

    // remove old paragraph bodies
    for (const b of blocksRef.current) {
      if (b.body) Composite.remove(engine.world, b.body);
    }

    const cw = container.clientWidth;
    const { blocks, totalHeight } = buildBlocks(engine, mDiv, cw);
    container.style.height = Math.max(totalHeight, window.innerHeight) + "px";

    blocksRef.current = blocks;
    bump();
  };

  /* ─── render ─── */
  const allBlocks = blocksRef.current;
  const allWords = wordsRef.current;
  const allLetters = lettersRef.current;

  return (
    <div
      ref={containerRef}
      className="about-physics-container"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      {/* hidden measuring div */}
      <div ref={measRef} className="about-measure" />

      {/* paragraph and heading blocks */}
      {allBlocks.map((block) => (
        <div
          key={block.id}
          ref={(el) => {
            if (el) elMapRef.current[block.id] = el;
          }}
          className={
            block.type === "h"
              ? `physics-heading${block.isTitle ? " physics-heading-title" : ""}`
              : "physics-block"
          }
          style={{
            width: block.w,
            ...(block.type === "h"
              ? { color: block.color }
              : { borderColor: `${block.color}22` }),
          }}
        >
          {block.text}
        </div>
      ))}

      {/* word blocks */}
      {allWords.map((word) => (
        <div
          key={word.id}
          ref={(el) => {
            if (el) elMapRef.current[word.id] = el;
          }}
          className={`physics-word${word.fromHeading ? (word.isTitle ? " heading-word heading-word-title" : " heading-word") : ""}${word.flash ? " shatter-enter" : ""}`}
          style={{
            borderColor: `${word.color}33`,
            ...(word.fromHeading ? { color: word.color } : {}),
          }}
        >
          {word.text}
        </div>
      ))}

      {/* letter blocks */}
      {allLetters.map((letter) => (
        <div
          key={letter.id}
          ref={(el) => {
            if (el) elMapRef.current[letter.id] = el;
          }}
          className={`physics-letter${letter.fromHeading ? (letter.isTitle ? " heading-letter heading-letter-title" : " heading-letter") : ""}${letter.flash ? " shatter-enter" : ""}`}
          style={{
            borderColor: `${letter.color}44`,
            ...(letter.fromHeading ? { color: letter.color } : {}),
          }}
        >
          {letter.text}
        </div>
      ))}

      {/* reset button */}
      <button ref={resetBtnRef} className="about-reset-btn" onClick={handleReset}>
        reset
      </button>
    </div>
  );
}
