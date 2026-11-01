import { CHASSIS, MODULES } from '../data/catalog.js';
import { ModelLibrary } from './glb.js';
import { compose, identity, lookAt, multiply, orthographic, project, scaling, translation } from './math.js';
import { cubeGeometry, discGeometry } from './geometry.js';

const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uViewProjection;
out vec3 vNormal;
out vec3 vWorld;
void main(){ vec4 world=uModel*vec4(aPosition,1.0); vWorld=world.xyz; vNormal=mat3(uModel)*aNormal; gl_Position=uViewProjection*world; }`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec4 uColor;
uniform vec3 uEmissive;
uniform vec4 uTint;
out vec4 outColor;
void main(){ vec3 n=normalize(vNormal); float key=max(0.0,dot(n,normalize(vec3(-0.4,0.85,0.45)))); float fill=max(0.0,dot(n,normalize(vec3(0.65,0.25,-0.5)))); vec3 light=vec3(0.43)+key*0.65+fill*0.18; vec3 color=uColor.rgb*uTint.rgb*light+uEmissive*0.35; float rim=pow(1.0-max(0.0,n.y),3.0)*0.035; outColor=vec4(color+rim,uColor.a*uTint.a); }`;

function shader(gl, type, source) {
  const value = gl.createShader(type);
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
  return value;
}

function gridPosition(arena, x, y) {
  return [(x - (arena.width - 1) / 2) * 1.25, 0, (y - (arena.height - 1) / 2) * 1.25];
}

export class Renderer {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    if (!this.gl) throw new Error('WebGL 2 is required');
    const gl = this.gl;
    this.program = gl.createProgram();
    gl.attachShader(this.program, shader(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(this.program, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearColor(0.055, 0.035, 0.075, 1);
    this.library = new ModelLibrary();
    this.gpu = new Map();
    this.attachments = null;
    this.animations = new Map();
    this.effects = [];
    this.lastEvent = 0;
    this.pickRegions = [];
    this.time = 0;
    this.basic = { cube: this.upload(cubeGeometry()), disc: this.upload(discGeometry()) };
  }

  async load() {
    const names = [
      ...Object.values(CHASSIS).map(item => item.model),
      ...Object.values(MODULES).map(item => item.model),
      'workshop', 'arena-workbench', 'arena-rooftop', 'arena-greenhouse',
      'obstacle-crate', 'obstacle-gear', 'obstacle-spool'
    ];
    const [attachments] = await Promise.all([
      fetch('../../assets/models/attachments.json').then(response => response.json()),
      this.library.loadAll([...new Set(names)])
    ]);
    this.attachments = attachments;
  }

  upload(mesh) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vertices = new Float32Array(mesh.positions.length * 2);
    for (let index = 0; index < mesh.positions.length / 3; index += 1) {
      vertices.set(mesh.positions.slice(index * 3, index * 3 + 3), index * 6);
      vertices.set(mesh.normals.slice(index * 3, index * 3 + 3), index * 6 + 3);
    }
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: mesh.indices.length, color: mesh.color, emissive: mesh.emissive };
  }

  resize() {
    const ratio = Math.min(1.6, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = this.overlay.width = width;
      this.canvas.height = this.overlay.height = height;
    }
  }

  begin(workshop = false) {
    this.resize();
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const aspect = this.canvas.width / this.canvas.height;
    const halfHeight = workshop ? (aspect < 1.2 ? 5.7 : 3.8) : (aspect < 1.25 ? 8.8 : 6.25);
    const projection = orthographic(-halfHeight * aspect, halfHeight * aspect, -halfHeight, halfHeight, 0.1, 100);
    const view = lookAt(workshop ? [6, 4.4, 9] : [9, 12, 13], workshop ? [0, 0.8, 0] : [0, 0, 0]);
    this.viewProjection = multiply(projection, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'uViewProjection'), false, this.viewProjection);
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.pickRegions = [];
  }

  drawMesh(mesh, model, tint = [1, 1, 1, 1], color = null) {
    const gl = this.gl;
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'uModel'), false, model);
    gl.uniform4fv(gl.getUniformLocation(this.program, 'uColor'), color || mesh.color);
    gl.uniform3fv(gl.getUniformLocation(this.program, 'uEmissive'), mesh.emissive || [0, 0, 0]);
    gl.uniform4fv(gl.getUniformLocation(this.program, 'uTint'), tint);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
  }

  drawBasic(kind, model, color) {
    this.drawMesh(this.basic[kind], model, [1, 1, 1, 1], color);
  }

  async drawModel(name, model, tint) {
    const asset = await this.library.load(name);
    if (!this.gpu.has(name)) this.gpu.set(name, asset.meshes.map(mesh => this.upload(mesh)));
    this.gpu.get(name).forEach(mesh => this.drawMesh(mesh, model, tint));
  }

  drawRobot(unit, position, yaw, time, selected = false, result = null) {
    const animation = this.animations.get(unit.id) || {};
    const elapsed = time - (animation.start || -10000);
    let bob = Math.sin(time * 0.006 + unit.id.length) * 0.018;
    let pitch = 0;
    let roll = 0;
    if (animation.type === 'move' && elapsed < 280) bob += Math.abs(Math.sin(elapsed / 280 * Math.PI * 3)) * 0.11;
    if (animation.type === 'attack' && elapsed < 240) pitch = -Math.sin(elapsed / 240 * Math.PI) * 0.24;
    if (animation.type === 'repair' && elapsed < 450) bob += Math.sin(elapsed / 450 * Math.PI) * 0.14;
    if (!unit.active) { roll = 1.25; bob = -0.18; }
    if (result && result.winner === unit.team && unit.active) bob += Math.abs(Math.sin(time * 0.009)) * 0.2;
    const model = compose([position[0], position[1] + bob, position[2]], yaw, 0.9, pitch, roll);
    this.drawModel(CHASSIS[unit.chassis].model, model, unit.team === 'enemy' ? [1, 0.88, 0.9, 1] : [1, 1, 1, 1]);
    const sockets = this.attachments?.sockets[unit.chassis] || {};
    unit.modules.forEach((entry, index) => {
      const point = sockets[entry.socket] || [0, 0.8, 0];
      const socketYaw = this.attachments?.moduleRotationY[entry.socket] || 0;
      let moduleModel = multiply(model, multiply(translation(...point), compose([0, 0, 0], socketYaw)));
      if (animation.type === 'attack' && animation.module === entry.id && elapsed < 240) {
        moduleModel = multiply(moduleModel, translation(0, 0, -Math.sin(elapsed / 240 * Math.PI) * 0.16));
      }
      if (animation.type === 'repair' && entry.id === 'repair' && elapsed < 450) {
        moduleModel = multiply(moduleModel, compose([0, Math.sin(elapsed * 0.03) * 0.08, 0], elapsed * 0.02));
      }
      this.drawModel(MODULES[entry.id].model, moduleModel, unit.team === 'enemy' ? [1, 0.88, 0.9, 1] : [1, 1, 1, 1]);
    });
    if (selected) this.drawBasic('disc', multiply(translation(position[0], 0.035, position[2]), scaling(0.7, 1, 0.7)), [0.62, 1, 0.12, 1]);
  }

  processEvents(state, time) {
    for (const event of state.events) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      if (event.type === 'move') this.animations.set(event.unit, { type: 'move', start: time, from: event.from });
      if (event.type === 'attack' || event.type === 'blast') {
        this.animations.set(event.unit, { type: 'attack', start: time, module: event.module, target: event.target });
        this.effects.push({ type: 'shot', start: time, source: event.unit, target: event.target, color: event.type === 'blast' ? '#ff762f' : '#c7ff45' });
      }
      if (event.type === 'repair') {
        this.animations.set(event.unit, { type: 'repair', start: time });
        this.effects.push({ type: 'repair', start: time, target: event.target });
      }
      if (event.type === 'disabled') this.effects.push({ type: 'disabled', start: time, x: event.x, y: event.y });
    }
    this.effects = this.effects.filter(effect => time - effect.start < 650);
  }

  unitPosition(state, unit, time) {
    const position = gridPosition(state.arena, unit.x, unit.y);
    const animation = this.animations.get(unit.id);
    if (animation?.type === 'move' && time - animation.start < 260) {
      const from = gridPosition(state.arena, animation.from[0], animation.from[1]);
      const t = Math.min(1, (time - animation.start) / 260);
      const smooth = t * t * (3 - 2 * t);
      return from.map((value, index) => value + (position[index] - value) * smooth);
    }
    return position;
  }

  bar(unit, position, selected) {
    const point = project(this.viewProjection, [position[0], position[1] + 1.65, position[2]], this.overlay.width, this.overlay.height);
    const width = selected ? 72 : 58;
    const ratio = Math.max(0, unit.hp / unit.maxHp);
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(20,10,28,.88)';
    ctx.fillRect(point[0] - width / 2 - 2, point[1] - 2, width + 4, 10);
    ctx.fillStyle = unit.team === 'player' ? '#b9f33c' : '#ff7138';
    ctx.fillRect(point[0] - width / 2, point[1], width * ratio, 6);
    if (selected) {
      ctx.font = '600 13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f4efdf';
      ctx.fillText(unit.name, point[0], point[1] - 9);
    }
    this.pickRegions.push({ type: 'unit', id: unit.id, x: point[0], y: point[1] + 25, radius: 38 });
    return point;
  }

  renderBattle(state, selectedId, time = performance.now()) {
    this.time = time;
    this.processEvents(state, time);
    this.begin(false);
    this.drawModel(`arena-${state.arena.kit}`, identity());
    const narrow = new Set(state.arena.narrow.map(cell => cell.join(',')));
    const blocked = new Set(state.arena.obstacles.map(cell => cell.join(',')));
    for (let y = 0; y < state.arena.height; y += 1) {
      for (let x = 0; x < state.arena.width; x += 1) {
        const key = `${x},${y}`;
        if (blocked.has(key)) continue;
        const position = gridPosition(state.arena, x, y);
        const selectedUnit = state.units.find(unit => unit.id === selectedId && unit.x === x && unit.y === y);
        const color = narrow.has(key) ? [0.35, 0.55, 0.18, 1] : (x + y) % 2 ? [0.25, 0.19, 0.29, 1] : [0.3, 0.23, 0.34, 1];
        if (selectedUnit) color.splice(0, 3, 0.38, 0.53, 0.18);
        this.drawBasic('cube', multiply(translation(position[0], -0.02, position[2]), scaling(1.18, 0.08, 1.18)), color);
        const screen = project(this.viewProjection, position, this.overlay.width, this.overlay.height);
        this.pickRegions.push({ type: 'cell', x: Math.round(screen[0]), y: Math.round(screen[1]), gridX: x, gridY: y, radius: 25 });
      }
    }
    state.arena.obstacles.forEach(([x, y], index) => {
      const position = gridPosition(state.arena, x, y);
      const modelName = ['obstacle-crate', 'obstacle-gear', 'obstacle-spool'][(index + state.arena.id.length) % 3];
      this.drawModel(modelName, compose(position, index * 0.7, 0.85));
    });
    const sorted = state.units.slice().sort((a, b) => a.x + a.y - b.x - b.y);
    const screenPoints = new Map();
    sorted.forEach(unit => {
      const position = this.unitPosition(state, unit, time);
      const animation = this.animations.get(unit.id);
      let yaw = unit.team === 'player' ? Math.PI / 2 : -Math.PI / 2;
      if (animation?.target) {
        const target = state.units.find(other => other.id === animation.target);
        if (target) yaw = Math.atan2(target.x - unit.x, target.y - unit.y);
      }
      this.drawBasic('disc', multiply(translation(position[0], 0.025, position[2]), scaling(0.53, 1, 0.53)), unit.team === 'player' ? [0.36, 0.62, 0.1, 1] : [0.75, 0.19, 0.055, 1]);
      this.drawRobot(unit, position, yaw, time, unit.id === selectedId, state.result);
      screenPoints.set(unit.id, this.bar(unit, position, unit.id === selectedId));
    });
    for (const effect of this.effects) {
      const age = time - effect.start;
      const alpha = 1 - age / 650;
      const ctx = this.ctx;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (effect.type === 'shot') {
        const from = screenPoints.get(effect.source), to = screenPoints.get(effect.target);
        if (from && to) {
          ctx.strokeStyle = effect.color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(...from); ctx.lineTo(...to); ctx.stroke();
          ctx.fillStyle = '#fff4cf'; ctx.beginPath(); ctx.arc(to[0], to[1] + 20, 8 + age / 35, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        const unit = state.units.find(candidate => candidate.id === effect.target);
        const point = unit ? screenPoints.get(unit.id) : project(this.viewProjection, gridPosition(state.arena, effect.x, effect.y), this.overlay.width, this.overlay.height);
        if (point) {
          ctx.strokeStyle = effect.type === 'repair' ? '#b9f33c' : '#ff7138'; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.arc(point[0], point[1] + 15, 12 + age / 18, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  renderWorkshop(units, selectedIndex, time = performance.now()) {
    this.time = time;
    this.begin(true);
    this.drawModel('workshop', identity());
    units.forEach((unit, index) => {
      const x = (index - 1) * 2.05;
      this.drawBasic('cube', translation(x, 0.04, 0.25), index === selectedIndex ? [0.45, 0.62, 0.16, 1] : [0.23, 0.12, 0.29, 1]);
      this.drawBasic('cube', multiply(translation(x, -0.03, 0.25), scaling(1.45, 0.2, 1.45)), [0.43, 0.47, 0.49, 1]);
      const runtime = { ...unit, id: unit.id || `work-${index}`, team: 'player', active: true, hp: 1, maxHp: 1 };
      this.drawRobot(runtime, [x, 0.18, 0.25], Math.sin(time * 0.0005 + index) * 0.1, time, false);
      const point = project(this.viewProjection, [x, 0.7, 0.25], this.overlay.width, this.overlay.height);
      this.pickRegions.push({ type: 'work-unit', index, x: point[0], y: point[1], radius: 65 });
    });
  }

  pick(clientX, clientY) {
    const rect = this.overlay.getBoundingClientRect();
    const x = (clientX - rect.left) * this.overlay.width / rect.width;
    const y = (clientY - rect.top) * this.overlay.height / rect.height;
    return this.pickRegions.filter(region => Math.hypot(region.x - x, region.y - y) <= region.radius * this.overlay.width / rect.width)
      .sort((a, b) => (a.type === 'unit' ? -1 : 0) - (b.type === 'unit' ? -1 : 0))[0] || null;
  }
}
