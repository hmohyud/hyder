/* ═══════════════════════════════════════════════════════════
   boids.js — 2D flocking birds with perch / scatter behavior
   Pure functions, no React. Used by BirdCanvas component.
   ═══════════════════════════════════════════════════════════ */

/* ───── config ───── */
export const CFG = {
  count: 25,

  /* flocking — gentle, slow, smooth */
  maxSpeed: 1.6,
  maxForce: 0.02,
  damping: 0.992,       // velocity damping per frame — creates glide
  sepDist: 35,
  aliDist: 90,
  cohDist: 120,
  sepWeight: 1.4,
  aliWeight: 1.2,
  cohWeight: 0.8,

  /* edge avoidance */
  edgeMargin: 100,
  edgeTurnForce: 0.04,

  /* rendering */
  wingSpan: 28,
  bodyLen: 16,
  tailLen: 6,
  opacity: 0.7,

  /* perching — rare, max 2 at a time */
  maxPerching: 2,
  perchChance: 0.0006,
  perchDuration: [180, 500],
  hopDist: [14, 40],
  hopFrames: 16,
  hopChance: 0.005,
  takeoffVy: -1.5,

  /* scatter */
  scatterRadius: 240,
  scatterForce: 3,
};

/* ───── helpers ───── */
function clampMag(vx, vy, max) {
  const mag = Math.sqrt(vx * vx + vy * vy);
  if (mag > max && mag > 0) {
    const s = max / mag;
    return [vx * s, vy * s];
  }
  return [vx, vy];
}

function dist(ax, ay, bx, by) {
  const dx = ax - bx,
    dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

/* ───── bird factory ───── */
export function createBird(cw, ch) {
  return {
    x: Math.random() * cw,
    y: Math.random() * ch * 0.5,
    vx: (Math.random() - 0.5) * 1,
    vy: (Math.random() - 0.5) * 0.5,

    state: "flying",
    stateTimer: 0,

    /* perch */
    perchTarget: null,
    perchX: 0,
    perchY: 0,

    /* hop */
    hopStartX: 0,
    hopEndX: 0,
    hopProgress: 0,

    /* wing */
    wingPhase: Math.random() * Math.PI * 2,
    wingSpeed: 0.04 + Math.random() * 0.02, // slow graceful flap

    /* visual variation */
    size: 0.8 + Math.random() * 0.5,
    shade: Math.random(),
  };
}

/* ───── count how many birds are perching/approaching/landing/hopping ───── */
function countPerching(birds) {
  let n = 0;
  for (const b of birds) {
    if (
      b.state === "perching" ||
      b.state === "approaching" ||
      b.state === "landing" ||
      b.state === "hopping"
    )
      n++;
  }
  return n;
}

/* ───── flocking forces (flying state only) ───── */
function flockForces(bird, birds) {
  let sepX = 0,
    sepY = 0,
    sepN = 0;
  let aliX = 0,
    aliY = 0,
    aliN = 0;
  let cohX = 0,
    cohY = 0,
    cohN = 0;

  for (const other of birds) {
    if (other === bird || other.state !== "flying") continue;
    const d = dist(bird.x, bird.y, other.x, other.y);

    if (d < CFG.sepDist && d > 0) {
      sepX += (bird.x - other.x) / d;
      sepY += (bird.y - other.y) / d;
      sepN++;
    }
    if (d < CFG.aliDist) {
      aliX += other.vx;
      aliY += other.vy;
      aliN++;
    }
    if (d < CFG.cohDist) {
      cohX += other.x;
      cohY += other.y;
      cohN++;
    }
  }

  let fx = 0,
    fy = 0;

  if (sepN > 0) {
    sepX /= sepN;
    sepY /= sepN;
    const [sx, sy] = clampMag(sepX, sepY, CFG.maxForce);
    fx += sx * CFG.sepWeight;
    fy += sy * CFG.sepWeight;
  }
  if (aliN > 0) {
    aliX /= aliN;
    aliY /= aliN;
    const [ax, ay] = clampMag(aliX - bird.vx, aliY - bird.vy, CFG.maxForce);
    fx += ax * CFG.aliWeight;
    fy += ay * CFG.aliWeight;
  }
  if (cohN > 0) {
    cohX = cohX / cohN - bird.x;
    cohY = cohY / cohN - bird.y;
    const [cx, cy] = clampMag(cohX, cohY, CFG.maxForce);
    fx += cx * CFG.cohWeight;
    fy += cy * CFG.cohWeight;
  }

  return [fx, fy];
}

function edgeForce(bird, cw, ch) {
  let fx = 0,
    fy = 0;
  const m = CFG.edgeMargin,
    f = CFG.edgeTurnForce;
  if (bird.x < m) fx += f * (1 - bird.x / m);
  if (bird.x > cw - m) fx -= f * (1 - (cw - bird.x) / m);
  if (bird.y < m) fy += f * (1 - bird.y / m);
  if (bird.y > ch - m) fy -= f * (1 - (ch - bird.y) / m);
  return [fx, fy];
}

/* ───── scatter check ───── */
function scatterImpulse(bird, scatterZones) {
  for (const zone of scatterZones) {
    const dx = bird.x - zone.cx;
    const dy = bird.y - zone.cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < CFG.scatterRadius && d > 0) {
      const strength = CFG.scatterForce * (1 - d / CFG.scatterRadius);
      return [(dx / d) * strength, (dy / d) * strength];
    }
  }
  return null;
}

/* ───── state updaters ───── */
function updateFlying(bird, birds, cw, ch, perchZones) {
  const [fx, fy] = flockForces(bird, birds);
  const [ex, ey] = edgeForce(bird, cw, ch);

  bird.vx += fx + ex;
  bird.vy += fy + ey;
  bird.vx *= CFG.damping;
  bird.vy *= CFG.damping;
  [bird.vx, bird.vy] = clampMag(bird.vx, bird.vy, CFG.maxSpeed);

  bird.x += bird.vx;
  bird.y += bird.vy;

  /* chance to perch — only if under the cap */
  if (
    perchZones.length > 0 &&
    Math.random() < CFG.perchChance &&
    countPerching(birds) < CFG.maxPerching
  ) {
    const zone = perchZones[Math.floor(Math.random() * perchZones.length)];
    bird.perchTarget = {
      x: zone.x + Math.random() * zone.w,
      y: zone.y,
      zoneIdx: zone.idx,
      zoneX: zone.x,
      zoneW: zone.w,
    };
    bird.state = "approaching";
  }
}

function updateApproaching(bird, cw, ch, scatterZones) {
  const imp = scatterImpulse(bird, scatterZones);
  if (imp) {
    bird.vx += imp[0];
    bird.vy += imp[1];
    bird.state = "flying";
    bird.perchTarget = null;
    return;
  }

  const t = bird.perchTarget;
  const dx = t.x - bird.x;
  const dy = t.y - bird.y;
  const d = Math.sqrt(dx * dx + dy * dy);

  if (d < 4) {
    bird.state = "landing";
    bird.stateTimer = 18;
    bird.perchX = t.x;
    bird.perchY = t.y;
    return;
  }

  const desiredSpeed = Math.min(CFG.maxSpeed, d * 0.05);
  const dvx = (dx / d) * desiredSpeed - bird.vx;
  const dvy = (dy / d) * desiredSpeed - bird.vy;
  const [sx, sy] = clampMag(dvx, dvy, CFG.maxForce * 2);
  bird.vx += sx;
  bird.vy += sy;
  [bird.vx, bird.vy] = clampMag(bird.vx, bird.vy, CFG.maxSpeed);

  bird.x += bird.vx;
  bird.y += bird.vy;

  const [ex, ey] = edgeForce(bird, cw, ch);
  bird.vx += ex;
  bird.vy += ey;
}

function updateLanding(bird) {
  bird.stateTimer--;
  const t = 1 - bird.stateTimer / 18;
  bird.vx *= 0.82;
  bird.vy *= 0.82;
  bird.x = lerp(bird.x, bird.perchX, t * 0.25);
  bird.y = lerp(bird.y, bird.perchY, t * 0.25);

  if (bird.stateTimer <= 0) {
    bird.x = bird.perchX;
    bird.y = bird.perchY;
    bird.vx = 0;
    bird.vy = 0;
    bird.state = "perching";
    bird.stateTimer = Math.floor(
      randRange(CFG.perchDuration[0], CFG.perchDuration[1])
    );
  }
}

function updatePerching(bird, scatterZones) {
  const imp = scatterImpulse(bird, scatterZones);
  if (imp) {
    bird.vx = imp[0] * 0.7;
    bird.vy = imp[1] * 0.7 + CFG.takeoffVy;
    bird.state = "flying";
    bird.perchTarget = null;
    return;
  }

  bird.stateTimer--;
  if (bird.stateTimer <= 0) {
    bird.vx = (Math.random() - 0.5) * 2;
    bird.vy = CFG.takeoffVy;
    bird.state = "flying";
    bird.perchTarget = null;
    return;
  }

  if (Math.random() < CFG.hopChance && bird.perchTarget) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    const hopDist = randRange(CFG.hopDist[0], CFG.hopDist[1]) * dir;
    bird.hopStartX = bird.x;
    let endX = bird.x + hopDist;
    const t = bird.perchTarget;
    endX = Math.max(t.zoneX + 4, Math.min(t.zoneX + t.zoneW - 4, endX));
    bird.hopEndX = endX;
    bird.hopProgress = 0;
    bird.state = "hopping";
  }
}

function updateHopping(bird) {
  bird.hopProgress += 1 / CFG.hopFrames;
  if (bird.hopProgress >= 1) {
    bird.x = bird.hopEndX;
    bird.perchX = bird.hopEndX;
    bird.state = "perching";
    return;
  }
  const t = bird.hopProgress;
  bird.x = lerp(bird.hopStartX, bird.hopEndX, t);
  bird.y = bird.perchY - Math.sin(t * Math.PI) * 8;
}

/* ───── main update ───── */
export function updateBoids(birds, cw, ch, perchZones, scatterZones) {
  for (const bird of birds) {
    switch (bird.state) {
      case "flying":
        updateFlying(bird, birds, cw, ch, perchZones);
        break;
      case "approaching":
        updateApproaching(bird, cw, ch, scatterZones);
        break;
      case "landing":
        updateLanding(bird);
        break;
      case "perching":
        updatePerching(bird, scatterZones);
        break;
      case "hopping":
        updateHopping(bird);
        break;
      default:
        break;
    }

    const isGrounded =
      bird.state === "perching" || bird.state === "hopping";
    bird.wingPhase += bird.wingSpeed * (isGrounded ? 0 : 1);
  }
}

/* ───── perch zone computation ───── */
export function computePerchZones(cardRects, heroRect, titleRect) {
  const zones = [];
  let idx = 0;

  if (cardRects) {
    for (const r of cardRects) {
      zones.push({
        x: r.left + 10,
        y: r.top - 2,
        w: r.width - 20,
        idx: idx++,
      });
    }
  }

  if (heroRect) {
    zones.push({
      x: heroRect.left + 10,
      y: heroRect.bottom - 2,
      w: heroRect.width - 20,
      idx: idx++,
    });
  }

  if (titleRect) {
    zones.push({
      x: titleRect.left,
      y: titleRect.bottom - 2,
      w: titleRect.width,
      idx: idx++,
    });
  }

  return zones;
}

/* ───── scatter zone computation ───── */
export function computeScatterZones(hoveredCard, cardRects) {
  if (hoveredCard == null || !cardRects || !cardRects[hoveredCard - 1])
    return [];
  const r = cardRects[hoveredCard - 1];
  return [
    {
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      w: r.width,
      h: r.height,
    },
  ];
}

/* ───── rendering ───── */
export function renderBirds(ctx, birds) {
  for (const bird of birds) {
    ctx.save();
    ctx.translate(bird.x, bird.y);

    const isGrounded =
      bird.state === "perching" ||
      bird.state === "hopping" ||
      bird.state === "landing";

    if (!isGrounded) {
      const angle = Math.atan2(bird.vy, bird.vx);
      ctx.rotate(angle);
    }

    /* wing flap — smoother sinusoidal */
    const wingFlap = isGrounded
      ? 0.05
      : Math.sin(bird.wingPhase) * 0.5;

    const s = bird.size;
    const span = CFG.wingSpan * s;
    const bodyLen = CFG.bodyLen * s;
    const tail = CFG.tailLen * s;

    /* colour — slightly lighter than #07192f */
    const shade = lerp(30, 65, bird.shade);
    const r = Math.floor(shade * 0.45);
    const g = Math.floor(shade * 0.75);
    const b = Math.floor(shade * 1.4);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${CFG.opacity})`;

    /* ── draw a more bird-shaped silhouette ── */
    const wingY = span * (0.35 + wingFlap * 0.35);

    ctx.beginPath();
    // beak tip
    ctx.moveTo(bodyLen * 0.6, 0);
    // upper body to left wingtip
    ctx.quadraticCurveTo(bodyLen * 0.1, -bodyLen * 0.15, -bodyLen * 0.3, -wingY);
    // left wing back edge
    ctx.quadraticCurveTo(-bodyLen * 0.1, -wingY * 0.3, -bodyLen * 0.2, 0);
    // tail notch
    ctx.lineTo(-bodyLen * 0.2 - tail, bodyLen * 0.05);
    ctx.lineTo(-bodyLen * 0.2, 0);
    // right wing back edge
    ctx.quadraticCurveTo(-bodyLen * 0.1, wingY * 0.3, -bodyLen * 0.3, wingY);
    // lower body back to beak
    ctx.quadraticCurveTo(bodyLen * 0.1, bodyLen * 0.15, bodyLen * 0.6, 0);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}
