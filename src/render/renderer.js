import { CHASSIS, MODULES } from '../data/catalog.js';
import { ModelLibrary } from './glb.js';
import { compose, identity, lookAt, multiply, orthographic, project, scaling, transformPoint, translation } from './math.js';
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
void main(){ vec3 n=normalize(vNormal); float key=max(0.0,dot(n,normalize(vec3(-0.4,0.85,0.45)))); float fill=max(0.0,dot(n,normalize(vec3(0.65,0.25,-0.5)))); vec3 light=vec3(0.43)+key*0.65+fill*0.18; vec3 color=uColor.rgb*uTint.rgb*light+uEmissive*0.35; float rim=pow(1.0-max(0.0,n.y),3.0)*0.025; outColor=vec4(color+rim,1.0); }`;

const COLORS = {
  ally: '#c4f15a', enemy: '#ff805e', selection: '#ffffff', heal: '#64dec2',
  shield: '#81bfff', order: '#ffd166', danger: '#ff9ba6', history: '#b9adca', text: '#f7f1e8'
};

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

function badgeFor(state, unit, lab = false) {
  const index = state.units.filter(other => other.team === unit.team).findIndex(other => other.id === unit.id);
  if (lab) return `${unit.team === 'player' ? 'A' : 'B'}${index + 1}`;
  return unit.team === 'player' ? String(index + 1) : String.fromCharCode(65 + index);
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
    gl.clearColor(0.09, 0.075, 0.122, 1);
    this.library = new ModelLibrary();
    this.gpu = new Map();
    this.attachments = null;
    this.animations = new Map();
    this.effects = [];
    this.lastEvent = 0;
    this.pickRegions = [];
    this.time = 0;
    this.stats = { drawCalls: 0 };
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
      fetch(new URL('../../assets/models/attachments.json', import.meta.url)).then(response => {
        if (!response.ok) throw new Error(`Attachment manifest: ${response.status}`);
        return response.json();
      }),
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
    this.pixelRatio = ratio;
    this.viewWidth = this.canvas.clientWidth;
    this.viewHeight = this.canvas.clientHeight;
  }

  begin(workshop = false, camera = {}) {
    this.resize();
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const aspect = this.canvas.width / this.canvas.height;
    const zoom = camera.zoom || 1;
    const halfHeight = (workshop ? (aspect < 1.1 ? 4.7 : 3.15) : Math.max(4.7, 8.2 / aspect)) / zoom;
    const projection = orthographic(-halfHeight * aspect, halfHeight * aspect, -halfHeight, halfHeight, 0.1, 100);
    const pan = camera.pan || [0, 0];
    const view = workshop
      ? lookAt([6, 4.4, 9], [0, 0.8, 0])
      : lookAt([9 + pan[0], 12, 13 + pan[1]], [pan[0], 0, pan[1]]);
    this.viewProjection = multiply(projection, view);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'uViewProjection'), false, this.viewProjection);
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);
    this.pickRegions = [];
    this.stats.drawCalls = 0;
  }

  drawMesh(mesh, model, tint = [1, 1, 1, 1], color = null) {
    const gl = this.gl;
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'uModel'), false, model);
    gl.uniform4fv(gl.getUniformLocation(this.program, 'uColor'), color || mesh.color);
    gl.uniform3fv(gl.getUniformLocation(this.program, 'uEmissive'), mesh.emissive || [0, 0, 0]);
    gl.uniform4fv(gl.getUniformLocation(this.program, 'uTint'), tint);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    this.stats.drawCalls += 1;
  }

  drawBasic(kind, model, color) {
    this.drawMesh(this.basic[kind], model, [1, 1, 1, 1], color);
  }

  async drawModel(name, model, tint = [1, 1, 1, 1]) {
    const asset = await this.library.load(name);
    if (!this.gpu.has(name)) this.gpu.set(name, asset.meshes.map(mesh => this.upload(mesh)));
    this.gpu.get(name).forEach(mesh => this.drawMesh(mesh, model, tint));
  }

  drawRobot(unit, position, yaw, time, options = {}) {
    const animation = this.animations.get(unit.id) || {};
    const reduced = options.reducedMotion;
    const elapsed = reduced ? 10000 : time - (animation.start || -10000);
    let bob = reduced ? 0 : Math.sin(time * 0.004 + unit.id.length) * 0.012;
    let pitch = 0;
    let roll = 0;
    if (animation.type === 'move' && elapsed < 220) bob += Math.abs(Math.sin(elapsed / 220 * Math.PI * 2)) * 0.075;
    if (animation.type === 'attack' && elapsed < 240) pitch = -Math.sin(elapsed / 240 * Math.PI) * (unit.chassis === 'heavy' ? 0.12 : 0.2);
    if (animation.type === 'repair' && elapsed < 350) bob += Math.sin(elapsed / 350 * Math.PI) * 0.09;
    if (!unit.active) { roll = 1.15; bob = -0.24; pitch = 0.16; }
    if (options.result && options.result.winner === unit.team && unit.active && !reduced) bob += Math.abs(Math.sin(time * 0.007)) * 0.12;
    const scale = options.scale || 1;
    const model = compose([position[0], position[1] + bob, position[2]], yaw, scale, pitch, roll);
    const tint = unit.active ? [1, 1, 1, 1] : [0.48, 0.44, 0.52, 1];
    this.drawModel(CHASSIS[unit.chassis].model, model, tint);
    const sockets = this.attachments?.sockets[unit.chassis] || {};
    unit.modules.forEach(entry => {
      const point = sockets[entry.socket] || [0, 0.8, 0];
      const socketYaw = this.attachments?.moduleRotationY[entry.socket] || 0;
      let moduleModel = multiply(model, multiply(translation(...point), compose([0, 0, 0], socketYaw)));
      if (animation.type === 'attack' && animation.module === entry.id && elapsed < 260) {
        if (entry.id === 'blade') moduleModel = multiply(moduleModel, compose([0, 0, 0], elapsed * 0.09));
        else if (entry.id === 'hammer') moduleModel = multiply(moduleModel, compose([0, 0, 0], 0, -Math.sin(elapsed / 260 * Math.PI) * 0.7));
        else moduleModel = multiply(moduleModel, translation(0, 0, -Math.sin(elapsed / 260 * Math.PI) * 0.16));
      }
      if (animation.type === 'repair' && entry.id === 'repair' && elapsed < 350) moduleModel = multiply(moduleModel, compose([0, 0.08, 0], elapsed * 0.015));
      const highlighted = options.highlightSocket === entry.socket || (unit.overload?.moduleId === entry.id && unit.overload.until > (options.tick ?? Infinity));
      const moduleTint = highlighted ? [1.3, 1.18, 0.62, 1] : tint;
      this.drawModel(MODULES[entry.id].model, moduleModel, moduleTint);
    });
  }

  processEvents(state, time) {
    if (!state.events) return;
    for (const event of state.events) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      if (event.type === 'move') {
        this.animations.set(event.unit, { type: 'move', start: time, from: event.from });
        this.effects.push({ ...event, effectType: 'move', start: time, duration: 1200 });
      }
      if (event.type === 'attack' || event.type === 'blast') {
        this.animations.set(event.unit, { type: 'attack', start: time, module: event.module, target: event.target });
        const existing = this.effects.find(effect => effect.actionId === event.actionId && effect.effectType === 'shot');
        if (existing) existing.victims.push(event);
        else this.effects.push({ ...event, effectType: 'shot', start: time, duration: event.module === 'mortar' ? 460 : 320, victims: [event] });
      }
      if (event.type === 'repair') {
        this.animations.set(event.unit, { type: 'repair', start: time });
        this.effects.push({ ...event, effectType: 'repair', start: time, duration: 520 });
      }
      if (event.type === 'disabled') this.effects.push({ ...event, effectType: 'disabled', start: time, duration: 800 });
    }
    this.effects = this.effects.filter(effect => time - effect.start < effect.duration);
  }

  unitPosition(state, unit, time, reduced = false) {
    const position = gridPosition(state.arena, unit.x, unit.y);
    const animation = this.animations.get(unit.id);
    if (!reduced && animation?.type === 'move' && time - animation.start < 200) {
      const from = gridPosition(state.arena, animation.from[0], animation.from[1]);
      const progress = Math.min(1, (time - animation.start) / 200);
      const smooth = progress * progress * (3 - 2 * progress);
      return from.map((value, index) => value + (position[index] - value) * smooth);
    }
    return position;
  }

  screen(point, height = 0) {
    return project(this.viewProjection, [point[0], point[1] + height, point[2]], this.viewWidth, this.viewHeight);
  }

  socketScreen(state, unit, cell, socket, targetCell) {
    const position = gridPosition(state.arena, cell[0], cell[1]);
    const yaw = targetCell ? Math.atan2(targetCell[0] - cell[0], targetCell[1] - cell[1]) : (unit.team === 'player' ? Math.PI / 2 : -Math.PI / 2);
    const local = this.attachments?.sockets[unit.chassis]?.[socket] || [0, 0.85, 0];
    const model = compose(position, yaw, 1);
    return this.screen(transformPoint(model, local));
  }

  line(from, to, color, width = 2, dash = [], alpha = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.setLineDash(dash);
    ctx.strokeStyle = '#17131f';
    ctx.lineWidth = width + 3;
    ctx.beginPath(); ctx.moveTo(...from); ctx.lineTo(...to); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(...from); ctx.lineTo(...to); ctx.stroke();
    ctx.restore();
  }

  arrow(from, to, color, dashed = false, alpha = 1) {
    this.line(from, to, color, dashed ? 2 : 2.5, dashed ? [7, 6] : [], alpha);
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(to[0] - Math.cos(angle - 0.55) * 10, to[1] - Math.sin(angle - 0.55) * 10);
    ctx.lineTo(...to);
    ctx.lineTo(to[0] - Math.cos(angle + 0.55) * 10, to[1] - Math.sin(angle + 0.55) * 10);
    ctx.stroke();
    ctx.restore();
  }

  corners(point, color, size = 12, radius = 18) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#17131f'; ctx.lineWidth = 5;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(point[0] + sx * radius, point[1] + sy * radius - sy * size);
      ctx.lineTo(point[0] + sx * radius, point[1] + sy * radius);
      ctx.lineTo(point[0] + sx * radius - sx * size, point[1] + sy * radius);
      ctx.stroke();
    }
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(point[0] + sx * radius, point[1] + sy * radius - sy * size);
      ctx.lineTo(point[0] + sx * radius, point[1] + sy * radius);
      ctx.lineTo(point[0] + sx * radius - sx * size, point[1] + sy * radius);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawGridLabels(state) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#c5bbce';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.72;
    for (let x = 0; x < state.arena.width; x += 1) {
      const point = this.screen(gridPosition(state.arena, x, -0.62));
      ctx.fillText(String.fromCharCode(65 + x), point[0], point[1]);
    }
    for (let y = 0; y < state.arena.height; y += 1) {
      const point = this.screen(gridPosition(state.arena, -0.62, y));
      ctx.fillText(String(y + 1), point[0], point[1]);
    }
    ctx.restore();
  }

  drawIntent(state, unit, intent, options) {
    if (!intent || intent.type === 'wait' || intent.type === 'disabled') return;
    const actorPosition = gridPosition(state.arena, unit.x, unit.y);
    const color = unit.team === 'player' ? COLORS.ally : COLORS.enemy;
    if (intent.type === 'move' && intent.destination) {
      const destination = gridPosition(state.arena, ...intent.destination);
      this.arrow(this.screen(actorPosition, 0.08), this.screen(destination, 0.08), intent.reason === 'retreat' ? COLORS.order : color, true, 0.9);
      const ctx = this.ctx;
      const point = this.screen(destination, 0.1);
      ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(point[0], point[1], 24, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      return;
    }
    const target = state.units.find(other => other.id === intent.targetId && other.active);
    if (!target) return;
    const from = this.socketScreen(state, unit, [unit.x, unit.y], intent.socket, [target.x, target.y]);
    const to = this.screen(gridPosition(state.arena, target.x, target.y), 0.75);
    this.arrow(from, to, intent.type === 'support' ? COLORS.heal : color, false, options.readCombat ? 0.72 : 0.9);
  }

  drawEffect(state, effect, time, replay = false) {
    const ctx = this.ctx;
    const age = replay ? effect.duration * 0.55 : time - effect.start;
    const progress = Math.max(0, Math.min(1, age / effect.duration));
    const alpha = replay ? 1 : Math.max(0, 1 - Math.max(0, progress - 0.72) / 0.28);
    ctx.save(); ctx.globalAlpha = alpha;
    if (effect.effectType === 'move' || effect.type === 'move') {
      const from = this.screen(gridPosition(state.arena, ...effect.from), 0.06);
      const to = this.screen(gridPosition(state.arena, effect.x, effect.y), 0.06);
      this.line(from, to, COLORS.history, 2, [3, 5], 0.75 * alpha);
      ctx.fillStyle = COLORS.history; ctx.beginPath(); ctx.arc(from[0], from[1], 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = COLORS.history; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(to[0] - 5, to[1]); ctx.lineTo(to[0] - 1, to[1] + 4); ctx.lineTo(to[0] + 6, to[1] - 5); ctx.stroke();
    } else if (effect.effectType === 'repair' || effect.type === 'repair') {
      const unit = state.units.find(candidate => candidate.id === effect.unit);
      const from = unit ? this.socketScreen(state, unit, effect.actorCell, effect.socket, effect.targetCell) : this.screen(gridPosition(state.arena, ...effect.actorCell), 0.8);
      const to = this.screen(gridPosition(state.arena, ...effect.targetCell), 0.72);
      const middle = [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - 22];
      ctx.strokeStyle = '#17131f'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(...from); ctx.quadraticCurveTo(...middle, ...to); ctx.stroke();
      ctx.strokeStyle = COLORS.heal; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(...from); ctx.quadraticCurveTo(...middle, ...to); ctx.stroke();
      this.floatingValue(to, `+${effect.amount}`, COLORS.heal, '+', progress);
    } else if (effect.effectType === 'shot' || effect.type === 'attack' || effect.type === 'blast') {
      const unit = state.units.find(candidate => candidate.id === effect.unit);
      const from = unit ? this.socketScreen(state, unit, effect.actorCell, effect.socket, effect.targetCell) : this.screen(gridPosition(state.arena, ...effect.actorCell), 0.8);
      const center = effect.centerCell || effect.targetCell;
      const to = this.screen(gridPosition(state.arena, ...center), 0.72);
      const travel = Math.min(1, progress * 1.45);
      const current = [from[0] + (to[0] - from[0]) * travel, from[1] + (to[1] - from[1]) * travel - (effect.module === 'mortar' ? Math.sin(travel * Math.PI) * 52 : 0)];
      if (['blade', 'hammer'].includes(effect.module)) {
        ctx.strokeStyle = effect.module === 'hammer' ? COLORS.order : COLORS.text; ctx.lineWidth = effect.module === 'hammer' ? 8 : 4;
        ctx.beginPath(); ctx.arc(to[0], to[1], 20, -Math.PI * 0.8, Math.PI * 0.25); ctx.stroke();
      } else {
        this.line(from, current, effect.module === 'mortar' ? COLORS.order : COLORS.text, effect.module === 'mortar' ? 4 : 2.5, [], 0.95 * alpha);
        ctx.fillStyle = effect.module === 'mortar' ? COLORS.order : COLORS.text; ctx.beginPath(); ctx.arc(...current, effect.module === 'mortar' ? 6 : 3.5, 0, Math.PI * 2); ctx.fill();
      }
      if (progress > 0.45 || replay) {
        ctx.strokeStyle = effect.module === 'mortar' ? COLORS.order : COLORS.text; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(to[0], to[1], 8 + progress * 15, 0, Math.PI * 2); ctx.stroke();
        for (const victim of effect.victims || [effect]) {
          const point = this.screen(gridPosition(state.arena, ...victim.targetCell), 0.75);
          this.floatingValue(point, `−${victim.amount}`, COLORS.danger, '−', progress);
          if (victim.shieldFactor < 1) {
            ctx.strokeStyle = COLORS.shield; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(point[0], point[1] + 8, 22, Math.PI, Math.PI * 2); ctx.stroke();
          }
        }
      }
    } else if (effect.effectType === 'disabled' || effect.type === 'disabled') {
      const point = this.screen(gridPosition(state.arena, effect.x, effect.y), 0.25);
      ctx.strokeStyle = COLORS.danger; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(point[0], point[1], 15 + progress * 12, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  floatingValue(point, text, color, icon, progress) {
    const ctx = this.ctx;
    const y = point[1] - 26 - Math.min(1, progress * 1.5) * 15;
    ctx.font = '700 14px "Segoe UI", system-ui, sans-serif';
    const width = ctx.measureText(text).width + 30;
    ctx.fillStyle = '#17131fee'; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(point[0] - width / 2, y - 18, width, 25, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(`${icon} ${text}`, point[0], y);
  }

  drawLabel(state, unit, position, selected, options, offset = 0) {
    const ctx = this.ctx;
    const anchor = this.screen(position, unit.active ? 1.55 : 0.55);
    const point = [anchor[0], anchor[1] - offset];
    const badge = badgeFor(state, unit, options.lab);
    const width = selected ? 108 : 88;
    const height = 34;
    const color = unit.team === 'player' ? COLORS.ally : COLORS.enemy;
    if (offset) this.line(anchor, [point[0], point[1] + height / 2], COLORS.history, 1, [], 0.65);
    const labelScale = this.viewWidth < 600 || this.viewHeight < 390 ? 0.76 : 1;
    ctx.save();
    ctx.translate(point[0], point[1]);
    ctx.scale(labelScale, labelScale);
    ctx.translate(-point[0], -point[1]);
    ctx.globalAlpha = unit.active ? 1 : 0.64;
    ctx.fillStyle = '#17131fee';
    ctx.strokeStyle = selected ? COLORS.selection : color;
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.beginPath(); ctx.roundRect(point[0] - width / 2, point[1] - 28, width, height, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    if (unit.team === 'player') { ctx.beginPath(); ctx.arc(point[0] - width / 2 + 13, point[1] - 18, 9, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.roundRect(point[0] - width / 2 + 4, point[1] - 27, 18, 18, 3); ctx.fill(); }
    ctx.fillStyle = '#252032'; ctx.font = '800 11px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(badge, point[0] - width / 2 + 13, point[1] - 14);
    ctx.fillStyle = COLORS.text; ctx.font = `${selected ? 700 : 600} 12px "Segoe UI", system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.fillText(unit.name, point[0] - width / 2 + 27, point[1] - 14, width - 33);
    ctx.fillStyle = '#0d0b11'; ctx.fillRect(point[0] - width / 2 + 4, point[1] - 2, width - 8, 5);
    ctx.fillStyle = color; ctx.fillRect(point[0] - width / 2 + 4, point[1] - 2, (width - 8) * Math.max(0, unit.hp / unit.maxHp), 5);
    if (selected) {
      ctx.font = '11px "Segoe UI", system-ui, sans-serif'; ctx.fillStyle = COLORS.text; ctx.textAlign = 'right'; ctx.fillText(`${Math.ceil(unit.hp)}/${unit.maxHp}`, point[0] + width / 2 - 3, point[1] - 34);
    }
    if (unit.active && unit.hp / unit.maxHp < 0.25) {
      ctx.fillStyle = COLORS.danger; ctx.beginPath(); ctx.moveTo(point[0] + width / 2 + 4, point[1] - 24); ctx.lineTo(point[0] + width / 2 + 13, point[1] - 8); ctx.lineTo(point[0] + width / 2 - 5, point[1] - 8); ctx.closePath(); ctx.fill();
    }
    const activeOrder = unit.priorityTarget || unit.retreatUntil > state.tick || unit.overload?.until > state.tick;
    if (activeOrder) { ctx.fillStyle = COLORS.order; ctx.font = '800 13px "Segoe UI"'; ctx.textAlign = 'left'; ctx.fillText('◆', point[0] - width / 2 - 13, point[1] - 11); }
    ctx.restore();
    this.pickRegions.push({ type: 'unit', id: unit.id, x: anchor[0], y: anchor[1] + 30, radius: 34 });
    return { point, width, height, offset };
  }

  renderBattle(state, selectedId, time = performance.now(), options = {}) {
    this.time = time;
    const replayEvent = options.replayEvent || null;
    if (!replayEvent && !options.deployment) this.processEvents(state, time);
    this.begin(false, options.camera);
    this.drawModel(`arena-${state.arena.kit}`, identity());
    const narrow = new Set(state.arena.narrow.map(cell => cell.join(',')));
    const blocked = new Set(state.arena.obstacles.map(cell => cell.join(',')));
    const rangeCells = new Map((options.range?.cells || []).map(cell => [`${cell.x},${cell.y}`, cell.kind]));
    const legalCells = new Set((options.placement?.legalCells || []).map(cell => `${cell.x},${cell.y}`));
    for (let y = 0; y < state.arena.height; y += 1) {
      for (let x = 0; x < state.arena.width; x += 1) {
        const key = `${x},${y}`;
        const position = gridPosition(state.arena, x, y);
        const rangeKind = rangeCells.get(key);
        let color = narrow.has(key) ? [0.29, 0.39, 0.27, 1] : (x + y) % 2 ? [0.35, 0.32, 0.38, 1] : [0.39, 0.36, 0.42, 1];
        if (blocked.has(key)) color = [0.22, 0.2, 0.25, 1];
        if (rangeKind === 'in-range') color = [0.4, 0.48, 0.29, 1];
        if (rangeKind === 'too-close') color = [0.48, 0.4, 0.31, 1];
        if (legalCells.has(key)) color = [0.37, 0.49, 0.25, 1];
        this.drawBasic('cube', multiply(translation(position[0], -0.02, position[2]), scaling(1.18, 0.08, 1.18)), color);
        const screen = this.screen(position);
        this.pickRegions.push({ type: 'cell', x: screen[0], y: screen[1], gridX: x, gridY: y, radius: 24 });
      }
    }
    state.arena.obstacles.forEach(([x, y], index) => {
      const position = gridPosition(state.arena, x, y);
      const modelName = ['obstacle-crate', 'obstacle-gear', 'obstacle-spool'][(index + state.arena.id.length) % 3];
      this.drawModel(modelName, compose(position, index * 0.7, 0.72));
    });
    this.drawGridLabels(state);
    const sorted = state.units.slice().sort((a, b) => a.x + a.y - b.x - b.y);
    const positions = new Map();
    for (const unit of sorted) {
      const position = this.unitPosition(state, unit, time, options.reducedMotion || replayEvent);
      positions.set(unit.id, position);
      const intent = options.intents?.[unit.id];
      const target = state.units.find(other => other.id === intent?.targetId);
      let yaw = unit.team === 'player' ? Math.PI / 2 : -Math.PI / 2;
      if (target) yaw = Math.atan2(target.x - unit.x, target.y - unit.y);
      this.drawBasic('disc', multiply(translation(position[0], 0.025, position[2]), scaling(0.55, 1, 0.55)), unit.team === 'player' ? [0.45, 0.61, 0.17, 1] : [0.68, 0.27, 0.18, 1]);
      this.drawRobot(unit, position, yaw, time, {
        result: state.result, reducedMotion: options.reducedMotion, tick: state.tick,
        scale: this.viewWidth < 600 || this.viewHeight < 390 ? 1.15 : 1,
        highlightSocket: options.highlightSocket?.unitId === unit.id ? options.highlightSocket.socket : null
      });
      if (unit.id === selectedId) {
        const point = this.screen(position, 0.05);
        const ctx = this.ctx;
        ctx.save(); ctx.strokeStyle = '#17131f'; ctx.lineWidth = 7; ctx.beginPath(); ctx.ellipse(point[0], point[1], 31, 14, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = COLORS.selection; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(point[0], point[1], 31, 14, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
    }
    if (options.placement?.candidate) {
      const candidate = options.placement.candidate;
      const unit = state.units.find(other => other.id === candidate.unitId);
      if (unit) this.arrow(this.screen(gridPosition(state.arena, unit.x, unit.y), 0.1), this.screen(gridPosition(state.arena, candidate.x, candidate.y), 0.1), COLORS.selection, true);
    }
    if (!options.deployment) {
      for (const unit of state.units) {
        if (!unit.active || (!options.readCombat && unit.id !== selectedId)) continue;
        this.drawIntent(state, unit, options.intents?.[unit.id], options);
        const priority = unit.priorityTarget ? state.units.find(other => other.id === unit.priorityTarget && other.active) : null;
        if (priority) {
          this.arrow(this.screen(gridPosition(state.arena, unit.x, unit.y), 0.8), this.screen(gridPosition(state.arena, priority.x, priority.y), 0.8), COLORS.order, true, 0.95);
          this.corners(this.screen(positions.get(priority.id), 0.65), COLORS.order, 9, 23);
        }
      }
    }
    if (options.orderPreview?.targetId) {
      const actor = state.units.find(unit => unit.id === options.orderPreview.actorId);
      const target = state.units.find(unit => unit.id === options.orderPreview.targetId);
      if (actor && target) this.arrow(this.screen(gridPosition(state.arena, actor.x, actor.y), 0.85), this.screen(gridPosition(state.arena, target.x, target.y), 0.85), COLORS.order, true);
    }
    if (options.orderPreview?.action?.type === 'move') {
      const actor = state.units.find(unit => unit.id === options.orderPreview.actorId);
      const destination = options.orderPreview.action.destination;
      if (actor && destination) this.arrow(this.screen(gridPosition(state.arena, actor.x, actor.y), 0.08), this.screen(gridPosition(state.arena, ...destination), 0.08), COLORS.order, true);
    }
    for (const effect of replayEvent ? [{ ...replayEvent, effectType: replayEvent.type, duration: 500, victims: state.events?.filter(event => event.actionId && event.actionId === replayEvent.actionId) || [replayEvent] }] : this.effects) this.drawEffect(state, effect, time, Boolean(replayEvent));
    for (const targetId of options.range?.targetIds || []) {
      const target = state.units.find(unit => unit.id === targetId);
      if (target) this.corners(this.screen(positions.get(target.id) || gridPosition(state.arena, target.x, target.y), 0.65), target.team === 'player' ? COLORS.ally : COLORS.enemy);
    }
    if (options.orderPreview?.targetId) {
      const target = state.units.find(unit => unit.id === options.orderPreview.targetId);
      if (target) this.corners(this.screen(positions.get(target.id), 0.65), COLORS.selection, 13, 22);
    }
    const labels = [];
    const labelScale = this.viewWidth < 600 || this.viewHeight < 390 ? 0.76 : 1;
    for (const unit of sorted) {
      const anchor = this.screen(positions.get(unit.id), unit.active ? 1.55 : 0.55);
      const width = (unit.id === selectedId ? 108 : 88) * labelScale;
      let offset = 0;
      for (const other of labels) {
        const overlaps = Math.abs(anchor[0] - other.anchor[0]) < (width + other.width) / 2 + 3 && Math.abs((anchor[1] - offset) - (other.anchor[1] - other.offset)) < 38 * labelScale;
        if (overlaps) offset = Math.max(offset, other.offset + 40 * labelScale);
      }
      labels.push({ anchor, width, offset });
      this.drawLabel(state, unit, positions.get(unit.id), unit.id === selectedId, options, offset);
    }
  }

  renderDeployment(arena, playerUnits, enemyUnits, selectedId, time, options = {}) {
    const convert = (unit, team, index) => ({
      ...unit, id: unit.id || `${team}-${index}`, team, active: true, hp: CHASSIS[unit.chassis].hp,
      maxHp: CHASSIS[unit.chassis].hp, x: unit.position?.[0] ?? arena.starts[team][index][0],
      y: unit.position?.[1] ?? arena.starts[team][index][1], cooldowns: {}, overload: null, retreatUntil: 0
    });
    const state = { arena, units: [...playerUnits.map((unit, index) => convert(unit, 'player', index)), ...enemyUnits.map((unit, index) => convert(unit, 'enemy', index))], charges: { player: 3, enemy: 3 }, tick: 0, result: null, events: [] };
    this.renderBattle(state, selectedId, time, { ...options, deployment: true });
  }

  renderWorkshop(unit, time = performance.now(), options = {}) {
    this.time = time;
    this.begin(true, options.camera);
    this.drawModel('workshop', identity());
    this.drawBasic('cube', multiply(translation(0, -0.03, 0.25), scaling(1.65, 0.2, 1.65)), [0.34, 0.37, 0.39, 1]);
    const runtime = { ...unit, id: unit.id || 'work-unit', team: 'player', active: true, hp: 1, maxHp: 1, cooldowns: {}, overload: null };
    this.drawRobot(runtime, [0, 0.18, 0.25], options.rotation ?? 0.35, time, { scale: 1.4, reducedMotion: options.reducedMotion, highlightSocket: options.highlightSocket });
    this.pickRegions.push({ type: 'work-unit', id: unit.id, x: this.viewWidth / 2, y: this.viewHeight / 2, radius: Math.min(90, this.viewWidth / 4) });
    const sockets = this.attachments?.sockets[unit.chassis] || {};
    for (const [socket, local] of Object.entries(sockets)) {
      const model = compose([0, 0.18, 0.25], options.rotation ?? 0.35, 1.4);
      const point = this.screen(transformPoint(model, local));
      const ctx = this.ctx;
      ctx.save(); ctx.fillStyle = options.highlightSocket === socket ? COLORS.order : COLORS.ally; ctx.strokeStyle = '#17131f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(point[0], point[1], 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      this.pickRegions.push({ type: 'socket', socket, x: point[0], y: point[1], radius: 19 });
    }
  }

  pick(clientX, clientY) {
    const rect = this.overlay.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return this.pickRegions.filter(region => Math.hypot(region.x - x, region.y - y) <= region.radius)
      .sort((a, b) => (a.type === 'unit' ? -2 : a.type === 'socket' ? -1 : 0) - (b.type === 'unit' ? -2 : b.type === 'socket' ? -1 : 0))[0] || null;
  }
}
