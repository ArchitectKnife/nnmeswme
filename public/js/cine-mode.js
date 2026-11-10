// BURGER SKIN — лёгкие помощники кинодропов (без самой сцены: она грузится лениво из cinematic.js).
import { state, html } from './core.js';

const KEY = 'bs_cine';
const LITE_KEY = 'bs_cine_lite';
export const MODES = [['full', 'Полные'], ['short', 'Короткие'], ['off', 'Выкл']];
/** Уровни кинодропа по возрастанию (их считает сервер по цене уже выданного предмета). */
export const LEVELS = ['standard', 'rare', 'epic', 'legendary', 'godlike'];
export const LEVEL_META = {
  standard: { name: 'STANDARD', ru: 'Стандарт', icon: 'star', a: '#9fb6d9', b: '#ffffff' },
  rare: { name: 'RARE', ru: 'Редкий', icon: 'gem', a: '#3d7bff', b: '#a6e6ff' },
  epic: { name: 'EPIC', ru: 'Эпический', icon: 'sparkles', a: '#9d4dff', b: '#f3b0ff' },
  legendary: { name: 'LEGENDARY', ru: 'Легендарный', icon: 'flame', a: '#ff3b2f', b: '#ffcf6b' },
  godlike: { name: 'GODLIKE', ru: 'Божественный', icon: 'crown', a: '#ffcb52', b: '#fff6dc' },
};
export const KIND_META = {
  knife: { name: 'KNIFE', ru: 'Нож', icon: 'sword', a: '#cfe0ff', b: '#ffffff' },
  glove: { name: 'GLOVES', ru: 'Перчатки', icon: 'hand', a: '#7AC74F', b: '#F4A259' },
};
// Уровни до v4 (tier): godlike < mythic < divine.
const LEGACY = { godlike: 'epic', mythic: 'legendary', divine: 'godlike' };

/**
 * Приводит fx к текущему формату (в том числе старые записи с tier/scene). Ничего не решает —
 * только читает уровень, который уже посчитал и сохранил сервер.
 */
export function normFx(fx) {
  if (!fx || typeof fx !== 'object') return null;
  const kind = fx.kind === 'knife' || fx.kind === 'glove' ? fx.kind : fx.scene === 'knife' || fx.scene === 'glove' ? fx.scene : null;
  let level = LEVELS.includes(fx.level) ? fx.level : null;
  if (!level) level = LEGACY[fx.tier] || (LEVELS.includes(fx.scene) ? fx.scene : LEGACY[fx.scene]) || (kind ? 'epic' : 'rare');
  const word = kind === 'glove' ? 'GLOVES' : kind === 'knife' ? 'KNIFE' : 'DROP';
  const label = typeof fx.label === 'string' && fx.label.trim() ? fx.label : level === 'standard' ? word : `${LEVEL_META[level].name} ${word}`;
  const rank = Number.isFinite(fx.rank) && fx.level ? fx.rank : LEVELS.indexOf(level) + (kind ? 0.5 : 0);
  return { level, kind, scene: kind || level, rank, label, tier: fx.tier ?? null };
}

/** Бейдж уровня для страниц сайта (цвета инлайном: стили сцены грузятся лениво). */
export function fxBadge(fx, icon) {
  const f = normFx(fx);
  if (!f) return '';
  const m = LEVEL_META[f.level];
  const k = f.kind ? KIND_META[f.kind] : null;
  const a = k && f.level !== 'godlike' ? k.a : m.a;
  const b = k && f.level !== 'godlike' ? m.a : m.b;
  const dark = f.level === 'godlike' || f.level === 'standard' || f.kind === 'knife';
  return html`<span class="drop-fx-badge lv-${f.level} ${f.kind || ''}" style="background:linear-gradient(180deg,${a},${b});color:${dark ? '#11131a' : '#fff'}">${icon ? icon(k?.icon || m.icon) : ''} ${f.label}</span>`;
}
/** Цвета уровня как "r,g,b" (для CSS-переменных). */
export function fxRgb(fx) {
  const f = normFx(fx);
  const m = LEVEL_META[f?.level] || LEVEL_META.epic;
  const k = f?.kind ? KIND_META[f.kind] : null;
  const toRgb = (h) => { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; };
  return [toRgb(k && f.level !== 'godlike' ? k.a : m.a), toRgb(m.b)];
}

/** Кинодропы включены на сайте (админка → Кинодропы). */
export const cineOn = () => state.site?.dropFx?.enabled !== false;
export const shareOn = () => state.site?.dropFx?.share !== false;
/** Режим игрока: full — полная сцена, short — ускоренная, off — без сцены. */
export function cineMode() {
  let v = null;
  try { v = localStorage.getItem(KEY); } catch { v = null; }
  if (v === 'full' || v === 'short' || v === 'off') return v;
  const d = state.site?.dropFx?.defaultMode;
  return d === 'short' || d === 'off' ? d : 'full';
}
export function setCineMode(v) { try { localStorage.setItem(KEY, v); } catch { /* приватный режим */ } }

/** Явный выбор игрока: true / false, или null — не выбирал. */
export function liteChoice() {
  let v = null;
  try { v = localStorage.getItem(LITE_KEY); } catch { v = null; }
  return v === '1' ? true : v === '0' ? false : null;
}
/** Облегчённые эффекты: выбор игрока → стандарт сайта → слабое устройство (≤ 4 потоков или ≤ 2 ГБ памяти). */
export function liteMode() {
  const c = liteChoice();
  if (c !== null) return c;
  if (state.site?.dropFx?.reducedDefault) return true;
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  return cores <= 4 || mem <= 2;
}
export function setLiteMode(on) { try { localStorage.setItem(LITE_KEY, on ? '1' : '0'); } catch { /* ignore */ } }

/** Самый редкий дроп среди открытых (уровень уже посчитан сервером и пришёл в ответе). */
export function bestFx(drops) {
  let b = null, br = -1;
  for (const x of drops || []) {
    const f = normFx(x?.fx);
    if (!f) continue;
    if (!b || f.rank > br || (f.rank === br && (x.inv?.price || 0) > (b.inv?.price || 0))) { b = x; br = f.rank; }
  }
  return b;
}
export const loadCine = () => import('./cinematic.js');
