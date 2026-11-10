// BURGER SKIN — кинодроп: мир витрины и камера (общие для WebGL и 2D-рендера).
// Мир: Y вверх, предмет в начале координат лицом к камере (+Z), разлом позади, подиум внизу.
import { DEG, m4, v3, wobble } from './util.js';

export const WORLD = { IW: 2.0, floorY: -1.0, platR: 1.3, rift: [0, 0.04, -0.9] };

/**
 * Камера под размер экрана: предмет всегда помещается (десктоп, портрет телефона, низкий ландшафт),
 * плюс дрожание, облёт, «долли-зум» и параллакс от указателя.
 */
export function camera(S, W, H, aspImg = 4 / 3, T = 0, look = [0, 0]) {
  const asp = W / Math.max(1, H);
  const portrait = asp < 0.8;
  const low = H < 560 && asp > 1.2;
  const IW = WORLD.IW, IH = IW / Math.max(0.5, Math.min(2.5, aspImg));
  const fovB = 36 * DEG, tb = Math.tan(fovB / 2);
  const fitW = portrait ? 0.84 : low ? 0.4 : 0.42, fitH = portrait ? 0.3 : low ? 0.52 : 0.44;
  const base = Math.max(IW / (fitW * 2 * tb * asp), IH / (fitH * 2 * tb), 3.2);
  const fov = S.cam.fov * DEG;
  const dist = base * S.cam.dist * (tb / Math.tan(fov / 2));
  const ndcY = portrait ? 0.27 : low ? 0.04 : 0.07, ndcX = low ? -0.33 : 0;
  const tgt = [-ndcX * base * tb * asp + S.cam.x, -ndcY * base * tb + S.cam.y, 0];
  const yaw = S.cam.yaw + look[0] * 0.05, pitch = S.cam.pitch + look[1] * 0.03;
  const pos = [tgt[0] + Math.sin(yaw) * Math.cos(pitch) * dist, tgt[1] + Math.sin(pitch) * dist, tgt[2] + Math.cos(yaw) * Math.cos(pitch) * dist];
  const tr = S.shake * S.shake;
  if (tr > 0.0001) {
    const k = 0.05 * base * tr;
    pos[0] += k * wobble(T * 13, 1); pos[1] += k * wobble(T * 13, 7);
    tgt[0] += k * 0.6 * wobble(T * 11, 3); tgt[1] += k * 0.6 * wobble(T * 11, 9);
  }
  const roll = S.cam.roll + (tr > 0.0001 ? 0.03 * tr * wobble(T * 9, 5) : 0);
  const up = [Math.sin(roll), Math.cos(roll), 0];
  const view = m4.lookAt(pos, tgt, up);
  const proj = m4.persp(fov, asp, 0.05, 200);
  const vp = m4.mul(proj, view);
  const f = v3.norm(v3.sub(tgt, pos)), r = v3.norm(v3.cross(f, up)), u = v3.cross(r, f);
  return { pos, f, r, u, tan: Math.tan(fov / 2), asp, view, proj, vp, IW, IH, W, H, base };
}

/** Мировая точка → координаты экрана (uv 0..1, y вверх) и w. */
export function project(cam, p) {
  const c = m4.xform(cam.vp, p);
  const w = c[3] || 1e-4;
  return [c[0] / w * 0.5 + 0.5, c[1] / w * 0.5 + 0.5, w];
}

/** Модельная матрица предмета из состояния сцены (+ поворот пальцем на финале). */
export function itemModel(S, drag = [0, 0]) {
  const it = S.item;
  return m4.model(it.x, it.y, it.z, it.rx + drag[1], it.ry + drag[0], it.rz, it.s);
}
