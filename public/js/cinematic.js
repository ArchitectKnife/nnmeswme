// BURGER SKIN — кинематографичный показ редкого дропа (STANDARD / RARE / EPIC / LEGENDARY / GODLIKE + KNIFE / GLOVE).
//
// Модуль грузится лениво только при кинодропе. Сцена ничего не решает: предмет, его цена и уровень уже
// записаны сервером в инвентарь и пришли в ответе /api/cases/:slug/open ДО запуска анимации. Здесь — только
// визуализация этого результата; закрыть или пропустить сцену можно всегда, промис всегда завершается.
//
// Устройство (public/js/cine/):
//   levels.js   — пресеты уровней, вариации ножей/перчаток, линия времени стадий;
//   director.js — режиссура: состояние сцены как функция времени + список звуковых/визуальных реплик;
//   showcase.js — мир витрины и камера; particles.js — частицы; gl.js — WebGL2; fallback2d.js — Canvas2D;
//   scene.js    — DOM/HUD, цикл кадров, ввод, адаптивное качество; share.js — «Поделиться дропом».
import { safeUrl } from './core.js';
import { cineMode, liteMode, normFx, LEVELS } from './cine-mode.js';
import { preload } from './cine/util.js';
import { CineScene } from './cine/scene.js';
import { openShare as shareBox } from './cine/share.js';

export { cineMode };
export const SCENES = [...LEVELS, 'knife', 'glove'];

let cssP = null;
export function ensureCss() {
  if (cssP) return cssP;
  if (document.querySelector('link[data-cine-css]')) return (cssP = Promise.resolve());
  cssP = new Promise((res) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/cine.css?v=5'; l.dataset.cineCss = '1';
    l.onload = () => res(); l.onerror = () => res();
    document.head.append(l);
    setTimeout(res, 2500);
  });
  return cssP;
}

let active = null;

/**
 * Проиграть сцену для УЖЕ выданного сервером предмета. Promise завершается при закрытии сцены
 * (и сразу — если сцену показать нельзя). o: { item, fx, share?, others?, caseName?, replay?, preview?, mode?, lite? }
 */
export async function playDrop(o = {}) {
  const fx = normFx(o.fx);
  if (!o.item || !fx) return;
  if (active) active.close(true);
  let mode = o.mode || cineMode();
  if (mode === 'off') mode = o.replay || o.preview ? 'full' : 'off';
  if (mode === 'off') return;
  const src = safeUrl(o.item.image, '');
  let loaded = { img: null, ok: false, late: null };
  try { [, loaded] = await Promise.all([ensureCss(), preload(src, 2500)]); } catch { /* показываем без картинки */ }
  return new Promise((resolve) => {
    let scene = null;
    const done = () => { if (active === scene) active = null; resolve(); };
    try {
      scene = new CineScene({ ...o, fx, mode, lite: o.lite ?? liteMode() }, loaded.ok ? loaded.img : null, done);
      active = scene;
      // Картинка догрузилась после таймаута — подставляем её, если раскрытие ещё не случилось.
      if (!loaded.ok && loaded.late) loaded.late((img) => { if (scene && !scene.dead && !scene.S.revealed && img.naturalWidth) { scene.img = img; scene.root.classList.remove('noimg'); try { scene.R?.setItem(img); } catch { /* ignore */ } } });
    } catch (e) {
      console.warn('[cine] сцена не запустилась', e);
      try { scene?.close(true); } catch { /* ignore */ }
      document.querySelectorAll('.cine').forEach((n) => n.remove());
      document.documentElement.classList.remove('cine-open');
      active = null;
      resolve();
    }
  });
}
export function closeDrop() { active?.close(true); }
export const dropActive = () => !!active;
/** Для автотестов: управление активной сценой (замедлить, остановить на моменте, состояние). */
export const debugScene = () => active?.debug() || null;

/** Предпросмотр сцены из админки (ничего не выдаёт и не записывает). level — уровень, kind — knife/glove. */
export function previewDrop(level, item, kind = null, opts = {}) {
  let lv = LEVELS.includes(level) ? level : null;
  let k = kind === 'knife' || kind === 'glove' ? kind : null;
  if (!lv && (level === 'knife' || level === 'glove')) { k = level; lv = 'epic'; }
  const fx = normFx(lv ? { level: lv, kind: k } : { tier: level, kind: k });
  return playDrop({ item, fx, preview: true, mode: opts.mode || 'full', lite: opts.lite, q: opts.q });
}

export function openShare({ item, fx, share } = {}) {
  return shareBox({ item, fx, share }, ensureCss);
}
