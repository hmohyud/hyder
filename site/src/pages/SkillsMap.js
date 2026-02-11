// src/pages/SkillsMap.js
import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import Matter from 'matter-js';
import { applyLinkForces, applyRepulsion } from '../utils/linkForces';
import './SkillsMap.css';
import '../App.css';

const { Engine, Bodies, Body, Composite, Constraint } = Matter;

// Load the dotlottie-player web component once (works with .lottie files)
function useDotLottieScript() {
  useEffect(() => {
    if (typeof window !== 'undefined' && window.customElements?.get('dotlottie-player')) return;
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/@dotlottie/player-component@latest/dist/dotlottie-player.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    document.head.appendChild(script);
  }, []);
}

export default function SkillsMap() {
  useDotLottieScript();

  const svgRef = useRef(null);
  const engineRef = useRef(null);
  const bodyMapRef = useRef(new Map());
  const dragRef = useRef(null);
  const linksForPhysicsRef = useRef([]);
  const nodesRef = useRef([]);
  const [data, setData] = useState({ skillNodes: [] });
  const [calcMs, setCalcMs] = useState(0);
  const tooltipInfoRef = useRef(null);
  const containerRef = useRef(null);
  const expandedIdRef = useRef(null);
  const expandedNodesRef = useRef(new Set());
  const nodeListRefs = useRef({});
  const [openLearnedFromIds, setOpenLearnedFromIds] = useState(new Set());
  // eslint-disable-next-line no-unused-vars
  const [_, forceRerender] = useState(0);
  const [linkMode, setLinkMode] = useState('category');
  const canvasRef = useRef(null);
  const clickLottieRef = useRef(null);
  const dragLottieRef = useRef(null);

  // offscreen buffers to tint only the lines
  const gridCanvasRef = useRef(null);
  const tintCanvasRef = useRef(null);

  // viewport (CSS pixels) that BOTH SVG + Canvas use
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const graphRef = useRef(null);

  // Node circle radius by proficiency (unchanged)
  const radiusScale = d3.scalePow().exponent(2.2).domain([1, 10]).range([8, 40]);

  // --- iPad detection (for perf hint) ---
  function isIPadDevice() {
    const ua = navigator.userAgent || "";
    const plat = navigator.platform || "";
    const uaPlat = navigator.userAgentData?.platform || "";
    const touch = navigator.maxTouchPoints || 0;

    if (/\biPad\b/i.test(ua)) return true; // classic iPad UA
    if ((plat === "MacIntel" || /\bMac\b/i.test(plat) || uaPlat === "macOS") && touch > 1) return true; // iPadOS desktop mode
    if (/\b(iPad|iPadOS)\b/i.test(plat) || /\b(iPad|iPadOS)\b/i.test(uaPlat)) return true;

    return false;
  }
  const [isIPad, setIsIPad] = useState(false);
  const isIPadRef = useRef(false);
  useEffect(() => {
    try { setIsIPad(isIPadDevice()); } catch { setIsIPad(false); }
  }, []);
  useEffect(() => { isIPadRef.current = isIPad; }, [isIPad]);

  // ---- Area-based interpolation helpers ----
  const [rMin, rMax] = [radiusScale.range()[0], radiusScale.range()[1]];
  const area = r => Math.PI * r * r;
  const areaMin = area(rMin);
  const areaMax = area(rMax);
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const tAreaFromProf = (prof) => {
    const p = Math.max(1, Math.min(10, prof || 1));
    const r = radiusScale(p);
    return clamp01((area(r) - areaMin) / (areaMax - areaMin));
  };
  const LIGHT_R_MIN = 190;
  const LIGHT_R_MAX = 360;
  const ALPHA_INNER_MIN = 0.10;
  const ALPHA_INNER_MAX = 0.45;
  const ALPHA_MID_MIN = 0.03;
  const ALPHA_MID_MAX = 0.18;

  // --- HINT STATE + PHONE MODE ---
  const [isPhone, setIsPhone] = useState(false);
  const COOKIE_NAME = 'skills.hintAck_v2';
  const hasHintAck = () => document.cookie.split('; ').some(c => c.startsWith(`${COOKIE_NAME}=1`));
  const setHintAckCookie = () => { document.cookie = `${COOKIE_NAME}=1; max-age=86400; path=/; SameSite=Lax`; };
  const [hintAck, setHintAck] = useState(() => hasHintAck());
  const shouldShowHint = !hintAck && expandedNodesRef.current.size === 0;

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 500px)');
    const update = () => setIsPhone(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    const saturation = 50 + (Math.abs(hash) % 20);
    const lightness = 65 + (Math.abs(hash) % 10);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  function withAlpha(hsl, a) {
    if (!hsl) return `rgba(255,255,255,${a})`;
    if (hsl.startsWith('hsl(')) {
      return hsl.replace(/^hsl\(/, 'hsla(').replace(/\)$/, `, ${a})`);
    }
    return hsl;
  }

  // --- Load skills data ---
  useEffect(() => {
    fetch(`${process.env.PUBLIC_URL}/skillsData.json`)
      .then(res => res.json())
      .then(json => {
        const skillNodesWithColors = json.skillNodes.map(d => ({ ...d, ringColor: stringToColor(d.id) }));
        setData({ ...json, skillNodes: skillNodesWithColors });
      })
      .catch(err => console.error('Failed to load skillsData.json:', err));
  }, []);

  // --- Single source of truth for viewport width/height (CSS px) using ResizeObserver ---
  useEffect(() => {
    const el = graphRef.current;
    if (!el) return;

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setViewport(prev =>
            prev.width === width && prev.height === height ? prev : { width, height }
          );
        }
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- Main Matter.js + Canvas setup ---
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let dragStartScreenPos = null;
    let isActuallyDragging = false;

    const { width: w, height: h } = viewport;
    if (!data.skillNodes.length || !w || !h) return;

    // Clean up any existing engine
    if (engineRef.current) {
      Engine.clear(engineRef.current);
      engineRef.current = null;
    }
    bodyMapRef.current.clear();
    dragRef.current = null;

    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    // main visible canvas — **CSS px only**, no DPR scaling
    const canvasEl = canvasRef.current;
    if (canvasEl) {
      const ctx = canvasEl.getContext('2d');
      canvasEl.width = w;
      canvasEl.height = h;
      canvasEl.style.width = w + 'px';
      canvasEl.style.height = h + 'px';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
    }

    // setup offscreen canvases for grid and tint mask (also CSS px only)
    if (!gridCanvasRef.current) gridCanvasRef.current = document.createElement('canvas');
    if (!tintCanvasRef.current) tintCanvasRef.current = document.createElement('canvas');

    const gridCanvas = gridCanvasRef.current;
    const tintCanvas = tintCanvasRef.current;

    gridCanvas.width = w;
    gridCanvas.height = h;
    tintCanvas.width = w;
    tintCanvas.height = h;

    const nodes = data.skillNodes.map((d) => ({
      ...d,
      x: d.x || w / 2 + Math.random() * 50 - 25,
      y: d.y || h / 2 + Math.random() * 50 - 25,
      ringColor: stringToColor(d.id),
    }));
    nodesRef.current = nodes;

    // links by mode
    const links = [];
    if (linkMode === 'proficiency') {
      const groupsByProficiency = {};
      nodes.forEach(n => {
        if (!groupsByProficiency[n.proficiency]) groupsByProficiency[n.proficiency] = [];
        groupsByProficiency[n.proficiency].push(n.id);
      });
      Object.values(groupsByProficiency).forEach(group => {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) links.push({ source: group[i], target: group[j] });
        }
      });
    } else if (linkMode === 'category') {
      const groupsByCategory = {};
      nodes.forEach(n => {
        if (!groupsByCategory[n.category]) groupsByCategory[n.category] = [];
        groupsByCategory[n.category].push(n.id);
      });
      Object.values(groupsByCategory).forEach(group => {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) links.push({ source: group[i], target: group[j] });
        }
      });
    } else if (linkMode === 'ungrouped') {
      // intentionally no links
    }

    // --- Headless D3 simulation for initial layout ---
    const initSim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(130).strength(linkMode === 'ungrouped' ? 0 : 0.1))
      .force('charge', d3.forceManyBody().strength(-20))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('collide', d3.forceCollide().radius(d => radiusScale(d.proficiency || 1) + 6).strength(0.5))
      .stop();

    for (let i = 0; i < 60; i++) initSim.tick();
    initSim.stop();
    // D3 forceLink resolves source/target from string IDs to node objects

    // Store physics links as string IDs (for bodyMap lookup)
    linksForPhysicsRef.current = links.map(l => ({
      source: typeof l.source === 'object' ? l.source.id : l.source,
      target: typeof l.target === 'object' ? l.target.id : l.target,
    }));

    // --- Create Matter.js engine (zero gravity, free-floating) ---
    const engine = Engine.create({
      gravity: { x: 0, y: 0 },
      enableSleeping: false,
    });
    engineRef.current = engine;

    // Create circle bodies — start clustered at center, explode outward
    const ctrX = w / 2;
    const ctrY = h / 2;
    const bodyMap = new Map();
    nodes.forEach(d => {
      const r = radiusScale(d.proficiency || 1);

      // Use D3 layout position as direction hint for initial burst
      const dx = d.x - ctrX;
      const dy = d.y - ctrY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      // Spawn near center with slight jitter so they aren't perfectly stacked
      const jx = ctrX + (dx / dist) * (Math.random() * 20);
      const jy = ctrY + (dy / dist) * (Math.random() * 20);

      // Sync node data to spawn position so SVG starts here too
      d.x = jx;
      d.y = jy;

      const body = Bodies.circle(jx, jy, r, {
        restitution: 0.4,
        friction: 0.1,
        frictionAir: 0.04,
        density: 0.001 * (1 + (d.proficiency || 1) / 10),
        collisionFilter: {
          category: 0x0001,
          mask: 0x0001,  // collide with other nodes only
        },
        label: d.id,
      });
      body._nodeData = d;

      const speed = 18 + Math.random() * 10;
      Body.setVelocity(body, {
        x: (dx / dist) * speed,
        y: (dy / dist) * speed,
      });

      Composite.add(engine.world, body);
      bodyMap.set(d.id, body);
    });
    bodyMapRef.current = bodyMap;

    // --- SVG setup (same structure as before) ---
    const g = svg.append('g');

    const linkSel = g.append('g')
      .attr('stroke', '#555')
      .attr('stroke-opacity', 0.4)
      .selectAll('line')
      .data(links)
      .join('line');

    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .each(function (d) { d.gElement = d3.select(this); })
      .on('mouseover', function () {
        d3.select(this).select('circle').transition().duration(200).attr('fill', '#88f');
      })
      .on('mouseout', function () {
        d3.select(this).select('circle').transition().duration(200)
          .attr('fill', d => d.id === expandedIdRef.current ? '#f0f0f0' : '#666');
      });

    node.append('circle')
      .attr('r', d => radiusScale(d.proficiency || 1))
      .attr('fill', '#666')
      .attr('stroke', '#000')
      .attr('stroke-width', 2);

    d3.selectAll('circle').attr('stroke', d => expandedNodesRef.current.has(d.id) ? d.ringColor : '#000');

    Object.entries(nodeListRefs.current).forEach(([id, el]) => {
      const nodeObj = data.skillNodes.find(n => n.id === id);
      if (!nodeObj || !el) return;
      el.style.background = expandedNodesRef.current.has(id) ? `${nodeObj.ringColor}33` : '#222';
      el.style.borderLeft = expandedNodesRef.current.has(id)
        ? `5px solid ${nodeObj.ringColor}`
        : '1px solid #444';
    });

    node.append('text')
      .text(d => d.id)
      .attr('font-size', '11px')
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .style('fill', '#eee')
      .style('font-family', 'monospace')
      .style('pointer-events', 'none')
      .style('user-select', 'none');

    // --- Pointer-based drag with Matter.js Constraint ---
    const getPos = (e) => {
      const rect = svgEl.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handlePointerDown = (e) => {
      if (e.button !== 0) return; // left click only
      dragStartScreenPos = [e.clientX, e.clientY];
      isActuallyDragging = false;

      const pos = getPos(e);
      // Use distance-based search with generous hit radius (min 18px)
      // Query.point is too strict for small nodes, especially at walls
      let hitBody = null;
      let bestDist = Infinity;
      bodyMap.forEach(body => {
        const dx = pos.x - body.position.x;
        const dy = pos.y - body.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitRadius = Math.max(body.circleRadius || 8, 18);
        if (dist < hitRadius && dist < bestDist) {
          bestDist = dist;
          hitBody = body;
        }
      });
      if (!hitBody) return;
      const nodeData = hitBody._nodeData;
      if (!nodeData) return;

      const constraint = Constraint.create({
        pointA: { x: pos.x, y: pos.y },
        bodyB: hitBody,
        pointB: {
          x: pos.x - hitBody.position.x,
          y: pos.y - hitBody.position.y,
        },
        stiffness: 0.15,
        damping: 0.1,
        length: 0,
      });
      Composite.add(engine.world, constraint);

      dragRef.current = { constraint, body: hitBody, nodeData };
      try { svgEl.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault(); // prevent text selection while dragging
    };

    const handlePointerMove = (e) => {
      if (!dragRef.current) return;

      // Track drag distance for click/drag threshold
      if (dragStartScreenPos) {
        const [sx, sy] = dragStartScreenPos;
        const ddx = e.clientX - sx;
        const ddy = e.clientY - sy;
        if (Math.sqrt(ddx * ddx + ddy * ddy) > 4) isActuallyDragging = true;
      }

      const pos = getPos(e);
      const pad = 40;
      dragRef.current.constraint.pointA = {
        x: Math.max(pad, Math.min(w - pad, pos.x)),
        y: Math.max(pad, Math.min(h - pad, pos.y)),
      };
    };

    const handlePointerUp = (e) => {
      if (!dragRef.current) return;
      const { constraint, nodeData } = dragRef.current;
      Composite.remove(engine.world, constraint);
      dragRef.current = null;
      // Body retains velocity — momentum transfer happens naturally

      // If we didn't actually drag (click), trigger node selection
      if (!isActuallyDragging && nodeData) {
        const set = expandedNodesRef.current;
        if (set.has(nodeData.id)) {
          set.delete(nodeData.id);
        } else {
          set.add(nodeData.id);
          // Auto-open the "learnedFrom" section for newly selected nodes
          setOpenLearnedFromIds(prev => {
            const next = new Set(prev);
            next.add(nodeData.id);
            return next;
          });
        }
        forceRerender(x => x + 1);

        d3.selectAll('circle').attr('stroke', c => set.has(c.id) ? c.ringColor : '#000');
        d3.selectAll('text').style('display', 'block');

        if (tooltipInfoRef.current) {
          if (set.has(nodeData.id)) {
            tooltipInfoRef.current.innerHTML =
              `<strong style='font-size: 14px;'>${nodeData.id}</strong><br/>${(nodeData.description || 'No details available.')}`;
            tooltipInfoRef.current.style.display = 'block';
          } else {
            tooltipInfoRef.current.style.display = 'none';
          }
        }
        Object.entries(nodeListRefs.current).forEach(([id, el]) => {
          const n = data.skillNodes.find(n => n.id === id);
          if (!n || !el) return;
          el.style.setProperty('--ring', n.ringColor);
          el.style.setProperty('--ring-tint', `${n.ringColor}33`);
          el.dataset.selected = set.has(id) ? 'true' : 'false';
          el.style.removeProperty('background');
          el.style.removeProperty('border-left');
        });
      }

      try { svgEl.releasePointerCapture(e.pointerId); } catch (_) {}
    };

    svgEl.addEventListener('pointerdown', handlePointerDown);
    svgEl.addEventListener('pointermove', handlePointerMove);
    svgEl.addEventListener('pointerup', handlePointerUp);
    svgEl.addEventListener('pointercancel', handlePointerUp);

    // --------- rAF render loop (CSS-pixel space only) ---------
    let rafId = null;
    let lastTime = performance.now();

    const renderFrame = () => {
      const start = performance.now();

      // --- Step Matter.js physics ---
      const now = performance.now();
      const delta = Math.min(now - lastTime, 16.667);
      lastTime = now;
      Engine.update(engine, delta);

      // --- Hard boundary enforcement (replaces walls) ---
      // Deterministic: clamp position by radius, reflect velocity for bounce.
      // Can never tunnel regardless of speed.
      const BOUNCE = 0.5;  // energy kept on bounce (0 = dead stop, 1 = perfect)
      bodyMap.forEach(body => {
        const r = body.circleRadius || 8;
        const px = body.position.x;
        const py = body.position.y;
        let vx = body.velocity.x;
        let vy = body.velocity.y;
        let cx = px, cy = py;
        let bounced = false;

        if (px - r < 0)     { cx = r;     vx = Math.abs(vx) * BOUNCE; bounced = true; }
        if (px + r > w)     { cx = w - r; vx = -Math.abs(vx) * BOUNCE; bounced = true; }
        if (py - r < 0)     { cy = r;     vy = Math.abs(vy) * BOUNCE; bounced = true; }
        if (py + r > h)     { cy = h - r; vy = -Math.abs(vy) * BOUNCE; bounced = true; }

        if (bounced) {
          Body.setPosition(body, { x: cx, y: cy });
          Body.setVelocity(body, { x: vx, y: vy });
        }
      });

      // --- Apply custom forces ---
      const physLinks = linksForPhysicsRef.current;
      const allBodies = [];
      bodyMap.forEach(body => allBodies.push(body));

      // Slack rope link forces (only pull when stretched beyond rest length)
      if (physLinks.length > 0) {
        applyLinkForces(physLinks, bodyMap, 0.00004, 120);
      }

      // Repulsion to prevent overlap (supplement to collision)
      applyRepulsion(allBodies, 0.0002, 180);

      // --- Sync Matter.js body positions -> node data ---
      // No clamping — walls handle containment. Clamping caused SVG position
      // to diverge from physics body position, making wall-adjacent nodes un-draggable.
      nodes.forEach(d => {
        const body = bodyMap.get(d.id);
        if (!body) return;
        d.x = body.position.x;
        d.y = body.position.y;
      });

      // --- SVG sync ---
      node.attr('transform', d => `translate(${d.x}, ${d.y})`);

      linkSel
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      // --- Canvas rendering (unchanged) ---
      const canvasEl2 = canvasRef.current;
      if (canvasEl2) {
        // ensure canvas/offscreens still match viewport
        if (canvasEl2.width !== w || canvasEl2.height !== h) {
          canvasEl2.width = w;
          canvasEl2.height = h;
          canvasEl2.style.width = w + 'px';
          canvasEl2.style.height = h + 'px';
        }
        if (gridCanvas.width !== w || gridCanvas.height !== h) {
          gridCanvas.width = w;
          gridCanvas.height = h;
        }
        if (tintCanvas.width !== w || tintCanvas.height !== h) {
          tintCanvas.width = w;
          tintCanvas.height = h;
        }

        const main = canvasEl2.getContext('2d');
        const gctx = gridCanvas.getContext('2d');
        const tctx = tintCanvas.getContext('2d');

        main.setTransform(1, 0, 0, 1, 0, 0);
        gctx.setTransform(1, 0, 0, 1, 0, 0);
        tctx.setTransform(1, 0, 0, 1, 0, 0);

        // clear all
        main.clearRect(0, 0, w, h);
        gctx.clearRect(0, 0, w, h);
        tctx.clearRect(0, 0, w, h);

        // ---- draw grid (CSS coords only) ----
        if (!isIPadRef.current) {
          const warpNodes = nodes.map(d => {
            const r = radiusScale(d.proficiency || 1);
            return { x: d.x, y: d.y, r2: (50 + r * 2) ** 2, strength: 8 + r * 0.8 };
          });

          const warp = (x, y) => {
            let dx = 0, dy = 0;
            for (const d of warpNodes) {
              const distX = x - d.x;
              const distY = y - d.y;
              const distSq = distX * distX + distY * distY;
              if (distSq < d.r2) {
                const dist = Math.sqrt(distSq) || 0.001;
                const force = (1 - dist / Math.sqrt(d.r2)) ** 2;
                dx += (distX / dist) * force * d.strength;
                dy += (distY / dist) * force * d.strength;
              }
            }
            return [x + dx, y + dy];
          };

          const gridSpacing = 13;
          gctx.lineWidth = 1;
          gctx.strokeStyle = '#0a0a0a';

          // rows
          for (let yy = 0; yy <= h; yy += gridSpacing) {
            gctx.beginPath();
            let first = true;
            for (let xx = 0; xx <= w; xx += gridSpacing) {
              const [wx, wy] = warp(xx, yy);
              if (first) { gctx.moveTo(wx, wy); first = false; }
              else { gctx.lineTo(wx, wy); }
            }
            gctx.stroke();
          }
          // cols
          for (let xx = 0; xx <= w; xx += gridSpacing) {
            gctx.beginPath();
            let first = true;
            for (let yy = 0; yy <= h; yy += gridSpacing) {
              const [wx, wy] = warp(xx, yy);
              if (first) { gctx.moveTo(wx, wy); first = false; }
              else { gctx.lineTo(wx, wy); }
            }
            gctx.stroke();
          }

          // paint grid
          main.drawImage(gridCanvas, 0, 0);

          // Tint lines near selected nodes
          const selected = expandedNodesRef.current;
          if (selected.size > 0) {
            selected.forEach(id => {
              const n = nodes.find(nn => nn.id === id);
              if (!n) return;

              const tA = tAreaFromProf(n.proficiency);
              const rr = lerp(LIGHT_R_MIN, LIGHT_R_MAX, tA);
              const aInner = lerp(ALPHA_INNER_MIN, ALPHA_INNER_MAX, tA);
              const aMid = lerp(ALPHA_MID_MIN, ALPHA_MID_MAX, tA);

              tctx.clearRect(0, 0, w, h);
              const grad = tctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, rr);
              grad.addColorStop(0.00, withAlpha(n.ringColor, aInner));
              grad.addColorStop(0.45, withAlpha(n.ringColor, aMid));
              grad.addColorStop(1.00, withAlpha(n.ringColor, 0.00));
              tctx.fillStyle = grad;
              tctx.beginPath();
              tctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
              tctx.fill();

              tctx.globalCompositeOperation = 'destination-in';
              tctx.drawImage(gridCanvas, 0, 0);
              tctx.globalCompositeOperation = 'source-over';

              main.globalCompositeOperation = 'screen';
              main.drawImage(tintCanvas, 0, 0);
              main.globalCompositeOperation = 'source-over';
            });
          }
        }
      }

      setCalcMs(Math.round(performance.now() - start));
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);

    // Cleanup
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      svgEl.removeEventListener('pointerdown', handlePointerDown);
      svgEl.removeEventListener('pointermove', handlePointerMove);
      svgEl.removeEventListener('pointerup', handlePointerUp);
      svgEl.removeEventListener('pointercancel', handlePointerUp);
      if (engineRef.current) {
        Engine.clear(engineRef.current);
        engineRef.current = null;
      }
      bodyMapRef.current.clear();
      dragRef.current = null;
    };
  }, [data, linkMode, viewport.width, viewport.height, isIPad]);

  // ---------- COACHMARK (two Lotties side-by-side with smooth fade-out) ----------
  const [coachVisible, setCoachVisible] = useState(true);
  const [coachHiding, setCoachHiding] = useState(false);
  const requestHideCoach = () => {
    if (coachHiding) return;
    setCoachHiding(true);
    setTimeout(() => setCoachVisible(false), 400);
  };

  // Hide on first interaction or after 7s
  useEffect(() => {
    if (!coachVisible) return;
    const svgEl = svgRef.current;
    const canvasEl = canvasRef.current;
    const onPointerDown = () => requestHideCoach();
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') requestHideCoach(); };
    svgEl?.addEventListener('pointerdown', onPointerDown, { passive: true });
    canvasEl?.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => requestHideCoach(), 7000);
    return () => {
      clearTimeout(t);
      svgEl?.removeEventListener('pointerdown', onPointerDown);
      canvasEl?.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [coachVisible, coachHiding]);

  // Start Lottie only after custom element is ready
  useEffect(() => {
    if (!coachVisible) return;
    let cancelled = false;

    const boot = async (el) => {
      if (!el) return;
      if (!window.customElements?.get('dotlottie-player')) {
        try { await window.customElements.whenDefined('dotlottie-player'); } catch { }
      }
      if (cancelled) return;

      el.setAttribute('loop', 'true');
      el.setAttribute('autoplay', 'true');

      const src = el.getAttribute('src');
      if (src && typeof el.load === 'function') {
        try { await el.load(src); } catch { }
      }

      const onReady = () => {
        if (cancelled) return;
        try { el.seek?.(0); } catch { }
        try { el.play?.(); } catch { }
      };
      el.addEventListener('ready', onReady, { once: true });
    };

    boot(clickLottieRef.current);
    boot(dragLottieRef.current);

    const onVisible = () => {
      if (!document.hidden) {
        boot(clickLottieRef.current);
        boot(dragLottieRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); };
  }, [coachVisible]);

  return (
    <div ref={containerRef} className="skills-container">
      <div className="list-container">
        {[...data.skillNodes]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((node) => {
            const isSelected = expandedNodesRef.current.has(node.id);
            return (
              <div
                key={node.id}
                className="sidebar-node"
                ref={(el) => { if (el) nodeListRefs.current[node.id] = el; }}
                data-selected={isSelected ? 'true' : 'false'}
                style={{ '--ring': node.ringColor, '--ring-tint': `${node.ringColor}33` }}
                onClick={() => {
                  const set = expandedNodesRef.current;
                  if (set.has(node.id)) {
                    set.delete(node.id);
                  } else {
                    set.add(node.id);
                    // Auto-open the "learnedFrom" section for newly selected nodes
                    setOpenLearnedFromIds(prev => {
                      const next = new Set(prev);
                      next.add(node.id);
                      return next;
                    });
                  }
                  forceRerender(x => x + 1);

                  d3.selectAll('circle').attr('stroke', c => set.has(c.id) ? c.ringColor : '#000');
                  d3.selectAll('text').style('display', 'block');

                  if (tooltipInfoRef.current) {
                    if (set.has(node.id)) {
                      tooltipInfoRef.current.innerHTML =
                        `<strong style='font-size: 14px;'>${node.id}</strong><br/>${(node.description || 'No details available.')}`;
                      tooltipInfoRef.current.style.display = 'block';
                    } else {
                      tooltipInfoRef.current.style.display = 'none';
                    }
                  }

                  Object.entries(nodeListRefs.current).forEach(([id, el]) => {
                    const n = data.skillNodes.find(n => n.id === id);
                    if (!n || !el) return;
                    el.style.setProperty('--ring', n.ringColor);
                    el.style.setProperty('--ring-tint', `${n.ringColor}33`);
                    el.dataset.selected = set.has(id) ? 'true' : 'false';
                  });
                }}
              >
                {node.id}
              </div>
            );
          })}
      </div>

      <div className="node-graph">
        <div
          ref={graphRef}
          style={{ position: 'relative', width: '100%', height: '100%' }}
        >
          {/* iPad perf hint (optional) */}
          {isIPad && (
            <div
              role="status"
              aria-live="polite"
              style={{
                position: 'absolute',
                bottom: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.72)',
                color: '#fff',
                padding: '8px 12px',
                borderRadius: 10,
                fontSize: 12,
                zIndex: 2000,
                boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                backdropFilter: 'blur(2px)',
                textAlign: 'center',
                maxWidth: 420
              }}
            >
              For full functionality (animated grid), please view this page on a computer.
            </div>
          )}

          <canvas ref={canvasRef} className="ripple-canvas" />
          <svg
            ref={svgRef}
            style={{ width: '100%', height: '100%', overflow: 'visible', outline: 'solid 1px white' }}
          />

          {/* --- COACHMARK OVERLAY: two panels side-by-side (fades out smoothly) --- */}
          {coachVisible && (
            <>
              <style>{`
                .coach-overlay{
                  position:absolute;inset:0;display:grid;place-items:center;
                  z-index:1000;pointer-events:none;
                  opacity:1; transition:opacity .4s ease;
                }
                .coach-overlay.is-hiding{ opacity:0 }
                .coach-row{
                  display:flex;gap:22px;align-items:center;justify-content:center;
                  background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);
                  padding:14px 18px;border-radius:12px;backdrop-filter:blur(2px)
                }
                .coach-panel{
                  display:flex;flex-direction:column;align-items:center;justify-content:center;
                  width:200px
                }
                .coach-target{
                  position:relative;width:180px;height:180px;display:grid;place-items:center
                }
                .coach-target::before{
                  content:"";position:absolute;inset:8px;border:2px dashed rgba(255,255,255,.15);
                  border-radius:50%;
                }
                .coach-label{
                  margin-top:8px;color:#eef;font-size:12px;white-space:nowrap
                }
                @media (max-width: 600px){
                  .coach-row{ flex-direction:column; gap:12px; }
                  .coach-panel{ width:auto; }
                }
              `}</style>

              <div
                className={`coach-overlay ${coachHiding ? 'is-hiding' : ''}`}
                aria-hidden="true"
              >
                <div className="coach-row">
                  <div className="coach-panel">
                    <div className="coach-target">
                      <dotlottie-player
                        ref={clickLottieRef}
                        autoplay="true"
                        loop="true"
                        mode="normal"
                        speed="1"
                        style={{ width: '180px', height: '180px' }}
                        src={`${process.env.PUBLIC_URL}/click.lottie`}
                      ></dotlottie-player>
                    </div>
                    <div className="coach-label">Click a node</div>
                  </div>

                  <div className="coach-panel">
                    <div className="coach-target">
                      <dotlottie-player
                        ref={dragLottieRef}
                        autoplay="true"
                        loop="true"
                        mode="normal"
                        speed="1"
                        style={{ width: '180px', height: '180px' }}
                        src={`${process.env.PUBLIC_URL}/drag.lottie`}
                      ></dotlottie-player>
                    </div>
                    <div className="coach-label">Drag a node</div>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="speed-indicator">⏱: {calcMs}ms</div>

          <select
            className="link-mode-selector"
            value={linkMode}
            onChange={e => setLinkMode(e.target.value)}
          >
            <option value="proficiency">Group by Proficiency</option>
            <option value="category">Group by Category</option>
            <option value="ungrouped">Ungrouped</option>
          </select>

          <div
            className="deselect-button"
            title="Deselect all"
            onClick={() => {
              expandedNodesRef.current.clear();
              setOpenLearnedFromIds(new Set());
              d3.selectAll('circle').attr('stroke', '#000');
              Object.entries(nodeListRefs.current).forEach(([id, el]) => {
                if (!el) return;
                el.style.background = '#222';
                el.style.borderLeft = '1px solid #444';
              });
              forceRerender(x => x + 1);
            }}
          >
            ⟳
          </div>
        </div>
      </div>

      <div className="tooltip-container" style={{ position: 'relative' }}>
        {shouldShowHint && (
          <div className="hint-overlay" role="status" aria-live="polite">
            <div className="hint-card" onClick={(e) => e.stopPropagation()}>
              <div className="hint-title"></div>
              <div className="hint-text">
                {isPhone ? (
                  <>Tap a <strong>skill in the list</strong> to add a card. Cards open expanded — tap to collapse.</>
                ) : (
                  <>Click a <span className="hint-node-circle" aria-label="graph node example"><span>node</span></span> to add a card. Cards open expanded — click to collapse.</>
                )}
              </div>
              <button
                type="button"
                className="hint-dismiss"
                aria-label="Dismiss tip"
                onClick={() => { setHintAck(true); setHintAckCookie(); }}
              >
                Got it
              </button>
            </div>
          </div>
        )}

        {[...Array.from(expandedNodesRef.current).reverse()].map(id => {
          const node = data.skillNodes.find(n => n.id === id);
          if (!node) return null;
          const isOpen = openLearnedFromIds.has(id);

          return (
            <div
              key={id}
              className="node-list-item"
              onClick={() => {
                const newSet = new Set(openLearnedFromIds);
                isOpen ? newSet.delete(id) : newSet.add(id);
                setOpenLearnedFromIds(newSet);
              }}
              style={{ boxShadow: `0 0 6px ${node.ringColor}`, border: `2px solid ${node.ringColor}` }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <strong style={{ fontSize: '13px' }}>{node.id}</strong>
                  <span style={{ fontSize: '13px', color: '#777' }}>{isOpen ? '▾' : '▸'}</span>
                </div>

                <button
                  type="button"
                  aria-label={`Close ${node.id}`}
                  title="Close"
                  style={{
                    background: 'transparent',
                    border: '1px solid #444',
                    color: '#aaa',
                    fontWeight: 700,
                    fontSize: 14,
                    lineHeight: 1,
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    cursor: 'pointer',
                    display: 'grid',
                    placeItems: 'center',
                    transition: 'transform .15s ease, box-shadow .15s ease, color .15s ease, border-color .15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#fff';
                    e.currentTarget.style.borderColor = node.ringColor;
                    e.currentTarget.style.boxShadow = `0 0 8px ${node.ringColor}`;
                    e.currentTarget.style.transform = 'scale(1.1) rotate(5deg)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = '#aaa';
                    e.currentTarget.style.borderColor = '#444';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'none';
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    expandedNodesRef.current.delete(id);
                    setOpenLearnedFromIds(prev => {
                      const next = new Set(prev);
                      next.delete(id);
                      return next;
                    });
                    d3.selectAll('circle').attr('stroke', c => expandedNodesRef.current.has(c.id) ? c.ringColor : '#000');
                    Object.entries(nodeListRefs.current).forEach(([nid, el]) => {
                      const n = data.skillNodes.find(n => n.id === nid);
                      if (!n || !el) return;
                      el.style.background = expandedNodesRef.current.has(nid) ? `${n.ringColor}33` : '#222';
                      el.style.borderLeft = expandedNodesRef.current.has(nid) ? `5px solid ${n.ringColor}` : '1px solid #444';
                    });
                    forceRerender(x => x + 1);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.currentTarget.click();
                    }
                  }}
                >
                  ×
                </button>
              </div>

              <div style={{ margin: '6px 0', fontSize: '11px' }}>
                {node.description || 'No details available.'}
              </div>

              <div style={{ margin: '8px 0' }}>
                <div style={{ fontSize: '12px', color: '#333', marginBottom: '2px' }}>
                  Proficiency: <strong>{node.proficiency}/10</strong>
                </div>
                <div style={{ display: 'flex', gap: '2px' }}>
                  {Array.from({ length: 10 }, (_, i) => (
                    <div
                      key={i}
                      style={{
                        width: '8px',
                        height: '16px',
                        borderRadius: '2px',
                        background: i < node.proficiency ? node.ringColor : '#ddd',
                        boxShadow: i < node.proficiency ? `0 0 4px ${node.ringColor}` : 'none',
                        transition: 'background 0.3s ease',
                      }}
                    />
                  ))}
                </div>
              </div>

              {node.learnedFrom && (
                <div style={{ marginTop: '10px', color: '#333', fontSize: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#666' }}>
                    <span>{isOpen ? 'Learned from:' : '👁 Click to view details'}</span>
                  </div>
                  {isOpen && (
                    <div style={{ marginTop: '6px', lineHeight: '1.4', color: '#222', fontSize: '11px' }}>
                      {node.learnedFrom}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
