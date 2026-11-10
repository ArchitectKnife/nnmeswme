// BURGER SKIN — кинодроп: пресеты уровней и вариации для ножей/перчаток.
// Пресет описывает только ПОДАЧУ уже выданного предмета: длительность стадий, интенсивность света,
// частиц, звука и камеры. На результат он не влияет — уровень приходит от сервера.
import { LEVELS, LEVEL_META, KIND_META, normFx } from '../cine-mode.js';
import { hex, mix3, clamp } from './util.js';

// Длительность стадий (сек, режим «Полные»): build, activate, suspense, [shatter], reveal.
// I — интенсивности (0..1+), pal — палитра (a — энергия, b — блики, c — вторичный, bg — фон).
const LV = {
  standard: {
    d: { build: 0.6, activate: 0.55, suspense: 0.5, reveal: 1.1 },
    I: { fog: 0.5, spots: 0.5, rays: 0.25, rift: 0, riftR: 0.3, distort: 0, lightning: 0, shake: 0, flash: 0.4, shock: 0.35, waves: 1, pulses: 1,
      sparks: 70, shards: 0, embers: 0.25, white: 0.25, halo: 0.6, pillars: 0, punch: 0.035, orbit: 6, dust: 0.5, vertigo: 0, prism: 0, blackout: 0, slowmo: 0, twinkle: 0.3 },
    pal: null,
    post: { bloom: 0.9, thr: 0.95, chroma: 0.0008, vig: 0.8, grain: 0.03, expo: 1.0 },
  },
  rare: {
    d: { build: 0.8, activate: 0.95, suspense: 0.8, reveal: 1.2 },
    I: { fog: 0.68, spots: 0.6, rays: 0.55, rift: 0.62, riftR: 0.5, distort: 0.3, lightning: 0, shake: 0.22, flash: 0.6, shock: 0.55, waves: 2, pulses: 2,
      sparks: 150, shards: 0, embers: 0.5, white: 0.4, halo: 0.75, pillars: 0, punch: 0.06, orbit: 7, dust: 0.7, vertigo: 0, prism: 0, blackout: 0, slowmo: 0, twinkle: 0.5 },
    pal: { a: '#3d7bff', b: '#a6e6ff', c: '#6a5cff', bg: '#02040c' },
    post: { bloom: 1.05, thr: 0.92, chroma: 0.0012, vig: 0.85, grain: 0.035, expo: 1.0 },
  },
  epic: {
    d: { build: 1.0, activate: 1.3, suspense: 1.1, reveal: 1.3 },
    I: { fog: 0.82, spots: 0.7, rays: 0.8, rift: 0.85, riftR: 0.62, distort: 0.55, lightning: 0.25, shake: 0.5, flash: 0.85, shock: 0.8, waves: 3, pulses: 3,
      sparks: 280, shards: 26, embers: 0.8, white: 0.6, halo: 0.9, pillars: 0, punch: 0.09, orbit: 8, dust: 0.85, vertigo: 0.3, prism: 0, blackout: 0, slowmo: 0, twinkle: 0.8 },
    pal: { a: '#9d4dff', b: '#f3b0ff', c: '#ff4fd8', bg: '#05020c' },
    post: { bloom: 1.2, thr: 0.9, chroma: 0.0018, vig: 0.9, grain: 0.04, expo: 1.0 },
  },
  legendary: {
    d: { build: 1.2, activate: 1.6, suspense: 1.45, reveal: 1.4 },
    I: { fog: 0.95, spots: 0.8, rays: 1.0, rift: 1.0, riftR: 0.72, distort: 0.8, lightning: 0.85, shake: 0.8, flash: 1.0, shock: 1.0, waves: 4, pulses: 4,
      sparks: 420, shards: 52, embers: 1.0, white: 0.8, halo: 1.0, pillars: 0.7, punch: 0.12, orbit: 9, dust: 1.0, vertigo: 0.8, prism: 0, blackout: 0, slowmo: 0, twinkle: 1 },
    pal: { a: '#ff3b2f', b: '#ffcf6b', c: '#ff7a1a', bg: '#090302' },
    post: { bloom: 1.35, thr: 0.88, chroma: 0.0025, vig: 0.92, grain: 0.045, expo: 1.0 },
  },
  godlike: {
    d: { build: 1.4, activate: 1.8, suspense: 1.75, shatter: 1.15, reveal: 1.7 },
    I: { fog: 0.85, spots: 0.7, rays: 1.15, rift: 1.12, riftR: 0.8, distort: 1.0, lightning: 1.0, shake: 1.0, flash: 1.15, shock: 1.2, waves: 5, pulses: 5,
      sparks: 650, shards: 110, embers: 1.2, white: 1.0, halo: 1.2, pillars: 1.0, punch: 0.15, orbit: 10, dust: 1.1, vertigo: 1.0, prism: 1.0, blackout: 1.0, slowmo: 1.0, twinkle: 1.3 },
    pal: { a: '#ffc53d', b: '#fff6dc', c: '#ff9a3c', bg: '#070403' },
    post: { bloom: 1.45, thr: 0.88, chroma: 0.002, vig: 0.92, grain: 0.04, expo: 1.0 },
  },
};
// Нож — холодная сталь и световые клинки; перчатки — изумруд/янтарь и мягкие «ткани» света.
const KIND = {
  knife: { a: '#c4d6ff', c: '#4d6cff', b: '#ffffff', spot: '#e8f0ff', bg: '#02040a' },
  glove: { a: '#36d67a', c: '#1fbfae', b: '#ffd9a0', spot: '#ffe2b8', bg: '#020905' },
};
export const KICK = {
  standard: 'Чистый дроп', rare: 'Редкий дроп', epic: 'Эпический дроп', legendary: 'Легендарный дроп', godlike: 'Божественный дроп',
};
export const KICK_KIND = { knife: 'Нож', glove: 'Перчатки' };

/**
 * Пресет сцены. o: { mode: 'full'|'short', reduced (prefers-reduced-motion), lite, item }.
 */
export function preset(fxIn, o = {}) {
  const fx = normFx(fxIn) || normFx({ level: 'epic' });
  const L = LV[fx.level];
  const li = LEVELS.indexOf(fx.level);
  const I = { ...L.I };
  const post = { ...L.post };
  // Палитра: стандартный уровень подсвечивается цветом редкости самого предмета.
  let pal;
  if (L.pal) pal = { a: hex(L.pal.a), b: hex(L.pal.b), c: hex(L.pal.c), bg: hex(L.pal.bg) };
  else {
    const rc = hex(o.item?.color, [0.62, 0.72, 0.85]);
    pal = { a: mix3(rc, [0.75, 0.82, 0.95], 0.25), b: [1, 1, 1], c: mix3(rc, [0.4, 0.5, 0.7], 0.5), bg: [0.02, 0.025, 0.04] };
  }
  let spot = mix3(pal.b, [1, 1, 1], 0.5);
  const kind = fx.kind;
  if (kind) {
    // Свой цветовой язык ножа/перчаток; уровень — лёгким оттенком (GODLIKE сохраняет золото).
    const K = KIND[kind];
    if (fx.level === 'godlike') pal = { a: pal.a, b: pal.b, c: hex(K.a), bg: mix3(pal.bg, hex(K.bg), 0.5) };
    else pal = { a: mix3(hex(K.a), pal.a, 0.18), b: hex(K.b), c: hex(K.c), bg: hex(K.bg) };
    spot = hex(K.spot);
    if (kind === 'knife') { I.rays *= 0.85; I.spots = Math.min(1, I.spots + 0.15); }
    if (kind === 'glove') { I.shake *= 0.7; I.fog = Math.min(1, I.fog + 0.08); }
  }
  // Стадии и масштаб времени.
  const short = o.mode === 'short';
  const d = { ...L.d };
  if (short) for (const k of Object.keys(d)) d[k] *= k === 'reveal' ? 0.75 : k === 'shatter' ? 0.65 : 0.5;
  if (o.reduced) {
    // Без резких движений: короче, без вспышек, тряски, рывков камеры и замедления.
    d.build = Math.min(d.build, 0.45); d.activate = Math.min(d.activate, 0.55); d.suspense = Math.min(d.suspense, 0.4);
    if (d.shatter) d.shatter = 0.5;
    d.reveal = 1.1;
    Object.assign(I, { shake: 0, punch: 0, vertigo: 0, slowmo: 0, distort: 0, blackout: 0, flash: Math.min(I.flash, 0.12), shock: 0, lightning: I.lightning * 0.3, orbit: I.orbit * 0.3 });
    post.chroma = 0;
  }
  if (o.lite) {
    I.sparks = Math.round(I.sparks * 0.4); I.shards = Math.round(I.shards * 0.4); I.dust *= 0.5; I.embers *= 0.5; I.distort *= 0.5;
    post.chroma *= 0.5;
  }
  const stages = [['build', d.build], ['activate', d.activate], ['suspense', d.suspense]];
  if (d.shatter) stages.push(['shatter', d.shatter]);
  stages.push(['reveal', d.reveal]);
  return {
    fx, level: fx.level, kind, li, label: fx.label, I, post, pal, spot,
    stages, reduced: !!o.reduced, lite: !!o.lite, short,
    kicker: [KICK[fx.level], kind ? KICK_KIND[kind] : ''].filter(Boolean).join(' · '),
    icon: kind ? KIND_META[kind].icon : LEVEL_META[fx.level].icon,
    css: { a: pal.a, b: pal.b, c: pal.c },
    intensity: clamp(li / 4),
  };
}

/** Линия времени: стадии подряд, у каждой — локальный прогресс 0..1. */
export class Timeline {
  constructor(stages) {
    this.st = {}; this.order = [];
    let t = 0;
    for (const [id, dur] of stages) { this.st[id] = { t0: t, d: Math.max(0.05, dur) }; this.order.push(id); t += Math.max(0.05, dur); }
    this.total = t;
  }
  has(id) { return !!this.st[id]; }
  start(id) { return this.st[id]?.t0 ?? 0; }
  end(id) { const s = this.st[id]; return s ? s.t0 + s.d : 0; }
  dur(id) { return this.st[id]?.d ?? 0; }
  u(id, T) { const s = this.st[id]; if (!s) return 0; return clamp((T - s.t0) / s.d); }
  stageAt(T) { for (const id of this.order) if (T < this.end(id)) return id; return 'final'; }
}
