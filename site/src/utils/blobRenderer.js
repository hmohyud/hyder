/**
 * Catmull-Rom to cubic bezier conversion for smooth closed curves.
 * Renders soft-body blobs on a canvas context.
 */

/**
 * Draw a single blob from its perimeter particle positions.
 */
export function drawBlob(ctx, softBody, fillColor, strokeColor, isSelected, isHovered) {
  const pts = softBody.perimeter.map((p) => p.position);
  const n = pts.length;
  if (n < 3) return;

  ctx.beginPath();

  // Catmull-Rom → Bezier: for each segment P[i] → P[i+1],
  // use P[i-1] and P[i+2] to compute control points.
  const tension = 0.45;
  const alpha = (1 - tension) / 2;

  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];

    const cp1x = p1.x + alpha * (p2.x - p0.x);
    const cp1y = p1.y + alpha * (p2.y - p0.y);
    const cp2x = p2.x - alpha * (p3.x - p1.x);
    const cp2y = p2.y - alpha * (p3.y - p1.y);

    if (i === 0) {
      ctx.moveTo(p1.x, p1.y);
    }
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }

  ctx.closePath();

  // Fill
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Stroke
  ctx.lineWidth = isSelected ? 3 : isHovered ? 2.5 : 1.5;
  ctx.strokeStyle = isSelected ? strokeColor : isHovered ? '#aaf' : 'rgba(100,100,100,0.5)';
  ctx.stroke();
}

/**
 * Draw all blobs onto the canvas.
 */
export function drawAllBlobs(ctx, softBodies, nodeDataMap, selectedSet, hoveredId) {
  for (const sb of softBodies) {
    const data = nodeDataMap.get(sb.nodeId);
    if (!data) continue;

    const isSelected = selectedSet.has(sb.nodeId);
    const isHovered = sb.nodeId === hoveredId;

    // Semi-transparent fill using ring color
    const fillColor = isSelected
      ? withAlpha(data.ringColor, 0.45)
      : isHovered
        ? withAlpha(data.ringColor, 0.35)
        : withAlpha(data.ringColor, 0.2);

    drawBlob(ctx, sb, fillColor, data.ringColor, isSelected, isHovered);
  }
}

/**
 * Draw link lines on canvas.
 */
export function drawLinks(ctx, links, bodyMap) {
  ctx.strokeStyle = 'rgba(85, 85, 85, 0.4)';
  ctx.lineWidth = 1;

  for (const link of links) {
    const srcId = typeof link.source === 'object' ? link.source.nodeId || link.source.id : link.source;
    const tgtId = typeof link.target === 'object' ? link.target.nodeId || link.target.id : link.target;
    const a = bodyMap.get(srcId);
    const b = bodyMap.get(tgtId);
    if (!a || !b) continue;

    ctx.beginPath();
    ctx.moveTo(a.center.position.x, a.center.position.y);
    ctx.lineTo(b.center.position.x, b.center.position.y);
    ctx.stroke();
  }
}

// ---- helpers ----

function withAlpha(hsl, a) {
  if (!hsl) return `rgba(255,255,255,${a})`;
  if (hsl.startsWith('hsl(')) {
    return hsl.replace(/^hsl\(/, 'hsla(').replace(/\)$/, `, ${a})`);
  }
  return hsl;
}
