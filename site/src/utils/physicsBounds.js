import Matter from 'matter-js';

const { Bodies, Composite } = Matter;

const WALL_OPTS = {
  isStatic: true,
  restitution: 0.8,
  friction: 0.05,
  label: 'wall',
  collisionFilter: {
    category: 0x0004,          // walls
    mask: 0x0001 | 0x0002,     // collide with centers + perimeter
  },
};

/**
 * Create 4 static wall bodies along the edges of the viewport.
 * @returns {Matter.Body[]} array of 4 wall bodies (for later removal on resize)
 */
export function createWalls(engine, w, h) {
  const thickness = 60;

  const top    = Bodies.rectangle(w / 2, -thickness / 2,       w + thickness * 2, thickness, WALL_OPTS);
  const bottom = Bodies.rectangle(w / 2, h + thickness / 2,    w + thickness * 2, thickness, WALL_OPTS);
  const left   = Bodies.rectangle(-thickness / 2, h / 2,       thickness, h + thickness * 2, WALL_OPTS);
  const right  = Bodies.rectangle(w + thickness / 2, h / 2,    thickness, h + thickness * 2, WALL_OPTS);

  const walls = [top, bottom, left, right];
  Composite.add(engine.world, walls);
  return walls;
}

/**
 * Remove wall bodies from the world.
 */
export function removeWalls(engine, walls) {
  if (!walls) return;
  walls.forEach((w) => Composite.remove(engine.world, w));
}
