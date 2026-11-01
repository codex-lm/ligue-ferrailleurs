export function cubeGeometry() {
  const positions = [];
  const normals = [];
  const indices = [];
  const faces = [
    [[1, 0, 0], [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]]],
    [[-1, 0, 0], [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]]],
    [[0, 1, 0], [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]]],
    [[0, -1, 0], [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]]],
    [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
    [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]]
  ];
  faces.forEach(([normal, corners], face) => {
    corners.forEach(corner => { positions.push(...corner); normals.push(...normal); });
    const base = face * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { positions, normals, indices, color: [1, 1, 1, 1], emissive: [0, 0, 0] };
}

export function discGeometry(segments = 32) {
  const positions = [0, 0, 0];
  const normals = [0, 1, 0];
  const indices = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    positions.push(Math.cos(angle), 0, Math.sin(angle));
    normals.push(0, 1, 0);
    if (index < segments) indices.push(0, index + 1, index + 2);
  }
  return { positions, normals, indices, color: [1, 1, 1, 1], emissive: [0, 0, 0] };
}
