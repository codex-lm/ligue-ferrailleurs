import { identity, multiply, quaternion, rotationX, rotationY, rotationZ, scaling, transformDirection, transformPoint, translation } from './math.js';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPES = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

function nodeMatrix(node) {
  if (node.matrix) return new Float32Array(node.matrix);
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  return multiply(translation(...(node.translation || [0, 0, 0])), multiply(quaternion(x, y, z, w), scaling(...(node.scale || [1, 1, 1]))));
}

function accessor(gltf, binary, index) {
  const info = gltf.accessors[index];
  const view = gltf.bufferViews[info.bufferView];
  const Type = TYPES[info.componentType];
  const count = COMPONENTS[info.type];
  const stride = view.byteStride || count * Type.BYTES_PER_ELEMENT;
  const start = (view.byteOffset || 0) + (info.byteOffset || 0);
  const data = [];
  for (let item = 0; item < info.count; item += 1) {
    const offset = start + item * stride;
    const values = [];
    for (let component = 0; component < count; component += 1) {
      const byte = offset + component * Type.BYTES_PER_ELEMENT;
      if (info.componentType === 5126) values.push(new DataView(binary).getFloat32(byte, true));
      else if (info.componentType === 5125) values.push(new DataView(binary).getUint32(byte, true));
      else if (info.componentType === 5123) values.push(new DataView(binary).getUint16(byte, true));
      else values.push(new DataView(binary).getUint8(byte));
    }
    data.push(values);
  }
  return data;
}

function parse(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Invalid GLB header');
  const length = view.getUint32(8, true);
  let offset = 12;
  let gltf = null;
  let binary = null;
  while (offset < length) {
    const size = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = buffer.slice(offset + 8, offset + 8 + size);
    if (type === 0x4e4f534a) gltf = JSON.parse(new TextDecoder().decode(chunk));
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + size;
  }
  const groups = new Map();
  const visit = (nodeIndex, parent) => {
    const node = gltf.nodes[nodeIndex];
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const material = gltf.materials?.[primitive.material] || {};
        const pbr = material.pbrMetallicRoughness || {};
        const color = pbr.baseColorFactor || [0.7, 0.7, 0.7, 1];
        const emissive = material.emissiveFactor || [0, 0, 0];
        const key = JSON.stringify({ color, emissive });
        if (!groups.has(key)) groups.set(key, { color, emissive, positions: [], normals: [], indices: [] });
        const group = groups.get(key);
        const positions = accessor(gltf, binary, primitive.attributes.POSITION);
        const normals = primitive.attributes.NORMAL === undefined ? positions.map(() => [0, 1, 0]) : accessor(gltf, binary, primitive.attributes.NORMAL);
        const base = group.positions.length / 3;
        positions.forEach((position, index) => {
          group.positions.push(...transformPoint(world, position));
          group.normals.push(...transformDirection(world, normals[index]));
        });
        const indices = primitive.indices === undefined ? positions.map((_, index) => [index]) : accessor(gltf, binary, primitive.indices);
        indices.forEach(index => group.indices.push(base + index[0]));
      }
    }
    (node.children || []).forEach(child => visit(child, world));
  };
  const roots = gltf.scenes?.[gltf.scene || 0]?.nodes || gltf.nodes.map((_, index) => index);
  roots.forEach(node => visit(node, identity()));
  return { meshes: [...groups.values()] };
}

export class ModelLibrary {
  constructor(base = '../../assets/models/') {
    this.base = base;
    this.cache = new Map();
  }

  async load(name) {
    if (!this.cache.has(name)) {
      this.cache.set(name, fetch(`${this.base}${name}.glb`).then(response => {
        if (!response.ok) throw new Error(`Unable to load ${name}: ${response.status}`);
        return response.arrayBuffer();
      }).then(parse));
    }
    return this.cache.get(name);
  }

  async loadAll(names, onProgress = null) {
    let loaded = 0;
    await Promise.all(names.map(async name => {
      await this.load(name);
      loaded += 1;
      onProgress?.(loaded, names.length);
    }));
  }
}
