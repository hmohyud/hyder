// src/pages/SkillsMap.js
import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import './SkillsMap.css';
import '../App.css'

export default function SkillsMap() {
  const svgRef = useRef(null);
  const simulationRef = useRef(null);
  const [data, setData] = useState({ skillNodes: [] });
  const [calcMs, setCalcMs] = useState(0);
  const tooltipInfoRef = useRef(null);
  const containerRef = useRef(null);
  const expandedIdRef = useRef(null);
  const expandedNodesRef = useRef(new Set());
  const nodeListRefs = useRef({});
  const [openLearnedFromIds, setOpenLearnedFromIds] = useState(new Set());
  const [_, forceRerender] = useState(0);
  const [linkMode, setLinkMode] = useState('category'); // or 'proficiency', etc.
  const canvasRef = useRef(null);

  // offscreen buffers to tint only the lines
  const gridCanvasRef = useRef(null);
  const tintCanvasRef = useRef(null);

  const radiusScale = d3.scalePow()
    .exponent(2.2)
    .domain([1, 10])
    .range([8, 40]);

  // --- HINT STATE + PHONE MODE (cookie-backed “Got it”) ---
  const [isPhone, setIsPhone] = useState(false);

  // simple cookie helpers
  const COOKIE_NAME = 'skills.hintAck';
  const hasHintAck = () => document.cookie.split('; ').some(c => c.startsWith(`${COOKIE_NAME}=1`));
  const setHintAckCookie = () => {
    document.cookie = `${COOKIE_NAME}=1; max-age=86400; path=/; SameSite=Lax`;
  };

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
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const saturation = 50 + (Math.abs(hash) % 20);
    const lightness = 65 + (Math.abs(hash) % 10);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  // inject alpha into hsl() -> hsla()
  function withAlpha(hsl, a) {
    if (!hsl) return `rgba(255,255,255,${a})`;
    if (hsl.startsWith('hsl(')) {
      return hsl.replace(/^hsl\(/, 'hsla(').replace(/\)$/, `, ${a})`);
    }
    return hsl;
  }

  useEffect(() => {
    fetch(`${process.env.PUBLIC_URL}/skillsData.json`)
      .then(res => res.json())
      .then(json => {
        const skillNodesWithColors = json.skillNodes.map(d => ({
          ...d,
          ringColor: stringToColor(d.id),
        }));
        setData({ ...json, skillNodes: skillNodesWithColors });
      })
      .catch(err => console.error('Failed to load skillsData.json:', err));
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (!svgRef.current || !simulationRef.current) return;
      const width = svgRef.current.clientWidth;
      const height = svgRef.current.clientHeight;

      simulationRef.current
        .force('center', d3.forceCenter(width / 2, height / 2))
        .alpha(0.5)
        .restart();
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let dragStartScreenPos = null;
    let isActuallyDragging = false;

    if (!data.skillNodes.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // main visible canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      canvas.width = svgRef.current.clientWidth;
      canvas.height = svgRef.current.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // setup offscreen canvases for grid and tint mask
    if (!gridCanvasRef.current) gridCanvasRef.current = document.createElement('canvas');
    if (!tintCanvasRef.current) tintCanvasRef.current = document.createElement('canvas');

    const fullWidth = svgRef.current.clientWidth;
    const fullHeight = svgRef.current.clientHeight;
    const padding = 40;

    const nodes = data.skillNodes.map((d) => ({
      ...d,
      x: d.x || fullWidth / 2 + Math.random() * 50 - 25,
      y: d.y || fullHeight / 2 + Math.random() * 50 - 25,
      fx: null,
      fy: null,
      ringColor: stringToColor(d.id),
    }));

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
    }

    simulationRef.current = d3.forceSimulation(nodes)
      .alphaMin(0.001)
      .alphaDecay(0.01)
      .velocityDecay(0.2)
      .force('link', d3.forceLink(links).id(d => d.id).distance(130).strength(0.1))
      .force('charge', d3.forceManyBody().strength(-20))
      .force('center', d3.forceCenter(fullWidth / 2, fullHeight / 2))
      .force('collide', d3.forceCollide().radius(d => radiusScale(d.proficiency || 1) + 6).strength(0.5));

    simulationRef.current.alphaTarget(0.005).restart();

    const g = svg.append('g');

    const link = g.append('g')
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
      .on('click', function (event, d) {
        if (isActuallyDragging) return;
        const set = expandedNodesRef.current;
        set.has(d.id) ? set.delete(d.id) : set.add(d.id);
        forceRerender(x => x + 1);

        d3.selectAll('circle').attr('stroke', c => set.has(c.id) ? c.ringColor : '#000');
        d3.selectAll('text').style('display', 'block');

        if (tooltipInfoRef.current) {
          if (set.has(d.id)) {
            tooltipInfoRef.current.innerHTML =
              `<strong style='font-size: 14px;'>${d.id}</strong><br/>${d.description || 'No details available.'}`;
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
      })
      .on('mouseover', function () {
        d3.select(this).select('circle').transition().duration(200).attr('fill', '#88f');
      })
      .on('mouseout', function (event, d) {
        d3.select(this).select('circle').transition().duration(200)
          .attr('fill', d => d.id === expandedIdRef.current ? '#f0f0f0' : '#666');
      })
      .call(d3.drag()
        .on('start', (event, d) => {
          dragStartScreenPos = [event.sourceEvent.clientX, event.sourceEvent.clientY];
          isActuallyDragging = false;
          if (!event.active) simulationRef.current.alphaTarget(0.03).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event, d) => {
          const [sx, sy] = dragStartScreenPos;
          const dx = event.sourceEvent.clientX - sx;
          const dy = event.sourceEvent.clientY - sy;
          if (Math.sqrt(dx*dx + dy*dy) > 4) isActuallyDragging = true;

          const svg = svgRef.current; if (!svg) return;
          const width = svg.clientWidth, height = svg.clientHeight, pad = 40;
          d.fx = Math.max(pad, Math.min(width - pad, event.x));
          d.fy = Math.max(pad, Math.min(height - pad, event.y));
        })
        .on('end', (event, d) => {
          if (!event.active) simulationRef.current.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
      );

    node.append('circle')
      .attr('r', d => radiusScale(d.proficiency || 1))
      .attr('fill', '#666')
      .attr('stroke', '#000')
      .attr('stroke-width', 2);

    d3.selectAll('circle').attr('stroke', d => expandedNodesRef.current.has(d.id) ? d.ringColor : '#000');

    Object.entries(nodeListRefs.current).forEach(([id, el]) => {
      const node = data.skillNodes.find(n => n.id === id);
      if (!node || !el) return;
      el.style.background = expandedNodesRef.current.has(id) ? `${node.ringColor}33` : '#222';
      el.style.borderLeft = expandedNodesRef.current.has(id)
        ? `5px solid ${node.ringColor}`
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

    // -------------------------------------------------------
    // Animated net + LINE-ONLY tint near selected nodes.
    // FIX: use destination-in to keep gradient color, masked by grid.
    // Also brighten base grid slightly so the tint reads clearly.
    // -------------------------------------------------------

    let lastFrame = 0;

    d3.timer((elapsed) => {
      if (elapsed - lastFrame < 15) return; // ~10-12 FPS
      lastFrame = elapsed;
      const start = performance.now();

      const currentWidth = svgRef.current?.clientWidth ?? 800;
      const currentHeight = svgRef.current?.clientHeight ?? 600;

      const paddingLocal = 40;
      node.attr('transform', d => {
        d.x = Math.max(paddingLocal, Math.min(currentWidth - paddingLocal, d.x));
        d.y = Math.max(paddingLocal, Math.min(currentHeight - paddingLocal, d.y));
        return `translate(${d.x}, ${d.y})`;
      });

      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      const canvas = canvasRef.current;
      if (canvas && svgRef.current) {
        const main = canvas.getContext('2d');

        // resize buffers
        const w = canvas.width = svgRef.current.clientWidth;
        const h = canvas.height = svgRef.current.clientHeight;

        const gridCanvas = gridCanvasRef.current;
        const tintCanvas = tintCanvasRef.current;
        if (gridCanvas.width !== w || gridCanvas.height !== h) {
          gridCanvas.width = w; gridCanvas.height = h;
        }
        if (tintCanvas.width !== w || tintCanvas.height !== h) {
          tintCanvas.width = w; tintCanvas.height = h;
        }

        const gctx = gridCanvas.getContext('2d');
        const tctx = tintCanvas.getContext('2d');

        // clear all
        main.clearRect(0, 0, w, h);
        gctx.clearRect(0, 0, w, h);
        tctx.clearRect(0, 0, w, h);

        // --- Warp setup (based on node positions) ---
        const gridSpacing = 13;
        gctx.lineWidth = 1;
        // slightly brighter than before so tint is visible
        gctx.strokeStyle = '#0a0a0a'; // dark blue-gray (GitHub-ish)

        const warpNodes = nodes.map(d => {
          const r = radiusScale(d.proficiency || 1);
          return {
            x: d.x,
            y: d.y,
            r2: (50 + r * 2) ** 2,
            strength: 8 + r * 0.8
          };
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
          // micro time wave to avoid static feel
          const t = elapsed * 0.001;
          dx += Math.sin((x + t * 60) * 0.005) * 0.8;
          dy += Math.cos((y - t * 40) * 0.005) * 0.8;
          return [x + dx, y + dy];
        };

        // --- DRAW GRID (to gridCanvas) ---
        for (let y = 0; y <= h; y += gridSpacing) {
          gctx.beginPath();
          for (let x = 0; x <= w; x += gridSpacing) {
            const [wx, wy] = warp(x, y);
            gctx.lineTo(wx, wy);
          }
          gctx.stroke();
        }
        for (let x = 0; x <= w; x += gridSpacing) {
          gctx.beginPath();
          for (let y = 0; y <= h; y += gridSpacing) {
            const [wx, wy] = warp(x, y);
            gctx.lineTo(wx, wy);
          }
          gctx.stroke();
        }

        // draw the plain grid to the main canvas first
        main.drawImage(gridCanvas, 0, 0);

        // --- TINT LINES ONLY NEAR SELECTED NODES ---
        const selected = expandedNodesRef.current;
        if (selected.size > 0) {
          // subtle pulse (very small)
          const pulse = 1 + Math.sin(elapsed * 0.0015) * 0.025;

          selected.forEach(id => {
            const n = nodes.find(nn => nn.id === id);
            if (!n) return;

            const baseR = 100 + radiusScale(n.proficiency || 1) * 4.0;
            const r = baseR * pulse;

            // paint a soft radial COLOR on the tint canvas
            tctx.clearRect(0, 0, w, h);

            const grad = tctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r);
            // ↑ stronger alphas so it reads; lower if too punchy
            grad.addColorStop(0.00, withAlpha(n.ringColor, 0.35));
            grad.addColorStop(0.45, withAlpha(n.ringColor, 0.15));
            grad.addColorStop(1.00, withAlpha(n.ringColor, 0.00));
            tctx.fillStyle = grad;
            tctx.beginPath();
            tctx.arc(n.x, n.y, r, 0, Math.PI * 2);
            tctx.fill();

            // FIXED: keep gradient color, clip to the grid lines
            // Use destination-in (NOT source-in)
            tctx.globalCompositeOperation = 'destination-in';
            tctx.drawImage(gridCanvas, 0, 0);
            tctx.globalCompositeOperation = 'source-over';

            // blend onto the main canvas so dark lines get “lit”
            // prefer screen; fallback to lighter if screen looks too subtle
            main.globalCompositeOperation = 'screen';
            main.drawImage(tintCanvas, 0, 0);
            main.globalCompositeOperation = 'source-over';

            // Optional tiny boost (uncomment if you still want more)
            // main.globalCompositeOperation = 'lighter';
            // main.drawImage(tintCanvas, 0, 0);
            // main.globalCompositeOperation = 'source-over';
          });
        }
      }

      const end = performance.now();
      setCalcMs(Math.round(end - start));
    });

  }, [data, linkMode]);

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
                style={{
                  '--ring': node.ringColor,
                  '--ring-tint': `${node.ringColor}33`,
                }}
                onClick={() => {
                  const set = expandedNodesRef.current;
                  set.has(node.id) ? set.delete(node.id) : set.add(node.id);
                  forceRerender(x => x + 1);

                  d3.selectAll('circle')
                    .attr('stroke', c => set.has(c.id) ? c.ringColor : '#000');
                  d3.selectAll('text').style('display', 'block');

                  if (tooltipInfoRef.current) {
                    if (set.has(node.id)) {
                      tooltipInfoRef.current.innerHTML =
                        `<strong style='font-size: 14px;'>${node.id}</strong><br/>${node.description || 'No details available.'}`;
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
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <canvas ref={canvasRef} className="ripple-canvas" />
          <svg ref={svgRef} style={{ width: '100%', height: '100%', overflow: 'visible', outline: "solid 1px white" }} />
          <div className="speed-indicator">⏱: {calcMs}ms</div>

          <select
            className="link-mode-selector"
            value={linkMode}
            onChange={e => setLinkMode(e.target.value)}
          >
            <option value="proficiency">Group by Proficiency</option>
            <option value="category">Group by Category</option>
          </select>

          <div
            className="deselect-button"
            title="Deselect all"
            onClick={() => {
              expandedNodesRef.current.clear();
              setOpenLearnedFromIds(new Set());
              d3.selectAll('circle').attr('stroke', '#000');
              Object.entries(nodeListRefs.current).forEach(([id, el]) => {
                el.style.background = '#222';
                el.style.borderLeft = '1px solid #444';
              });
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
                  <>Tap a <strong>skill in the list</strong> to add a card. Tap a <strong>card</strong> to expand it and see how I learned that skill.</>
                ) : (
                  <>Click a <span className="hint-node-circle" aria-label="graph node example"><span>node</span></span> to add a card. Click a <strong>card</strong> to expand it and see how I learned that skill.</>
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
              style={{
                boxShadow: `0 0 6px ${node.ringColor}`,
                border: `2px solid ${node.ringColor}`,
              }}
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
                    d3.selectAll('circle').attr('stroke', c =>
                      expandedNodesRef.current.has(c.id) ? c.ringColor : '#000'
                    );
                    Object.entries(nodeListRefs.current).forEach(([nid, el]) => {
                      const n = data.skillNodes.find(n => n.id === nid);
                      if (!n || !el) return;
                      el.style.background = expandedNodesRef.current.has(nid) ? `${n.ringColor}33` : '#222';
                      el.style.borderLeft = expandedNodesRef.current.has(nid)
                        ? `5px solid ${n.ringColor}` : '1px solid #444';
                    });
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
