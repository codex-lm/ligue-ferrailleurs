export const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export function translation(x, y, z) {
  const out = identity();
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

export function scaling(x, y = x, z = x) {
  const out = identity();
  out[0] = x; out[5] = y; out[10] = z;
  return out;
}

export function rotationX(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

export function rotationY(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

export function rotationZ(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function quaternion(x, y, z, w) {
  const out = identity();
  out[0] = 1 - 2 * y * y - 2 * z * z;
  out[1] = 2 * x * y + 2 * z * w;
  out[2] = 2 * x * z - 2 * y * w;
  out[4] = 2 * x * y - 2 * z * w;
  out[5] = 1 - 2 * x * x - 2 * z * z;
  out[6] = 2 * y * z + 2 * x * w;
  out[8] = 2 * x * z + 2 * y * w;
  out[9] = 2 * y * z - 2 * x * w;
  out[10] = 1 - 2 * x * x - 2 * y * y;
  return out;
}

export function compose(position = [0, 0, 0], yaw = 0, scale = 1, pitch = 0, roll = 0) {
  return multiply(translation(...position), multiply(rotationY(yaw), multiply(rotationX(pitch), multiply(rotationZ(roll), scaling(scale)))));
}

export function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
  ];
}

export function transformDirection(matrix, point) {
  const [x, y, z] = point;
  const out = [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z
  ];
  const length = Math.hypot(...out) || 1;
  return out.map(value => value / length);
}

export function lookAt(eye, target, up = [0, 1, 0]) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let length = Math.hypot(zx, zy, zz);
  zx /= length; zy /= length; zz /= length;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  length = Math.hypot(xx, xy, xz);
  xx /= length; xy /= length; xz /= length;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1
  ]);
}

export function orthographic(left, right, bottom, top, near, far) {
  return new Float32Array([
    2 / (right - left), 0, 0, 0,
    0, 2 / (top - bottom), 0, 0,
    0, 0, -2 / (far - near), 0,
    -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1
  ]);
}

export function project(matrix, point, width, height) {
  const [x, y, z] = point;
  const cx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const cy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  return [(cx * 0.5 + 0.5) * width, (0.5 - cy * 0.5) * height];
}
