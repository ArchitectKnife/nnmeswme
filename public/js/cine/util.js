// BURGER SKIN — кинодроп: математика, сглаживание, цвета, матрицы (column-major, как в WebGL).
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const eIn2 = (t) => clamp(t) ** 2;
export const eOut3 = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const eOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t)));
export const eInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const eBack = (t, c = 1.70158) => { t = clamp(t); return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
/** Импульс: 0 → 1 (за a сек) → 0 (за d сек). */
export const spike = (x, a, d) => (x < 0 ? 0 : x < a ? x / a : Math.exp(-(x - a) / d));
export const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
/** Плавный псевдошум для дрожания камеры и мерцания. */
export const wobble = (t, s = 0) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 3.1 + s * 2.3) * 0.3 + Math.sin(t * 7.3 + s * 4.1) * 0.2;

export function hex(c, fb = [1, 1, 1]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m) return fb.slice();
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const rgbStr = (c) => `${Math.round(clamp(c[0]) * 255)},${Math.round(clamp(c[1]) * 255)},${Math.round(clamp(c[2]) * 255)}`;
export const rgba = (c, a = 1) => `rgba(${rgbStr(c)},${a})`;

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const RASTER = /^image\/(png|jpe?g|webp|gif|avif)\b/i;
/** Загрузка настоящей картинки скина: только растровые форматы. SVG-заглушка сервера, 404 и ошибки — «картинки нет». */
async function loadRaster(src) {
  const r = await fetch(src, { credentials: 'same-origin' });
  if (!r.ok || !RASTER.test(r.headers.get('content-type') || '')) return null;
  const url = URL.createObjectURL(await r.blob());
  const im = new Image();
  im.decoding = 'async';
  im.src = url;
  try { await im.decode(); } catch { URL.revokeObjectURL(url); return null; }
  if (!im.naturalWidth) { URL.revokeObjectURL(url); return null; }
  im.dataset.blob = url;
  return im;
}
/**
 * Предзагрузка картинки предмета с таймаутом. ok=false — картинки нет (подменять её нельзя).
 * late(cb) — если картинка догрузится после таймаута, cb(img) получит её.
 */
export function preload(src, ms = 2500) {
  if (!src) return Promise.resolve({ img: null, ok: false, late: null });
  const p = loadRaster(src).catch(() => null);
  return new Promise((res) => {
    let done = false;
    const t = setTimeout(() => { if (done) return; done = true; res({ img: null, ok: false, late: (cb) => p.then((im) => { if (im) cb(im); }) }); }, ms);
    p.then((im) => { if (done) return; done = true; clearTimeout(t); res({ img: im, ok: !!im, late: null }); });
  });
}
export const releaseImg = (im) => { const u = im?.dataset?.blob; if (u) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } } };

// ---------- vec3 / mat4 ----------
export const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
export const m4 = {
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  },
  persp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f);
    return o;
  },
  lookAt(eye, at, up) {
    const z = v3.norm(v3.sub(eye, at)), x = v3.norm(v3.cross(up, z)), y = v3.cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]), -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]), -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1]);
  },
  /** Модель: перенос · Ry · Rx · Rz · масштаб (углы в радианах). */
  model(x, y, z, rx, ry, rz, s) {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    // R = Ry * Rx * Rz
    const r00 = cy * cz + sy * sx * sz, r01 = -cy * sz + sy * sx * cz, r02 = sy * cx;
    const r10 = cx * sz, r11 = cx * cz, r12 = -sx;
    const r20 = -sy * cz + cy * sx * sz, r21 = sy * sz + cy * sx * cz, r22 = cy * cx;
    return new Float32Array([r00 * s, r10 * s, r20 * s, 0, r01 * s, r11 * s, r21 * s, 0, r02 * s, r12 * s, r22 * s, 0, x, y, z, 1]);
  },
  /** Зеркало относительно плоскости y = h (для отражения на подиуме). */
  mirrorY(m, h) {
    const o = new Float32Array(m);
    for (let c = 0; c < 4; c++) o[c * 4 + 1] = -m[c * 4 + 1] + 2 * h * m[c * 4 + 3];
    return o;
  },
  xform(m, p) {
    const x = p[0], y = p[1], z = p[2];
    return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14], m[3] * x + m[7] * y + m[11] * z + m[15]];
  },
};
