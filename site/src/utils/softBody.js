import Matter from 'matter-js';

const { Bodies, Body, Composite, Constraint } = Matter;

/**
 * Create a soft-body blob: central circle + perimeter particles + spring constraints.
 *
 * @param {Matter.Engine} engine
 * @param {number} cx - center x
 * @param {number} cy - center y
 * @param {number} radius - visual radius of the node
 * @param {string} nodeId - skill id for lookup
 * @param {number} groupIndex - unique negative number per blob (for collision filtering)
 * @returns {{ center, perimeter, nodeId }}
 */
export function createSoftBody(engine, cx, cy, radius, nodeId, groupIndex) {
  const perimCount = Math.max(8, Math.round(radius / 4));
  const perimRing = radius * 0.85;

  // --- Centre body ---
  const center = Bodies.circle(cx, cy, radius, {
    restitution: 0.7,
    friction: 0.1,
    frictionAir: 0.03,
    density: 0.002,
    label: `center-${nodeId}`,
    collisionFilter: {
      category: 0x0001,     // centers
      mask: 0x0001 | 0x0004, // collide with other centers + walls
    },
  });
  center.nodeId = nodeId;

  // --- Perimeter particles ---
  const perimeter = [];
  for (let i = 0; i < perimCount; i++) {
    const angle = (Math.PI * 2 * i) / perimCount;
    const px = cx + Math.cos(angle) * perimRing;
    const py = cy + Math.sin(angle) * perimRing;

    const particle = Bodies.circle(px, py, 2, {
      restitution: 0.5,
      friction: 0.05,
      frictionAir: 0.01,
      density: 0.0005,
      label: `perim-${nodeId}-${i}`,
      collisionFilter: {
        group: groupIndex, // negative → same-group won't collide with each other
        category: 0x0002,  // perimeter
        mask: 0x0004,      // only collide with walls
      },
    });
    perimeter.push(particle);
  }

  // --- Radial springs (center → each perimeter particle) ---
  const radialConstraints = perimeter.map((p) =>
    Constraint.create({
      bodyA: center,
      bodyB: p,
      stiffness: 0.2,
      damping: 0.05,
      length: perimRing,
      render: { visible: false },
    })
  );

  // --- Circumferential springs (adjacent perimeter particles) ---
  const chordLen =
    2 * perimRing * Math.sin(Math.PI / perimCount);
  const circumConstraints = perimeter.map((p, i) =>
    Constraint.create({
      bodyA: p,
      bodyB: perimeter[(i + 1) % perimCount],
      stiffness: 0.1,
      damping: 0.03,
      length: chordLen,
      render: { visible: false },
    })
  );

  // Add everything to world
  Composite.add(engine.world, [
    center,
    ...perimeter,
    ...radialConstraints,
    ...circumConstraints,
  ]);

  return { center, perimeter, nodeId, radius };
}

/**
 * Remove a soft body from the engine world.
 */
export function removeSoftBody(engine, sb) {
  Composite.remove(engine.world, sb.center);
  sb.perimeter.forEach((p) => Composite.remove(engine.world, p));
}
