export const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export const keyOf = (x, y) => `${x},${y}`;
export const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function cellSet(cells = []) {
  return new Set(cells.map(([x, y]) => keyOf(x, y)));
}

export function inBounds(arena, x, y) {
  return x >= 0 && y >= 0 && x < arena.width && y < arena.height;
}

export function isAccessible(arena, x, y, narrow = false) {
  if (!inBounds(arena, x, y) || cellSet(arena.obstacles).has(keyOf(x, y))) return false;
  return narrow || !cellSet(arena.narrow).has(keyOf(x, y));
}

export function occupied(state, x, y, ignoreId = null) {
  return state.units.some(unit => unit.active && unit.id !== ignoreId && unit.x === x && unit.y === y);
}

export function findPath(state, unit, accepts, maxDistance = 100) {
  const arena = state.arena;
  const queue = [{ x: unit.x, y: unit.y }];
  const cameFrom = new Map([[keyOf(unit.x, unit.y), null]]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const path = [];
    let walk = current;
    while (walk) {
      path.unshift([walk.x, walk.y]);
      walk = cameFrom.get(keyOf(walk.x, walk.y));
    }
    if (path.length > 1 && accepts(current.x, current.y, path.length - 1)) return path;
    if (path.length - 1 >= maxDistance) continue;
    for (const [dx, dy] of DIRECTIONS) {
      const x = current.x + dx;
      const y = current.y + dy;
      const key = keyOf(x, y);
      if (cameFrom.has(key) || !isAccessible(arena, x, y, unit.narrow) || occupied(state, x, y, unit.id)) continue;
      cameFrom.set(key, current);
      queue.push({ x, y });
    }
  }
  return null;
}

export function reachableStep(state, unit, score) {
  const options = [];
  for (const [dx, dy] of DIRECTIONS) {
    const x = unit.x + dx;
    const y = unit.y + dy;
    if (!isAccessible(state.arena, x, y, unit.narrow) || occupied(state, x, y, unit.id)) continue;
    options.push({ x, y, score: score(x, y) });
  }
  options.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
  return options[0] || null;
}
