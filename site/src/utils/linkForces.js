import Matter from 'matter-js';

const { Body } = Matter;

/**
 * Apply spring-like attraction between linked nodes (replaces d3.forceLink).
 * Only pulls when distance exceeds restLength ("slack rope" behaviour).
 * Call once per frame inside a beforeUpdate handler.
 *
 * @param {Array<{source:string, target:string}>} links
 * @param {Map<string, Matter.Body|{center: Matter.Body}>} bodyMap
 * @param {number} [strength=0.00005]
 * @param {number} [restLength=130]
 */
export function applyLinkForces(links, bodyMap, strength = 0.00005, restLength = 130) {
  for (const link of links) {
    const entryA = bodyMap.get(link.source);
    const entryB = bodyMap.get(link.target);
    const a = entryA?.center ?? entryA;
    const b = entryB?.center ?? entryB;
    if (!a || !b) continue;

    const dx = b.position.x - a.position.x;
    const dy = b.position.y - a.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const displacement = dist - restLength;

    // Slack rope: only pull when stretched beyond rest length
    if (displacement <= 0) continue;

    const forceMag = displacement * strength;
    const fx = (dx / dist) * forceMag;
    const fy = (dy / dist) * forceMag;

    Body.applyForce(a, a.position, { x: fx * 0.5, y: fy * 0.5 });
    Body.applyForce(b, b.position, { x: -fx * 0.5, y: -fy * 0.5 });
  }
}

/**
 * Gentle force pulling all bodies toward a center point (replaces d3.forceCenter).
 *
 * @param {Matter.Body[]} bodies  array of centre bodies
 * @param {number} cx
 * @param {number} cy
 * @param {number} [strength=0.0001]
 */
export function applyCenterForce(bodies, cx, cy, strength = 0.0001) {
  for (const b of bodies) {
    const dx = cx - b.position.x;
    const dy = cy - b.position.y;
    Body.applyForce(b, b.position, { x: dx * strength, y: dy * strength });
  }
}

/**
 * Inverse-square repulsion between all centre bodies (replaces d3.forceManyBody).
 *
 * @param {Matter.Body[]} bodies
 * @param {number} [strength=0.0003]
 * @param {number} [cutoff=200]   max distance to apply repulsion
 */
export function applyRepulsion(bodies, strength = 0.0003, cutoff = 200) {
  const cutoffSq = cutoff * cutoff;
  const n = bodies.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > cutoffSq || distSq < 1) continue;

      const dist = Math.sqrt(distSq);
      const force = strength / distSq;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      Body.applyForce(a, a.position, { x: -fx, y: -fy });
      Body.applyForce(b, b.position, { x: fx, y: fy });
    }
  }
}
