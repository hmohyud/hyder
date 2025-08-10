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
  const radiusScale = d3.scalePow()
    .exponent(2.2) // tweak this value to control curve steepness
    .domain([1, 10])
    .range([8, 40]);


  function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Use hash to pick a hue
    const hue = Math.abs(hash) % 360; // full hue wheel

    // Saturation and lightness tuned for pastel/techy
    const saturation = 50 + (Math.abs(hash) % 20); // 50–70%
    const lightness = 65 + (Math.abs(hash) % 10);  // 65–75%

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
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
        // .force('center', d3.forceCenter(width / 2, height / 2))
        // .force('rhombusCollide', forceRhombusCollide(nodes))
        // .force('x', d3.forceX(width / 2).strength(0.01))
        // .force('y', d3.forceY(height / 2).strength(0.01))
        .force('center', d3.forceCenter(width / 2, height / 2))


        .alpha(0.5)
        .restart();
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // apply correct size on mount

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let dragStartScreenPos = null;
    let isActuallyDragging = false;


    if (!data.skillNodes.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      canvas.width = svgRef.current.clientWidth;
      canvas.height = svgRef.current.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    const fullWidth = svgRef.current.clientWidth;
    const fullHeight = svgRef.current.clientHeight;
    const padding = 40;

    const nodes = data.skillNodes.map((d, i) => ({
      ...d,
      x: d.x || fullWidth / 2 + Math.random() * 50 - 25,
      y: d.y || fullHeight / 2 + Math.random() * 50 - 25,
      fx: null,
      fy: null,
      ringColor: stringToColor(d.id), // ✅ generate once
    }));


    const idSet = new Set(nodes.map(n => n.id));
    const links = [];


    if (linkMode === 'proficiency') {
      const groupsByProficiency = {};
      nodes.forEach(n => {
        if (!groupsByProficiency[n.proficiency]) groupsByProficiency[n.proficiency] = [];
        groupsByProficiency[n.proficiency].push(n.id);
      });

      Object.values(groupsByProficiency).forEach(group => {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            links.push({ source: group[i], target: group[j] });
          }
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
          for (let j = i + 1; j < group.length; j++) {
            links.push({ source: group[i], target: group[j] });
          }
        }
      });
    }

    simulationRef.current = d3.forceSimulation(nodes)
      .alphaMin(0.001)
      .alphaDecay(0.01) // slower decay
      .velocityDecay(0.2) // less resistance
      .force('link', d3.forceLink(links).id(d => d.id).distance(130).strength(0.1)) // softer springs
      .force('charge', d3.forceManyBody().strength(-20)) // less push apart
      .force('center', d3.forceCenter(fullWidth / 2, fullHeight / 2))
      .force('collide', d3.forceCollide().radius(d => radiusScale(d.proficiency || 1) + 6).strength(0.5))
    // .force('rhombusCollide', forceRhombusCollide(nodes))

    simulationRef.current.alphaTarget(0.005).restart();

    const g = svg.append('g');
    // // Zoom & pan
    // const zoom = d3.zoom()
    //   .scaleExtent([0.5, 2.5])
    //   .on('zoom', (event) => g.attr('transform', event.transform));

    // d3.select(svgRef.current).call(zoom);
    // defs: glow filter
    // const defs = svg.append('defs');
    // const glow = defs.append('filter').attr('id', 'node-glow');
    // glow.append('feGaussianBlur').attr('stdDeviation', 4).attr('result', 'blur');
    // const merge = glow.append('feMerge');
    // merge.append('feMergeNode').attr('in', 'blur');
    // merge.append('feMergeNode').attr('in', 'SourceGraphic');

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
      .each(function (d) {
        d.gElement = d3.select(this);
      })
      .on('click', function (event, d) {
        if (isActuallyDragging) return; // ignore if drag occurred

        const set = expandedNodesRef.current;
        // if (set.has(d.id)) {
        //   set.delete(d.id);
        // } else {
        //   set.add(d.id);
        // }
        if (expandedNodesRef.current.has(d.id)) {
          expandedNodesRef.current.delete(d.id);
        } else {
          expandedNodesRef.current.add(d.id);
        }
        forceRerender(x => x + 1); // trigger immediate re-render

        // d3.selectAll('circle')
        //   .attr('stroke', c => set.has(c.id) ? '#ffcc00' : '#000')
        // .attr('fill', c => set.has(c.id) ? '#f0f0f0' : '#666');
        d3.selectAll('circle')
          .attr('stroke', c => set.has(c.id) ? c.ringColor : '#000');

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
          // clear any old inline fallback styles
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
        // .attr('fill', d => d.id === expandedIdRef.current ? '#f0f0f0' : '#7090ff');
      })
      .call(d3.drag()
        .on('start', (event, d) => {
          dragStartScreenPos = [event.sourceEvent.clientX, event.sourceEvent.clientY];
          isActuallyDragging = false;

          if (!event.active) simulationRef.current.alphaTarget(0.03).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          const [startX, startY] = dragStartScreenPos;
          const dx = event.sourceEvent.clientX - startX;
          const dy = event.sourceEvent.clientY - startY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > 4) {
            isActuallyDragging = true;
          }

          const svg = svgRef.current;
          if (!svg) return;

          const width = svg.clientWidth;
          const height = svg.clientHeight;
          const padding = 40;

          d.fx = Math.max(padding, Math.min(width - padding, event.x));
          d.fy = Math.max(padding, Math.min(height - padding, event.y));
        })
        .on('end', (event, d) => {
          if (!event.active) simulationRef.current.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      );






    node.append('circle')
      // .attr('r', 18)
      // .attr('r', d => 10 + (d.proficiency || 1) * 1.5) // base radius + scaled size
      .attr('r', d => radiusScale(d.proficiency || 1))

      .attr('fill', '#666')
      // .attr('fill', '#7090ff')

      .attr('stroke', '#000')
      .attr('stroke-width', 2);



    // Re-apply visual highlighting for selected nodes after graph re-render
    d3.selectAll('circle')
      .attr('stroke', d => expandedNodesRef.current.has(d.id) ? d.ringColor : '#000');

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





    let lastFrame = 0;

    d3.timer((elapsed) => {
      if (elapsed - lastFrame < 15) return; // throttle to ~10 FPS
      lastFrame = elapsed;

      const start = performance.now();

      const currentWidth = svgRef.current?.clientWidth ?? 800;
      const currentHeight = svgRef.current?.clientHeight ?? 600;

      node.attr('transform', d => {
        d.x = Math.max(padding, Math.min(currentWidth - padding, d.x));
        d.y = Math.max(padding, Math.min(currentHeight - padding, d.y));
        return `translate(${d.x}, ${d.y})`;
      });

      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      const canvas = canvasRef.current;
      if (canvas && svgRef.current) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width = svgRef.current.clientWidth;
        const h = canvas.height = svgRef.current.clientHeight;
        ctx.clearRect(0, 0, w, h);

        ctx.strokeStyle = '#0a0a0a';
        ctx.lineWidth = 1;

        const gridSpacing = 13;

        // Precompute influence values per node
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
          return [x + dx, y + dy];
        };

        for (let y = 0; y <= h; y += gridSpacing) {
          ctx.beginPath();
          for (let x = 0; x <= w; x += gridSpacing) {
            const [wx, wy] = warp(x, y);
            ctx.lineTo(wx, wy);
          }
          ctx.stroke();
        }

        for (let x = 0; x <= w; x += gridSpacing) {
          ctx.beginPath();
          for (let y = 0; y <= h; y += gridSpacing) {
            const [wx, wy] = warp(x, y);
            ctx.lineTo(wx, wy);
          }
          ctx.stroke();
        }
      }

      const end = performance.now();
      setCalcMs(Math.round(end - start));
    });




  }, [data, linkMode]);


  return (

    <div ref={containerRef} className="skills-container">
      {/* <div ref={containerRef} style={{ width: '100%', height: '80vh', overflow: 'visible', position: 'relative', display: 'flex', outline: "solid 1px white" }}> */}
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
                /* expose colors to CSS */
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

                  // just flip the flag + keep vars fresh; no gray inline paints
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

      <div className="node-graph" >

        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <canvas ref={canvasRef} className="ripple-canvas" />


          <svg ref={svgRef} style={{ width: '100%', height: '100%', overflow: 'visible', outline: "solid 1px white" }} />
          <div className="speed-indicator">
            ⏱: {calcMs}ms
          </div>
          {/* Deselect All Spiral Button */}
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

      <div className="tooltip-container">
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

              {/* Title row with dropdown + close */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <strong style={{ fontSize: '13px' }}>{node.id}</strong>
                  <span style={{ fontSize: '13px', color: '#777' }}>{isOpen ? '▾' : '▸'}</span>
                </div>

                {/* Close (X) button */}
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
                        ? `5px solid ${n.ringColor}`
                        : '1px solid #444';
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

              <div style={{ margin: '6px 0', fontSize: '11px' }}>{node.description || 'No details available.'}</div>

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
