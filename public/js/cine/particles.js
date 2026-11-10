// BURGER SKIN — кинодроп: система частиц (мировые координаты, типизированные массивы, без аллокаций в кадре).
// Типы: 0 — светящаяся точка, 1 — искра со шлейфом, 2 — осколок, 3 — световой клинок (нож), 4 — дымка (перчатки), 5 — звёздный блик.
import { TAU, rnd, pick, clamp, ss } from './util.js';
import { WORLD } from './showcase.js';

export const STRIDE = 13; // pos3, vel3, size, rgba, type, rot
const F_ATTRACT = 1, F_DUST = 2, F_SWAY = 4;

export class Particles {
  constructor(cap) {
    this.cap = 0; this.n = 0;
    this.resize(cap);
  }
  resize(cap) {
    const old = this.n ? this.snapshot() : null;
    this.cap = cap;
    const F = Float32Array;
    for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'max', 'size', 'r', 'g', 'b', 'a', 'rot', 'vr', 'drag', 'grav', 'seed', 'str']) this[k] = new F(cap);
    this.type = new Uint8Array(cap); this.flag = new Uint8Array(cap); this.ci = new Uint8Array(cap);
    this.buf = new F(cap * STRIDE);
    this.n = 0;
    if (old) for (let i = 0; i < Math.min(old.length, cap); i++) this.add(old[i]);
  }
  snapshot() {
    const out = [];
    for (let i = 0; i < this.n; i++) out.push({ x: this.px[i], y: this.py[i], z: this.pz[i], vx: this.vx[i], vy: this.vy[i], vz: this.vz[i], life: this.life[i], max: this.max[i], size: this.size[i], c: [this.r[i], this.g[i], this.b[i]], a: this.a[i], rot: this.rot[i], vr: this.vr[i], drag: this.drag[i], grav: this.grav[i], type: this.type[i], flag: this.flag[i], ci: this.ci[i], str: this.str[i] });
    return out;
  }
  clear() { this.n = 0; }
  /** o: { x,y,z, vx,vy,vz, max, size, c:[r,g,b], a, type, rot, vr, drag, grav, flag, ci, str } */
  add(o) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
    this.life[i] = o.life || 0; this.max[i] = o.max || 1; this.size[i] = o.size || 0.03;
    const c = o.c || [1, 1, 1];
    this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2]; this.a[i] = o.a ?? 1;
    this.type[i] = o.type || 0; this.rot[i] = o.rot || 0; this.vr[i] = o.vr || 0;
    this.drag[i] = o.drag ?? 1; this.grav[i] = o.grav || 0; this.flag[i] = o.flag || 0; this.ci[i] = o.ci ?? 3;
    this.seed[i] = Math.random() * 100; this.str[i] = o.str ?? 1;
  }
  kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'max', 'size', 'r', 'g', 'b', 'a', 'rot', 'vr', 'drag', 'grav', 'seed', 'str', 'type', 'flag', 'ci']) this[k][i] = this[k][j];
  }
  update(dt, S) {
    if (dt <= 0) return;
    const [rx, ry, rz] = WORLD.rift;
    const suck = S.suck || 0;
    for (let i = this.n - 1; i >= 0; i--) {
      const L = (this.life[i] += dt);
      if (L >= this.max[i]) { this.kill(i); continue; }
      const f = this.flag[i];
      const dr = Math.exp(-this.drag[i] * dt);
      let vx = this.vx[i] * dr, vy = this.vy[i] * dr + this.grav[i] * dt, vz = this.vz[i] * dr;
      if ((f & F_ATTRACT) || (suck > 0.01 && !(f & F_DUST))) {
        const dx = rx - this.px[i], dy = ry - this.py[i], dz = rz - this.pz[i];
        const d = Math.hypot(dx, dy, dz) + 0.25;
        const k = ((f & F_ATTRACT) ? 3.5 : 0) + suck * 14;
        vx += (dx / d) * k * dt / d * 1.5; vy += (dy / d) * k * dt / d * 1.5; vz += (dz / d) * k * dt / d * 1.5;
        if ((f & F_ATTRACT) && d < 0.4) { this.kill(i); continue; }
      }
      if (f & F_SWAY) { const sd = this.seed[i]; vx += Math.sin(L * 2.1 + sd) * 0.9 * dt; vz += Math.cos(L * 1.7 + sd) * 0.5 * dt; }
      this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
      this.px[i] += vx * dt; this.py[i] += vy * dt; this.pz[i] += vz * dt;
      this.rot[i] += this.vr[i] * dt;
    }
  }
  alpha(i, dustLight) {
    const u = this.life[i] / this.max[i], t = this.type[i];
    let a = this.a[i];
    if (t === 1 || t === 2) a *= Math.pow(1 - u, 1.3) * ss(0, 0.04, u);
    else if (t === 3) a *= Math.sin(Math.PI * clamp(u));
    else if (t === 5) a *= Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(this.life[i] * 18 + this.seed[i]));
    else a *= ss(0, 0.15, u) * (1 - ss(0.55, 1, u));
    if (this.flag[i] & F_DUST) a *= dustLight;
    return a;
  }
  /** Заполнить буфер инстансов для WebGL. Возвращает число частиц. */
  write(S) {
    const B = this.buf, dl = S.dustLight ?? 0.5;
    let n = 0;
    for (let i = 0; i < this.n; i++) {
      const a = this.alpha(i, dl);
      if (a <= 0.004) continue;
      const o = n * STRIDE, st = this.str[i];
      B[o] = this.px[i]; B[o + 1] = this.py[i]; B[o + 2] = this.pz[i];
      B[o + 3] = this.vx[i] * st; B[o + 4] = this.vy[i] * st; B[o + 5] = this.vz[i] * st;
      B[o + 6] = this.size[i];
      B[o + 7] = this.r[i]; B[o + 8] = this.g[i]; B[o + 9] = this.b[i]; B[o + 10] = a;
      B[o + 11] = this.type[i]; B[o + 12] = this.rot[i];
      n++;
    }
    return n;
  }
}

/** Эмиттеры: знают палитру сцены и превращают реплики режиссуры в частицы. */
export class Emitters {
  constructor(parts, P) {
    this.p = parts; this.P = P; this.acc = {};
    const { a, b, c } = P.pal;
    this.cols = [a, b, c, [1, 1, 1]];
  }
  col(i) { return this.cols[i]; }
  rate(key, perSec, dt, fn) {
    if (!(perSec > 0)) return;
    let n = (this.acc[key] || 0) + perSec * dt;
    while (n >= 1) { fn(); n -= 1; }
    this.acc[key] = n;
  }
  /** Непрерывные источники по состоянию сцены. */
  tick(dt, S, k = 1) {
    const P = this.P;
    this.rate('vortex', S.emit.vortex * 70 * k, dt, () => this.vortexOne());
    this.rate('rise', S.emit.rise * 26 * k, dt, () => this.riseOne());
    this.rate('twinkle', S.emit.twinkle * 7 * k, dt, () => this.twinkleOne());
    this.rate('wisps', S.emit.wisps * 9 * k, dt, () => this.wispOne());
    if (P.kind === 'knife' && S.final) this.rate('glint', 0.6 * k, dt, () => this.twinkleOne(true));
  }
  dust(n) {
    for (let i = 0; i < n; i++) {
      const ci = Math.random() < 0.6 ? 1 : 3;
      this.p.add({ x: rnd(-5, 5), y: rnd(-0.9, 3.2), z: rnd(-4, 1.8), vx: rnd(-0.04, 0.04), vy: rnd(-0.02, 0.05), vz: rnd(-0.03, 0.03),
        max: 1e9, size: rnd(0.008, 0.026), c: this.col(ci), a: rnd(0.25, 0.7), type: 0, drag: 0, flag: F_DUST, ci });
    }
  }
  vortexOne() {
    const [rx, ry, rz] = WORLD.rift;
    const ang = rnd(0, TAU), rad = rnd(1.8, 3.4), sp = rnd(1.2, 2.6);
    const ci = pick([0, 0, 1, 2]);
    this.p.add({ x: rx + Math.cos(ang) * rad, y: ry + Math.sin(ang) * rad * 0.8, z: rz + rnd(-0.5, 0.5),
      vx: -Math.sin(ang) * sp - Math.cos(ang) * 0.5, vy: Math.cos(ang) * sp * 0.8 - Math.sin(ang) * 0.4, vz: rnd(-0.2, 0.2),
      max: rnd(1.6, 3), size: rnd(0.014, 0.034), c: this.col(ci), a: rnd(0.6, 1), type: 1, drag: 0.3, flag: F_ATTRACT, ci, str: 0.05 });
  }
  riseOne() {
    const ang = rnd(0, TAU), R = WORLD.platR * rnd(0.85, 1.05);
    const ci = pick([0, 1, 1, 3]);
    this.p.add({ x: Math.cos(ang) * R, y: WORLD.floorY + 0.02, z: Math.sin(ang) * R, vx: rnd(-0.05, 0.05), vy: rnd(0.25, 0.7), vz: rnd(-0.05, 0.05),
      max: rnd(2, 4), size: rnd(0.012, 0.028), c: this.col(ci), a: rnd(0.5, 0.95), type: 0, drag: 0.15, flag: F_SWAY, ci });
  }
  twinkleOne(steel = false) {
    this.p.add({ x: rnd(-0.85, 0.85), y: rnd(-0.5, 0.5), z: 0.08, max: rnd(0.5, 1.0), size: rnd(0.05, steel ? 0.14 : 0.1), c: this.col(steel ? 3 : pick([1, 3])), a: 1, type: 5, drag: 0, ci: 3, rot: rnd(0, 0.6) });
  }
  wispOne() {
    const ang = rnd(0, TAU), R = rnd(1.1, 2.3);
    const ci = pick([0, 2]);
    this.p.add({ x: Math.cos(ang) * R, y: WORLD.floorY + rnd(0, 0.3), z: Math.sin(ang) * R - 0.3, vx: rnd(-0.1, 0.1), vy: rnd(0.35, 0.85), vz: rnd(-0.1, 0.1),
      max: rnd(2.2, 3.6), size: rnd(0.16, 0.34), c: this.col(ci), a: rnd(0.18, 0.34), type: 4, drag: 0.2, flag: F_SWAY, ci, rot: rnd(-0.4, 0.4) });
  }
  /** Искры раскрытия: радиально в 3D, со шлейфом и гравитацией. */
  sparks(n, o = {}) {
    const [x0, y0, z0] = o.at || [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const th = rnd(0, TAU), ph = Math.acos(rnd(-1, 1)), sp = rnd(o.min ?? 2.5, o.max ?? 9);
      const dx = Math.sin(ph) * Math.cos(th), dy = Math.sin(ph) * Math.sin(th), dz = Math.cos(ph) * 0.6 + 0.3;
      const ci = pick([0, 1, 1, 3, 3]);
      this.p.add({ x: x0 + dx * 0.2, y: y0 + dy * 0.2, z: z0 + dz * 0.1, vx: dx * sp, vy: dy * sp, vz: dz * sp, max: rnd(0.5, o.life ?? 1.6), size: rnd(0.012, 0.035),
        c: this.col(ci), a: 1, type: 1, drag: o.drag ?? 1.6, grav: o.grav ?? -4.5, ci, str: 0.045 });
    }
  }
  shards(n, o = {}) {
    const [x0, y0, z0] = o.at || [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const th = rnd(0, TAU), sp = rnd(o.min ?? 1.5, o.max ?? 6);
      const ci = pick([0, 0, 1, 2]);
      this.p.add({ x: x0 + rnd(-0.3, 0.3), y: y0 + rnd(-0.3, 0.3), z: z0 + rnd(-0.2, 0.2), vx: Math.cos(th) * sp, vy: Math.sin(th) * sp + 0.6, vz: rnd(0.2, 2.5),
        max: rnd(1.1, 2.6), size: rnd(0.05, o.big ? 0.22 : 0.14), c: this.col(ci), a: 0.95, type: 2, drag: 0.8, grav: -2.6, rot: rnd(0, TAU), vr: rnd(-9, 9), ci, str: 0 });
    }
  }
  /** Кольцо искр в плоскости разлома (энерговолна). */
  ring(n, o = {}) {
    const [rx, ry, rz] = WORLD.rift;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU + rnd(-0.05, 0.05), sp = rnd(2.4, 4.2) * (o.k || 1);
      const ci = pick([0, 1, 3]);
      this.p.add({ x: rx + Math.cos(th) * 0.4, y: ry + Math.sin(th) * 0.4, z: rz, vx: Math.cos(th) * sp, vy: Math.sin(th) * sp, vz: rnd(0, 0.6),
        max: rnd(0.5, 0.9), size: rnd(0.012, 0.026), c: this.col(ci), a: 0.9, type: 1, drag: 2.2, ci, str: 0.05 });
    }
  }
  /** Нож: световые клинки, рассекающие кадр по диагонали. */
  slash(dir = 1) {
    const s = dir === 0 ? (Math.random() < 0.5 ? 1 : -1) : dir;
    const y = dir === 0 ? rnd(-0.4, 0.5) : rnd(-0.6, 1.2), ang = rnd(-0.35, 0.35) + (dir === 0 ? 0.5 * s : 0);
    const sp = 34;
    for (let j = 0; j < (dir === 0 ? 3 : 2); j++) {
      this.p.add({ x: -6.5 * s, y: y + j * 0.08 - 6.5 * s * Math.tan(ang) * 0.1, z: 0.3 + j * 0.15, vx: sp * s * Math.cos(ang), vy: sp * Math.sin(ang), vz: 0,
        max: 0.42, size: j ? 0.012 : 0.022, c: j ? this.col(0) : [1, 1, 1], a: j ? 0.7 : 1, type: 3, drag: 0, ci: j ? 0 : 3, str: 0.16 });
    }
  }
}
